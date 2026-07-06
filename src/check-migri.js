import { chromium } from "playwright";
import nodemailer from "nodemailer";

/**
 * MIGRI APPOINTMENT CHECKER CONFIGURATION
 *
 * The Migri booking site is an Angular single-page app. Its labels, roles, and
 * calendar markup can change without notice, so treat this section as the first
 * place to adjust after a headed calibration run.
 */
const CONFIG = {
  bookingUrl: "https://migri.vihta.com/public/migri/#/reservation",

  // Booking flow labels. Adjust these if the UI text differs on first run.
  categoryText: "Residence permit",
  subCategoryText: "Permanent residence permit",
  officesInPriorityOrder: [
    "Helsinki",
    "Turku",
    "Tampere",
    "Lahti",
    "Lappeenranta"
  ],

  // Date window: open appointment slots from 1 week through 3 weeks from today.
  minDaysFromToday: 7,
  maxDaysFromToday: 21,

  /**
   * Calendar detection settings.
   *
   * These are deliberately centralized because the live site's exact DOM must be
   * confirmed with Playwright in headed mode. The default logic tries accessible
   * buttons/links first, then common calendar/time-slot CSS class names.
   */
  calendar: {
    nextMonthButtonNames: [/next/i, /seuraava/i],
    candidateSlotSelector:
      [
        "button:not([disabled])",
        "a[href]",
        "[role='button']:not([aria-disabled='true'])",
        ".available",
        ".free",
        ".open",
        ".time-slot",
        ".timeslot",
        ".appointment",
      ].join(", "),
    unavailableTextPatterns: [
      /no appointments/i,
      /not available/i,
      /fully booked/i,
      /ei vapaita/i,
      /ei aikoja/i,
      /varattu/i,
    ],
  },

  // Local troubleshooting helpers.
  debugScreenshots: process.env.DEBUG_SCREENSHOTS === "true",
  debugScreenshotDir: "debug-screenshots",
};

const HEADLESS = process.env.HEADLESS !== "false";
const SLOW_MO_MS = Number(process.env.SLOW_MO_MS ?? 0);
const DRY_RUN = process.env.DRY_RUN === "true";

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

function isWithinWindow(date, minDate, maxDate) {
  const day = startOfLocalDay(date);
  return day >= minDate && day <= maxDate;
}

async function clickByText(page, label, description) {
  const exactRoleLocator = page
    .getByRole("button", { name: label, exact: true })
    .or(page.getByRole("link", { name: label, exact: true }))
    .or(page.getByRole("option", { name: label, exact: true }));

  if (await exactRoleLocator.first().isVisible().catch(() => false)) {
    await exactRoleLocator.first().click();
    return;
  }

  const textLocator = page.getByText(label, { exact: true });
  if (await textLocator.first().isVisible().catch(() => false)) {
    await textLocator.first().click();
    return;
  }

  throw new Error(
    `Could not find ${description} with text "${label}". Run HEADLESS=false and adjust CONFIG labels/selectors.`,
  );
}

async function maybeClickByText(page, label) {
  const locator = page
    .getByRole("button", { name: label, exact: true })
    .or(page.getByRole("link", { name: label, exact: true }))
    .or(page.getByText(label, { exact: true }));

  if (await locator.first().isVisible().catch(() => false)) {
    await locator.first().click();
    return true;
  }
  return false;
}

async function selectBookingFlow(page, office) {
  await page.goto(CONFIG.bookingUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  await clickByText(page, CONFIG.categoryText, "category");
  await page.waitForTimeout(800);

  await clickByText(page, CONFIG.subCategoryText, "sub-category");
  await page.waitForTimeout(800);

  await clickByText(page, office, "office/location");
  await page.waitForTimeout(1_500);

  // Some Vihta flows have an explicit continue/search step after choices.
  for (const label of ["Search", "Continue", "Next", "Hae", "Jatka", "Seuraava"]) {
    if (await maybeClickByText(page, label)) {
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      break;
    }
  }
}

async function readCandidateSlots(page, minDate, maxDate) {
  const yearHint = new Date().getFullYear();

  return page.locator(CONFIG.calendar.candidateSlotSelector).evaluateAll(
    (elements, args) => {
      const { yearHint: browserYearHint, minTime, maxTime } = args;

      function parseDate(text) {
        const normalized = text.replace(/\s+/g, " ").trim();
        const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
        if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

        const dotted = normalized.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})?\b/);
        if (dotted) {
          return new Date(
            Number(dotted[3] || browserYearHint),
            Number(dotted[2]) - 1,
            Number(dotted[1]),
          );
        }

        const slash = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})?\b/);
        if (slash) {
          return new Date(
            Number(slash[3] || browserYearHint),
            Number(slash[2]) - 1,
            Number(slash[1]),
          );
        }

        return null;
      }

      function toLocalIsoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }

      return elements
        .map((element) => {
          const aria = element.getAttribute("aria-label") || "";
          const title = element.getAttribute("title") || "";
          const datetime = element.getAttribute("datetime") || "";
          const dataDate = element.getAttribute("data-date") || "";
          const text = element.textContent || "";
          const combined = [aria, title, datetime, dataDate, text].filter(Boolean).join(" ");
          const date = parseDate(combined);

          if (!date || date.getTime() < minTime || date.getTime() > maxTime) return null;

          return {
            dateIso: toLocalIsoDate(date),
            label: combined.replace(/\s+/g, " ").trim(),
          };
        })
        .filter(Boolean);
    },
    {
      yearHint,
      minTime: minDate.getTime(),
      maxTime: maxDate.getTime(),
    },
  );
}

async function goToNextCalendarPage(page) {
  for (const name of CONFIG.calendar.nextMonthButtonNames) {
    const button = page.getByRole("button", { name });
    if (await button.first().isVisible().catch(() => false)) {
      await button.first().click();
      await page.waitForTimeout(1_500);
      return true;
    }
  }
  return false;
}

async function findSlotsForOffice(page, office, minDate, maxDate) {
  await selectBookingFlow(page, office);

  const pageText = await page.locator("body").innerText().catch(() => "");
  if (CONFIG.calendar.unavailableTextPatterns.some((pattern) => pattern.test(pageText))) {
    console.log(`[${office}] Calendar reports no availability.`);
  }

  const found = [];
  for (let calendarPage = 0; calendarPage < 3; calendarPage += 1) {
    const slots = await readCandidateSlots(page, minDate, maxDate);
    found.push(...slots);

    if (found.length > 0) break;

    // The search window is only 1-3 weeks out, but one next-page click helps if
    // the current calendar is positioned at the end of a month.
    const moved = await goToNextCalendarPage(page);
    if (!moved) break;
  }

  const uniqueByDate = new Map();
  for (const slot of found) {
    if (!uniqueByDate.has(slot.dateIso)) uniqueByDate.set(slot.dateIso, slot);
  }

  return [...uniqueByDate.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

async function sendEmail({ office, slots }) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_TO_EMAIL } = process.env;

  if (DRY_RUN) {
    console.log(`[${office}] Dry run enabled. Would send an email with ${slots.length} slot(s).`);
    return;
  }

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ALERT_TO_EMAIL) {
    throw new Error(
      "Missing email environment variables. Set GMAIL_USER, GMAIL_APP_PASSWORD, and ALERT_TO_EMAIL, or run with DRY_RUN=true.",
    );
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  const dates = slots.map((slot) => `- ${slot.dateIso}: ${slot.label}`).join("\n");

  await transporter.sendMail({
    from: `Migri appointment checker <${GMAIL_USER}>`,
    to: ALERT_TO_EMAIL,
    subject: `Migri appointment available: ${office}`,
    text: [
      `An open Migri appointment slot was found for ${office}.`,
      "",
      "Dates found:",
      dates,
      "",
      `Booking page: ${CONFIG.bookingUrl}`,
      "",
      "This tool only checks availability and does not attempt to book an appointment.",
    ].join("\n"),
  });
}

async function main() {
  const today = startOfLocalDay();
  const minDate = addDays(today, CONFIG.minDaysFromToday);
  const maxDate = addDays(today, CONFIG.maxDaysFromToday);

  console.log(
    `Checking Migri appointments from ${formatDate(minDate)} to ${formatDate(maxDate)}.`,
  );

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO_MS,
  });

  try {
    const context = await browser.newContext({
      locale: "en-GB",
      timezoneId: "Europe/Helsinki",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();

    for (const office of CONFIG.officesInPriorityOrder) {
      console.log(`[${office}] Checking availability...`);
      const slots = await findSlotsForOffice(page, office, minDate, maxDate);

      if (slots.length > 0) {
        console.log(`[${office}] Found ${slots.length} matching date(s). Sending email.`);
        await sendEmail({ office, slots });
        console.log(`[${office}] Email alert sent. Stopping priority search.`);
        return;
      }

      console.log(`[${office}] No matching slots found.`);
    }

    console.log("Check ran successfully. No matching appointment slots found; no email sent.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
