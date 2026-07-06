import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.goto('https://migri.vihta.com/public/migri/#/reservation', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);

const categoryButton = page.getByRole('button', { name: /palvelukategoria/i }).first();
console.log('button visible', await categoryButton.isVisible().catch(() => false));
if (await categoryButton.isVisible().catch(() => false)) {
  await categoryButton.click();
  await page.waitForTimeout(3000);
  const menuTexts = await page.evaluate(() => Array.from(document.querySelectorAll('li[role="option"], li, a, button'))
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));
  const filtered = [...new Set(menuTexts)].filter((text) => /residence|permit|oleskelu|pysyvä|permanent|palvelukategoria|palvelu|toimipiste|hakemus|varaa/i.test(text));
  console.log(filtered.slice(0, 200).join('\n'));
}

await browser.close();
