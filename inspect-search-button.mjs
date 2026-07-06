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

const selectOffice = page.locator('button, [role="button"]').filter({ hasText: /toimipiste/i }).first();
await selectOffice.click();
await page.waitForTimeout(1000);
await page.locator('li[role="option"]').filter({ hasText: /helsinki|malmi/i }).first().click({ force: true });
await page.waitForTimeout(2000);

const button = page.locator('button, [role="button"]').filter({ hasText: /hae\s+vapaat\s+ajat|search/i }).first();
console.log('count', await button.count());
console.log('text', await button.textContent().catch(() => ''));
console.log('visible', await button.isVisible().catch(() => false));
console.log('enabled', await button.isEnabled().catch(() => false));
console.log('boundingBox', await button.boundingBox().catch(() => null));
console.log('outerHTML', await button.evaluate((el) => el.outerHTML).catch(() => ''));
await page.screenshot({ path: 'search-button-debug.png', fullPage: true });
await browser.close();
