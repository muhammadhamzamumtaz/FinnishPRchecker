import { chromium } from "playwright";
import nodemailer from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG = {
  bookingUrl: "https://migri.vihta.com/public/migri/#/reservation",
  targetOffices: [
    { name: "Tampere", optionPattern: /Tampere : Tampereen palvelupiste/i },
    { name: "Helsinki", optionPattern: /Helsinki : Helsingin palvelupiste/i },
    { name: "Lahti", optionPattern: /Lahti : Lahden palvelupiste/i },
    { name: "Lappeenranta", optionPattern: /Lappeenranta : Lappeenrannan palvelupiste/i },
    { name: "Turku", optionPattern: /Turku : Raision palvelupiste/i },
  ],
  categoryTextPatterns: [/o?leskelulupa/i],
  serviceTextPatterns: [/pysyv/i],
  applicantTextPatterns: [/1\s*(henkilo|person)/i],
  searchButtonTextPatterns: [/hae\s+vapaat\s+ajat|search/i],
  weekTabPattern: /vk\s*\d+/i,
  maxLookaheadDays: 60,
  debugDir: "debug-output",
};

const HEADLESS = process.env.HEADLESS !== "false";
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS ?? CONFIG.maxLookaheadDays);
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS ?? 0);
const DRY_RUN = process.env.DRY_RUN === "true";
const SEEN_SLOTS = new Set();

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDate(text, fallbackYear) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const dotted = normalized.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})?\b/);
  if (dotted) {
    return new Date(Number(dotted[3] || fallbackYear), Number(dotted[2]) - 1, Number(dotted[1]));
  }

  const slash = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})?\b/);
  if (slash) {
    return new Date(Number(slash[3] || fallbackYear), Number(slash[2]) - 1, Number(slash[1]));
  }

  return null;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWithinWindow(date, minDate, maxDate) {
  const day = startOfLocalDay(date);
  return day >= minDate && day <= maxDate;
}

async function ensureDebugDir() {
  await mkdir(CONFIG.debugDir, { recursive: true });
}

async function dumpDiagnostics(page, label) {
  await ensureDebugDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(CONFIG.debugDir, `${ts}-${label}.png`);
  const htmlPath = path.join(CONFIG.debugDir, `${ts}-${label}.html`);
  const optionsPath = path.join(CONFIG.debugDir, `${ts}-${label}.json`);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  const options = await page.evaluate(() => Array.from(document.querySelectorAll("button, a, li, [role='option']"))
    .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean));

  await writeFile(htmlPath, html, "utf8").catch(() => {});
  await writeFile(optionsPath, JSON.stringify(options.slice(0, 250), null, 2), "utf8").catch(() => {});
  console.log(`[DEBUG] Wrote diagnostics to ${CONFIG.debugDir}`);
}

async function clickMatchingOption(page, patterns, description) {
  console.log(`[INFO] Selecting ${description}`);
  for (const pattern of patterns) {
    const locator = page.locator("li[role='option'], [role='option']").filter({ hasText: pattern }).first();
    if (await locator.count()) {
      const text = ((await locator.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      console.log(`[INFO] Found ${description} option: ${text}`);
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(1_000);
      return text;
    }
  }

  for (const pattern of patterns) {
    const fallback = page.locator("button, a").filter({ hasText: pattern }).first();
    if (await fallback.count()) {
      const text = ((await fallback.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      console.log(`[INFO] Found ${description} fallback option: ${text}`);
      await fallback.evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(1_000);
      return text;
    }
  }

  return null;
}

async function openDropdownAndPick(page, buttonTextPattern, optionTextPatterns, description) {
  const trigger = page.locator("button, [role='button']").filter({ hasText: buttonTextPattern }).first();
  if (await trigger.count()) {
    await trigger.click();
    await page.waitForTimeout(1_000);
  }

  const selectedText = await clickMatchingOption(page, optionTextPatterns, description);
  if (!selectedText) {
    await dumpDiagnostics(page, description.replace(/\s+/g, "-").toLowerCase());
    throw new Error(`Could not find ${description}`);
  }
  return selectedText;
}

async function waitForSearchButton(page) {
  const button = page.locator("button, [role='button']").filter({ hasText: CONFIG.searchButtonTextPatterns[0] }).first();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const visible = await button.isVisible().catch(() => false);
    const enabled = await button.isEnabled().catch(() => false);
    if (visible && enabled) {
      return button;
    }
    await page.waitForTimeout(750);
  }
  return button;
}

async function selectBookingFlow(page, office) {
  console.log("[INFO] Opening Migri page");
  await page.goto(CONFIG.bookingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  await openDropdownAndPick(page, /palvelukategoria/i, CONFIG.categoryTextPatterns, "service category");
  await openDropdownAndPick(page, /palvelu/i, CONFIG.serviceTextPatterns, "service");
  const applicantOption = page.locator("button, a, li, [role='option']").filter({ hasText: CONFIG.applicantTextPatterns[0] }).first();
  if (await applicantOption.count()) {
    const applicantText = ((await applicantOption.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    console.log(`[INFO] Found applicant count option: ${applicantText}`);
    await applicantOption.click({ force: true });
    await page.waitForTimeout(1_000);
  } else {
    console.log("[INFO] Applicant count control not present; continuing with the next step.");
  }

  const officeText = await openDropdownAndPick(page, /toimipiste/i, [office.optionPattern], `service point (${office.name})`);
  office.selectedText = officeText;

  const dayViewToggle = page.locator("button, [role='button'], label, input").filter({ hasText: /näytä vapaat ajat päivä kerrallaan|view available times by day/i }).first();
  if (await dayViewToggle.count()) {
    console.log("[INFO] Enabling day view for available times");
    await dayViewToggle.evaluate((element) => {
      if (element instanceof HTMLInputElement) {
        element.checked = true;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
    });
    await page.waitForTimeout(2_000);
  }

  const searchButton = await waitForSearchButton(page);
  console.log(`[INFO] Searching appointments for ${office.name}`);
  if (await searchButton.count()) {
    await searchButton.click({ force: true });
  } else {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find((element) => /hae\s+vapaat\s+ajat|search/i.test(element.textContent || ""));
      if (button) {
        button.click();
      }
    });
  }
  await page.waitForTimeout(4_000);
}

async function extractSlotsFromCurrentWeek(page, office, minDate, maxDate) {
  const slots = [];

  const pageState = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const dayButton = buttons.find((button) => {
      const text = (button.textContent || "").replace(/\s+/g, " ").trim();
      return /^(ma|ti|ke|to|pe|la|su)\s+\d{1,2}\.\d{1,2}\.?$/i.test(text) && (button.getAttribute("aria-pressed") === "true" || button.classList.contains("active"));
    });

    const headingDate = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span, p, button"))
      .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
      .find((text) => /vapaat ajat/i.test(text) && /\d{1,2}\.\d{1,2}\.\d{4}/.test(text));

    const slotButtons = buttons.map((button) => ({
      text: (button.textContent || "").replace(/\s+/g, " ").trim(),
      aria: button.getAttribute("aria-label") || "",
      title: button.getAttribute("title") || "",
    })).filter(({ text, aria, title }) => {
      const combined = `${text} ${aria} ${title}`;
      return /^\d{1,2}\.\d{2}$/.test(text) || (/\d{1,2}\.\d{2}/.test(combined) && /kello/i.test(combined));
    });

    return { dayButtonText: dayButton ? (dayButton.textContent || "").replace(/\s+/g, " ").trim() : null, headingDate, slotButtons };
  });

  const selectedDate = (() => {
    const headingMatch = pageState.headingDate?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (headingMatch) {
      return parseDate(`${headingMatch[1]}.${headingMatch[2]}.${headingMatch[3]}`, new Date().getFullYear());
    }

    const dayMatch = pageState.dayButtonText?.match(/(\d{1,2})\.(\d{1,2})\.?/);
    if (dayMatch) {
      return parseDate(`${dayMatch[1]}.${dayMatch[2]}.${new Date().getFullYear()}`, new Date().getFullYear());
    }

    return null;
  })();

  if (selectedDate && isWithinWindow(selectedDate, minDate, maxDate)) {
    const iso = toIsoDate(selectedDate);
    for (const slotButton of pageState.slotButtons) {
      const timeMatch = slotButton.text.match(/^(\d{1,2}\.\d{2})$/);
      const time = timeMatch ? timeMatch[1] : null;
      if (!time) continue;

      const key = `${office.name}:${iso}:${time}`;
      if (SEEN_SLOTS.has(key)) continue;
      SEEN_SLOTS.add(key);

      slots.push({ office: office.name, location: office.selectedText || office.name, date: iso, time, source: `${pageState.headingDate || ""} ${slotButton.text}` });
    }
  }

  const rows = await page.locator("button, [role='button'], a").evaluateAll((elements) => elements.map((element) => ({
    text: (element.textContent || "").replace(/\s+/g, " ").trim(),
    aria: element.getAttribute("aria-label") || "",
    title: element.getAttribute("title") || "",
  })));

  for (const row of rows) {
    const combined = `${row.text} ${row.aria} ${row.title}`;
    if (!/\d{1,2}:\d{2}/.test(combined)) continue;
    const timeMatch = combined.match(/(\d{1,2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : null;
    const dateMatch = combined.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})?\b/);
    if (!dateMatch || !time) continue;

    const date = parseDate(`${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3] || new Date().getFullYear()}`, new Date().getFullYear());
    if (!date || !isWithinWindow(date, minDate, maxDate)) continue;

    const iso = toIsoDate(date);
    const key = `${office}:${iso}:${time}`;
    if (SEEN_SLOTS.has(key)) continue;
    SEEN_SLOTS.add(key);

    slots.push({ office, date: iso, time, source: combined });
  }

  const nextAvailableText = await page.locator("body").innerText().catch(() => "");
  const nextMatch = nextAvailableText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (nextMatch) {
    const candidateDate = parseDate(`${nextMatch[1]}.${nextMatch[2]}.${nextMatch[3]}`, new Date().getFullYear());
    if (candidateDate && isWithinWindow(candidateDate, minDate, maxDate)) {
      const availableDate = toIsoDate(candidateDate);
      slots.push({ office, date: availableDate, time: "next available", source: nextAvailableText.slice(0, 200) });
    }
  }

  return slots;
}

async function scanWeeks(page, office, minDate, maxDate) {
  const found = [];
  for (let weekStep = 0; weekStep < 4; weekStep += 1) {
    console.log(`[INFO] Scanning week ${weekStep + 1} for ${office.name}`);
    const weekSlots = await extractSlotsFromCurrentWeek(page, office, minDate, maxDate);
    found.push(...weekSlots);

    if (weekStep < 3) {
      const nextWeekButton = page.locator("button, [role='button']").filter({ hasText: /next|seuraava|vk/i }).first();
      if (await nextWeekButton.count()) {
        try {
          await nextWeekButton.click({ force: true });
          await page.waitForTimeout(3_000);
        } catch {
          console.log("[INFO] Week navigation button not available; stopping at current results page.");
          break;
        }
      }
    }
  }

  return found;
}

async function sendEmail({ office, slots }) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_TO_EMAIL } = process.env;

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would send email for ${office} with ${slots.length} slot(s)`);
    return;
  }

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ALERT_TO_EMAIL) {
    throw new Error("Missing email environment variables. Set GMAIL_USER, GMAIL_APP_PASSWORD, and ALERT_TO_EMAIL, or run with DRY_RUN=true.");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const message = slots.map((slot) => `- ${slot.office}: ${slot.date} ${slot.time} (${slot.source.trim()})`).join("\n");
  await transporter.sendMail({
    from: `Migri checker <${GMAIL_USER}>`,
    to: ALERT_TO_EMAIL,
    subject: `Migri available slots for ${office}`,
    text: [
      `Found ${slots.length} appointment slot(s) for ${office}:`,
      message,
      "",
      "This checker only reports availability and does not book anything.",
    ].join("\n"),
  });
}

async function main() {
  const today = startOfLocalDay();
  const targetDate = addDays(today, 21);
  const minDate = addDays(today, 7);
  const maxDate = addDays(today, LOOKAHEAD_DAYS);
  console.log(`[INFO] Checking appointments from ${formatDate(minDate)} to ${formatDate(maxDate)}`);
  console.log(`[INFO] Alerting only for slots on ${formatDate(targetDate)} (3 weeks from today)`);

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO_MS });
  try {
    const context = await browser.newContext({ locale: "en-GB", timezoneId: "Europe/Helsinki", viewport: { width: 1600, height: 1200 } });
    const page = await context.newPage();

    const allSlots = [];
    for (const office of CONFIG.targetOffices) {
      try {
        await selectBookingFlow(page, office);
        const officeSlots = await scanWeeks(page, office, minDate, maxDate);
        allSlots.push(...officeSlots);
      } catch (error) {
        console.log(`[WARN] Could not complete check for ${office.name}: ${error.message}`);
      }
    }

    const thresholdDate = startOfLocalDay(targetDate);
    const matchingSlots = allSlots.filter((slot) => startOfLocalDay(new Date(slot.date)) <= thresholdDate);
    if (matchingSlots.length > 0) {
      console.log(`[INFO] Found ${matchingSlots.length} slot(s) within 3 weeks (${formatDate(targetDate)})`);
      await sendEmail({ office: CONFIG.targetOffices.map((item) => item.name).join(", "), slots: matchingSlots });
    } else if (allSlots.length > 0) {
      console.log(`[INFO] Found ${allSlots.length} slot(s), but none are within 3 weeks (${formatDate(targetDate)})`);
    } else {
      console.log("[INFO] No matching slots found");
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
