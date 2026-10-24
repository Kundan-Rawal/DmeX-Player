import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
try {
  for (const width of [320, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/library-workflows.html?filters', { waitUntil: 'domcontentloaded' });
    await page.locator('.track-item').first().click();
    await page.locator('.mini-player-content .track-info').waitFor();
    assert.equal(await page.locator('.mep-root .ambient-background').count(), 0);
    await page.locator('.mini-player-content .track-info').click();
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.expanded-player-content').getAttribute('data-ready'), 'false');
    assert.equal(await page.locator('.mep-root .ambient-background').count(), 0, 'Heavy visualizer must wait for expansion');
    await page.waitForFunction(() => document.querySelector('.expanded-player-content').dataset.ready === 'true');
    await page.locator('.mep-root .ambient-background').waitFor();
    await page.waitForTimeout(230);
    const controls = await page.locator('.mep-controls-zone').boundingBox();
    assert.ok(controls && controls.width > 0);
    await page.screenshot({ path: `tests/artifacts/expanded-transition-${width}.png` });
    await page.locator('.mep-topbar').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.expanded-player-content').getAttribute('aria-hidden') === 'true');
    assert.equal(await page.locator('.mep-root .ambient-background').count(), 0);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.mini-player-content').evaluate(node => getComputedStyle(node).opacity), '1');
    await page.locator('.mini-player-content .track-info').click();
    await page.waitForTimeout(50); await page.evaluate(() => history.back());
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.mep-root .ambient-background').count(), 0, 'Canceled opening must not restart hidden visuals');
    assert.deepEqual(errors, []);
    console.log(`PASS mobile ${width}: deferred visuals, stable expansion, smooth close and canceled opening`);
    await context.close();
  }
} finally { await browser.close(); }
