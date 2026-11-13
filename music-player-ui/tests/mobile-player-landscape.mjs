import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
const same = (a, b, message) => assert.ok(['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < .2), message);
const center = (rect, viewport) => {
  assert.ok(Math.abs(rect.x + rect.width / 2 - viewport.width / 2) < .2, 'Artwork horizontally centered');
  assert.ok(Math.abs(rect.y + rect.height / 2 - viewport.height / 2) < .2, 'Artwork vertically centered');
};
const inside = (rect, viewport, name) => assert.ok(rect && rect.x >= -.2 && rect.y >= -.2 && rect.x + rect.width <= viewport.width + .2 && rect.y + rect.height <= viewport.height + .2, `${name} stays onscreen: ${JSON.stringify(rect)}`);
const canvasSignature = page => page.evaluate(() => {
  const canvas = document.querySelector('.mep-root canvas');
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0, hash = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { lit++; hash = (hash + i * pixels[i]) % 2147483647; }
  return { lit, hash, width: canvas.width, height: canvas.height };
});
try {
  for (const viewport of [{ width: 640, height: 320 }, { width: 800, height: 360 }, { width: 915, height: 412 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/player-visualizers.html?player');
    await page.locator('.mep-art').waitFor();
    await page.waitForTimeout(500);
    const art = await page.locator('.mep-art').boundingBox();
    center(art, viewport);
    for (const selector of ['.mep-track-details', '.mep-controls-zone', '.mep-actions button', '.mep-playback button', '.mep-seek-bar', '.mep-topbar-btn']) {
      for (const rect of await page.locator(selector).evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))) inside(rect, viewport, selector);
    }
    const controls = await page.locator('.mep-controls-zone').boundingBox();
    assert.ok(controls.x >= art.x + art.width + 15, 'Controls do not overlap artwork');
    await page.waitForFunction(() => [...document.querySelectorAll('.mep-neon-ripple')].some(n => getComputedStyle(n).animationName === 'mep-neon-expand' && Number(getComputedStyle(n).opacity) > .1));
    assert.ok(await page.locator('.mep-neon-ripple').evaluateAll(nodes => {
      const art = document.querySelector('.mep-art').getBoundingClientRect();
      return nodes.every(n => { const r = n.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - art.x - art.width / 2) < .1 && Math.abs(r.y + r.height / 2 - art.y - art.height / 2) < .1; });
    }), 'Animated ripple centers exactly match artwork');
    const before = await canvasSignature(page);
    await page.waitForTimeout(150);
    const after = await canvasSignature(page);
    assert.ok(before.lit > 0 && after.lit > 0 && before.hash !== after.hash, 'Dust canvas is nonblank and moving');
    await page.getByRole('button', { name: 'Open lyrics', exact: true }).click();
    await page.getByText('First lyric', { exact: true }).waitFor();
    same(await page.locator('.mep-art').boundingBox(), art, 'Lyrics keep artwork centered');
    same(await page.locator('.mep-controls-zone').boundingBox(), controls, 'Lyrics keep controls fixed');
    const panel = await page.locator('.mep-panel').boundingBox();
    assert.ok(panel.x + panel.width <= art.x - 15, 'Panel does not overlap cover');
    await page.getByRole('button', { name: 'DSP Controls', exact: true }).click();
    await page.getByRole('heading', { name: 'Fine-Tune DSP' }).waitFor();
    same(await page.locator('.mep-art').boundingBox(), art, 'DSP keeps artwork centered');
    same(await page.locator('.mep-controls-zone').boundingBox(), controls, 'DSP keeps controls fixed');
    assert.ok(await page.locator('.mep-panel').evaluate(n => n.scrollWidth <= n.clientWidth + 1), 'DSP fits side panel');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/artifacts/mobile-landscape-dsp-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.getByRole('button', { name: 'Track Options', exact: true }).click();
    inside(await page.locator('.player-track-menu').boundingBox(), viewport, 'Track options');
    await page.mouse.click(8, viewport.height - 8);
    await page.screenshot({ path: `tests/artifacts/mobile-landscape-${viewport.width}.png` });

    // Native cutouts must not push the symmetric center or controls offscreen.
    await page.evaluate(() => { document.documentElement.style.setProperty('--dmex-inset-left', '30px'); document.documentElement.style.setProperty('--dmex-inset-bottom', '24px'); });
    center(await page.locator('.mep-art').boundingBox(), viewport);
    inside(await page.locator('.mep-controls-zone').boundingBox(), viewport, 'Inset controls');
    await page.evaluate(() => { document.documentElement.style.removeProperty('--dmex-inset-left'); document.documentElement.style.removeProperty('--dmex-inset-bottom'); });
    await page.getByRole('button', { name: 'Open lyrics', exact: true }).click();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForFunction(() => !document.querySelector('.mep-art'));
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    same(await page.locator('.mep-art').boundingBox(), { x: 55, y: 113, width: 250, height: 250 }, 'Rotation restores portrait baseline');
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    center(await page.locator('.mep-art').boundingBox(), viewport);
    const rotated = await canvasSignature(page);
    assert.ok(rotated.lit > 0 && rotated.width === viewport.width && rotated.height === viewport.height, 'Dust immediately survives rotation');
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: centered art/ripples, moving canvas, controls, lyrics/DSP, safe insets and rotation`);
    await context.close();
  }

  const viewport = { width: 800, height: 360 };
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage();
  await page.goto(base + '/tests/mobile-redesign.html?mobile');
  await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mep-root')?.dataset.visualsReady === 'true' && Math.abs(document.querySelector('.mep-root').getBoundingClientRect().top) < .1);
  const art = await page.locator('.mep-art').boundingBox();
  center(art, viewport);
  assert.ok(await page.locator('.mep-art').evaluate(async n => { const image = new Image(); image.src = getComputedStyle(n).backgroundImage.slice(5, -2); await image.decode(); return image.naturalWidth > 0; }), 'Actual cover bitmap loads');
  await page.screenshot({ path: 'tests/artifacts/mobile-landscape-cover.png' });
  await page.getByRole('button', { name: 'Play queue', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Expanded play queue' });
  await queue.waitFor();
  same(await page.locator('.mep-art').boundingBox(), art, 'Real queue preserves cover position');
  inside(await queue.boundingBox(), viewport, 'Queue');
  assert.ok(await queue.locator('.dmex-mobile-queue-row').count() < 12, 'Short landscape queue stays virtualized');
  const close = await page.getByRole('button', { name: 'Close panel', exact: true }).boundingBox();
  const q = await queue.boundingBox();
  assert.ok(close.x >= q.x && close.x + close.width <= q.x + q.width + 1, 'Panel close stays in queue column');
  const handle = queue.getByRole('button', { name: 'Drag to reorder Paper Lanterns 2', exact: true });
  const r = await handle.boundingBox(), cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 + 76 * step / 8 }] });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries.findIndex(entry => entry.track.name === 'Paper Lanterns 2') > 1);
  await page.screenshot({ path: 'tests/artifacts/mobile-landscape-queue.png' });
  await context.close();
  console.log('PASS integrated landscape: cover image, centered art with queue, bounded virtualized glass panel and touch reorder');
} finally { await browser.close(); }
