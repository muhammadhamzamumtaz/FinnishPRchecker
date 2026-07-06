import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto('https://migri.vihta.com/public/migri/#/reservation', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

const clickText = async (pattern, description) => {
  const locator = page.locator('button, a, li, [role="option"], [role="button"]').filter({ hasText: pattern });
  const count = await locator.count();
  console.log(description, 'matches', count);
  for (let i = 0; i < count; i += 1) {
    const txt = (await locator.nth(i).textContent()).replace(/\s+/g, ' ').trim();
    console.log('  ', i, JSON.stringify(txt));
  }
  if (count > 0) {
    await locator.first().click();
    await page.waitForTimeout(2000);
  }
};

await clickText(/palvelukategoria/i, 'category trigger');
await clickText(/oleskelulupa/i, 'category option');
await clickText(/palvelu/i, 'service trigger');
await clickText(/pysyv/i, 'service option');
await clickText(/1 henkil|1 person/i, 'applicant option');
await clickText(/toimipiste/i, 'office trigger');
await clickText(/helsinki|malmi/i, 'office option');
await clickText(/hae vapaat ajat|search/i, 'search button');
await page.waitForTimeout(8000);
console.log('BODY TEXT');
console.log((await page.locator('body').innerText()).slice(0, 12000));
console.log('BUTTONS');
const buttons = page.locator('button');
for (let i = 0; i < await buttons.count(); i += 1) {
  const txt = (await buttons.nth(i).textContent()).replace(/\s+/g, ' ').trim();
  if (txt) console.log(i, JSON.stringify(txt));
}

await browser.close();
