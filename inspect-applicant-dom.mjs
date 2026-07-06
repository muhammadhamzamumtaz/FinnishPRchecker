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

const elements = page.locator('*').filter({ hasText: /1\s*henkilo/i });
console.log('matches', await elements.count());
for (let i = 0; i < await elements.count(); i += 1) {
  const e = elements.nth(i);
  const text = (await e.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
  const tag = await e.evaluate((el) => el.tagName.toLowerCase());
  const role = await e.getAttribute('role').catch(() => '');
  const aria = await e.getAttribute('aria-label').catch(() => '');
  const classes = await e.getAttribute('class').catch(() => '');
  const html = (await e.evaluate((el) => el.outerHTML)).slice(0, 500);
  console.log('---', i, tag, role, JSON.stringify(text));
  console.log(html);
}

await browser.close();
