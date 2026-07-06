import { chromium } from 'playwright';

async function clickByText(page, textPattern, description) {
  const locator = page.locator('button, [role="button"], li[role="option"], [role="option"], a, label').filter({ hasText: textPattern }).first();
  if (await locator.count()) {
    const text = ((await locator.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    console.log(`[INFO] Clicking ${description}: ${text}`);
    await locator.click({ force: true });
    await page.waitForTimeout(1000);
    return true;
  }
  console.log(`[INFO] No ${description} found`);
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/Helsinki', viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('reservation') || url.includes('slot') || url.includes('available') || url.includes('api') || request.resourceType() === 'fetch') {
      console.log('[REQ]', request.method(), request.resourceType(), url);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('reservation') || url.includes('slot') || url.includes('available') || url.includes('api') || response.request().resourceType() === 'fetch') {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          const body = await response.text();
          console.log('[RES]', response.status(), url, body.slice(0, 1000));
        } catch {
          console.log('[RES]', response.status(), url, '<unreadable>');
        }
      }
    }
  });

  await page.goto('https://migri.vihta.com/public/migri/#/reservation', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  const bodyTextInitial = await page.locator('body').innerText();
  console.log('[BODY INITIAL]', bodyTextInitial.slice(0, 4000));

  await clickByText(page, /palvelukategoria/i, 'service category');
  await clickByText(page, /oleskelulupa/i, 'oleskelulupa option');
  await clickByText(page, /palvelu/i, 'service');
  await clickByText(page, /pysyv/i, 'pysyv option');

  const applicant = page.locator('button, [role="button"], li[role="option"], [role="option"], a, label').filter({ hasText: /1\s*(henkilo|person)/i }).first();
  if (await applicant.count()) {
    console.log('[INFO] Clicking applicant option');
    await applicant.click({ force: true });
    await page.waitForTimeout(1000);
  }

  await clickByText(page, /toimipiste/i, 'service point');
  await clickByText(page, /rovaniemi|roveniemi/i, 'rovaniemi option');

  const dayToggle = page.locator('button, [role="button"], label, input').filter({ hasText: /näytä vapaat ajat päivä kerrallaan|view available times by day/i }).first();
  if (await dayToggle.count()) {
    console.log('[INFO] Toggling day view');
    await dayToggle.evaluate((element) => {
      if (element instanceof HTMLInputElement) {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
    await page.waitForTimeout(2000);
  }

  const searchButton = page.locator('button, [role="button"]').filter({ hasText: /hae\s+vapaat\s+ajat|search/i }).first();
  if (await searchButton.count()) {
    console.log('[INFO] Clicking search button');
    await searchButton.click({ force: true });
  }

  await page.waitForTimeout(10000);
  const bodyTextAfter = await page.locator('body').innerText();
  console.log('[BODY AFTER]', bodyTextAfter.slice(0, 12000));

  const dateLike = (await page.locator('body').innerText()).match(/\b\d{1,2}\.\d{1,2}(?:\.\d{4})?\b/g) || [];
  console.log('[DATE LIKE]', dateLike.slice(0, 200));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
