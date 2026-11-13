import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
const sameBounds = (actual, expected, message) => assert.ok(['x', 'y', 'width', 'height'].every(key => Math.abs(actual[key] - expected[key]) < .1), message);
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/mobile-redesign.html?mobile');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.mep-root')?.dataset.visualsReady === 'true');
    await page.waitForFunction(() => Math.abs(document.querySelector('.mep-root').getBoundingClientRect().top) < .1);
    const art = await page.locator('.mep-art').boundingBox(), controls = await page.locator('.mep-controls-zone').boundingBox();
    assert.ok(Math.abs(art.width - 250) < .1 && Math.abs(art.height - 250) < .1 && Math.abs(art.x - viewport.width / 2 + 125) < .1);
    assert.equal(controls.width, viewport.width);
    assert.equal(await page.locator('.mep-actions').getByRole('button', { name: 'Lyrics', exact: true }).count(), 0);
    assert.equal(await page.locator('[data-lyrics-status="missing"]').innerText(), 'No synced lyrics');
    await page.getByRole('button', { name: 'Open lyrics', exact: true }).click();
    await page.getByRole('button', { name: 'Fetch Lyrics Online', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    sameBounds(await page.locator('.mep-art').boundingBox(), art, 'Lyrics return preserves artwork bounds');
    await page.getByRole('button', { name: 'Play queue', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Expanded play queue', exact: true });
    await queue.waitFor();
    assert.equal(await queue.locator('.dmex-mobile-queue-spacer').getAttribute('data-count'), '80');
    assert.ok(await queue.locator('.dmex-mobile-queue-row').count() < 30, 'Expanded queue stays virtualized');
    assert.equal(await page.locator('.bottom-player').getAttribute('class'), 'bottom-player expanded', 'Queue stays inside the expanded player');
    assert.ok(await queue.evaluate(el => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(el).backgroundColor; ctx.fillRect(0, 0, 1, 1); return ctx.getImageData(0, 0, 1, 1).data[3] < 13; }), 'Queue has no opaque background');
    const queueControls = await page.locator('.mep-controls-zone').boundingBox();
    await page.screenshot({ path: `tests/artifacts/mobile-expanded-queue-${viewport.width}.png` });
    const cdp = await context.newCDPSession(page), handle = queue.getByRole('button', { name: 'Drag to reorder Paper Lanterns 2', exact: true });
    assert.equal(await handle.evaluate(el => getComputedStyle(el).touchAction), 'none');
    const rect = await handle.boundingBox(), point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 76 * step / 6 }] });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries[2].track.name === 'Paper Lanterns 2');
    await queue.getByRole('button', { name: 'Options for queued Paper Lanterns 2', exact: true }).click();
    const outerClose = await page.getByRole('button', { name: 'Close panel', exact: true }).boundingBox();
    const menuClose = await queue.getByRole('button', { name: 'Close queue options', exact: true }).boundingBox();
    assert.ok(menuClose.y >= outerClose.y + outerClose.height, 'Queue options do not overlap the panel close control');
    await queue.getByRole('button', { name: 'Move down', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries[3].track.name === 'Paper Lanterns 2');
    await page.getByRole('button', { name: 'DSP Controls', exact: true }).click();
    await page.getByRole('heading', { name: 'Fine-Tune DSP', exact: true }).waitFor();
    const dspControls = await page.locator('.mep-controls-zone').boundingBox();
    assert.ok(Math.abs(queueControls.y - dspControls.y) <= 1, 'Embedded queue uses the existing DSP panel space');
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    sameBounds(await page.locator('.mep-art').boundingBox(), art, 'Panel switches do not resize artwork');
    await page.getByRole('button', { name: 'Play queue', exact: true }).click();
    await queue.getByRole('button', { name: 'Play queued Open Water 3', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.mep-queue .is-current strong')?.textContent === 'Open Water 3');
    const order = await page.evaluate(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries.map(entry => entry.id));
    await page.locator('.mep-topbar').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Open play queue', exact: true }).click();
    assert.equal(await page.locator('.dmex-mobile-queue-spacer').getAttribute('data-count'), '80');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries.map(entry => entry.id)), order, 'Standalone and expanded views share one queue');
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: original art/control bounds, album-art lyrics access, transparent embedded queue, touch reorder, queue actions and shared state`);
    await context.close();
  }
} finally { await browser.close(); }
