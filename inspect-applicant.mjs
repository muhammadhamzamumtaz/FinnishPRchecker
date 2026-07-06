import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('https://migri.vihta.com/public/migri/#/reservation', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

const selectCategory = page.locator('button, [role="button"]').filter({ hasText: /palvelukategoria/i }).first();
await selectCategory.click();
await page.waitForTimeout(1000);
await page.locator('li[role="option"]').filter({ hasText: /oleskelulupa/i }).first().click({ force: true });
await page.waitForTimeout(2000);

const selectService = page.locator('button, [role="button"]').filter({ hasText: /palvelu/i }).first();
await selectService.click();
await page.waitForTimeout(1000);
await page.locator('li[role="option"]').filter({ hasText: /pysyv/i }).first().click({ force: true });
await page.waitForTimeout(2000);

const applicantButtons = page.locator('button, [role="button"], a, li');
for (let i = 0; i < await applicantButtons.count(); i += 1) {
  const text = (await applicantButtons.nth(i).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (/henkilo|person|1|2|3|4|5|6/i.test(text)) {
    console.log(i, JSON.stringify(text));
  }
}

const applicantTrigger = page.locator('button, [role="button"]').filter({ hasText: /henkilo|person/i }).first();
console.log('trigger visible', await applicantTrigger.isVisible().catch(() => false));
if (await applicantTrigger.isVisible().catch(() => false)) {
  await applicantTrigger.click();
  await page.waitForTimeout(1500);
  const texts = await page.evaluate(() => Array.from(document.querySelectorAll('li[role="option"], button, a')).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  console.log(texts.slice(0, 200));
}

await page.screenshot({ path: 'applicant-debug.png', fullPage: true });
await browser.close();
