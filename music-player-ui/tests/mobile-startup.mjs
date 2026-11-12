import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const mobile of [true, false]) {
    const context = await browser.newContext({ viewport: { width: mobile ? 360 : 1440, height: 800 },
      userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' : undefined });
    const page = await context.newPage();
    await page.route(url => url.pathname === '/src/main.tsx', route => route.abort());
    await page.goto(base);
    assert.equal(await page.locator('.mobile-launch').isVisible(), mobile, 'Pre-React launch screen is mobile only');
    if (mobile) {
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
      await page.evaluate(() => localStorage.setItem('dmex_mobile_appearance', 'light'));
      await page.reload();
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage();
  await page.goto(base + '/tests/mobile-redesign.html?mobile&slow-library&strict');
  await page.getByRole('status', { name: 'Loading music library' }).waitFor();
  assert.equal(await page.getByText('No tracks here yet', { exact: true }).count(), 0, 'No false empty-library flash while the database loads');
  await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
  assert.equal(await page.getByRole('status', { name: 'Loading music library' }).count(), 0);
  assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'fetch_library').length), 1, 'StrictMode boot shares one pending library request');
  await page.goto(base + '/tests/mobile-redesign.html?mobile&library-failure');
  await page.getByRole('heading', { name: 'Library unavailable', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add music', exact: true }).count(), 0, 'Failed load is not presented as an empty library');
  await page.getByRole('button', { name: 'Retry loading library', exact: true }).click();
  await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
  await context.close();
  console.log('PASS startup: mobile-only immediate launch screen, saved light/dark colors, slow-library loading state without false empty content');
} finally { await browser.close(); }
