import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }, { width: 800, height: 360 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/mobile-redesign.html?mobile');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const mini = await page.locator('footer.bottom-player').boundingBox();
    await page.evaluate(() => {
      window.motionSamples = [];
      let last = performance.now();
      const sample = now => {
        const sheet = document.querySelector('[data-mobile-player-sheet]'), pill = document.querySelector('footer.bottom-player');
        const rect = sheet.getBoundingClientRect(), art = document.querySelector('.mep-art')?.getBoundingClientRect();
        window.motionSamples.push({ dt: now - last, phase: sheet.dataset.phase, ready: sheet.dataset.ready,
          y: rect.y, width: rect.width, height: rect.height, miniHeight: pill.getBoundingClientRect().height,
          artWidth: art?.width, ambient: !!sheet.querySelector('.ambient-background'), library: getComputedStyle(document.querySelector('.dmex-mobile-shell')).visibility });
        last = now; window.motionFrame = requestAnimationFrame(sample);
      };
      window.motionFrame = requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.ready === 'true');
    const samples = await page.evaluate(() => { cancelAnimationFrame(window.motionFrame); return window.motionSamples; });
    const opening = samples.filter(value => value.phase === 'opening');
    assert.ok(opening.length >= 2, 'The opening is animated, not a delayed pop');
    assert.ok(opening.every(value => Math.abs(value.width - viewport.width) < .1 && Math.abs(value.height - viewport.height) < .1 && Math.abs(value.miniHeight - mini.height) < .1), 'No geometry animation or squished cover: ' + JSON.stringify(opening.map(value => [value.width, value.height, value.miniHeight])));
    assert.ok(opening.every(value => !value.ambient && value.ready === 'false' && value.library === 'visible'), 'Heavy visuals wait while the underlying library remains painted');
    assert.ok(opening.every((value, i) => !i || value.y <= opening[i - 1].y + .1), 'Opening moves monotonically without reversal');
    await page.screenshot({ path: `tests/artifacts/mobile-motion-open-${viewport.width}.png` });
    await page.locator('.mep-topbar').getByRole('button', { name: 'Close', exact: true }).click();
    assert.ok(await page.locator('.ambient-background').count() > 0, 'Closing retains frozen visual layers rather than flashing black');
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.phase === 'closed');
    assert.equal(await page.locator('.mep-root .ambient-background').count(), 0);
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.waitForTimeout(65);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.phase === 'closed');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-mobile-player-sheet]').getAttribute('data-ready'), 'false', 'Cancelled opening cannot start stale effects');

    const cdp = await context.newCDPSession(page), main = page.locator('.dmex-mobile-main');
    const tabWidths = await page.locator('.dmex-mobile-tabs button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    const bounds = await main.boundingBox(), x = bounds.x + bounds.width * .8, y = bounds.y + Math.min(100, bounds.height / 2), distance = bounds.width * .45;
    await page.evaluate(() => { window.outgoingPage = document.querySelector('.dmex-mobile-route-page[data-current=true]'); });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - distance * i / 6, y }] });
      await page.waitForTimeout(20);
    }
    const drag = await page.locator('.dmex-mobile-route-page[data-current=true]').boundingBox();
    assert.ok(Math.abs(drag.x - bounds.x + distance) < 2, 'Page follows the finger one-to-one');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.dmex-mobile-main').dataset.motion === 'settling');
    const handoff = await page.evaluate(() => {
      const old = document.querySelector('.dmex-mobile-route-page[data-current=false]'), current = document.querySelector('.dmex-mobile-route-page[data-current=true]');
      const a = old.getBoundingClientRect(), b = current.getBoundingClientRect();
      return { same: old === window.outgoingPage, gap: b.left - a.right,
        keys: current.getAnimations()[0].effect.getKeyframes().map(frame => frame.transform),
        opacity: getComputedStyle(current).opacity, hidden: old.inert && old.getAttribute('aria-hidden') === 'true' };
    });
    assert.ok(handoff.same && handoff.hidden, 'Outgoing live page is retained but cannot receive input');
    assert.ok(Math.abs(handoff.gap) < 1, 'Incoming and outgoing pages share a continuous edge');
    assert.equal(handoff.opacity, '1', 'No secondary fade or halfway pop');
    await page.screenshot({ path: `tests/artifacts/mobile-motion-tabs-${viewport.width}.png` });
    await page.waitForFunction(() => document.querySelector('.dmex-mobile-main').dataset.motion === 'idle');
    assert.equal(await page.locator('.dmex-mobile-route-page').count(), 1, 'Outgoing page is released after landing');
    assert.equal(await page.getByRole('button', { name: 'Albums', exact: true }).getAttribute('aria-current'), 'page');
    assert.deepEqual(await page.locator('.dmex-mobile-tabs button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width)), tabWidths, 'Selecting a tab cannot shift navbar snap targets');
    assert.ok(Math.abs((await page.locator('.dmex-mobile-route-page').boundingBox()).x - bounds.x) < .1, 'Landing is exactly aligned');
    assert.equal(await page.locator('.dmex-mobile-route-page').evaluate(n => getComputedStyle(n).willChange), 'auto', 'Temporary compositor hint is released');

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 45, y }] });
    await page.waitForTimeout(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('.dmex-mobile-main').dataset.motion === 'idle');
    assert.equal(await page.getByRole('button', { name: 'Albums', exact: true }).getAttribute('aria-current'), 'page', 'Cancelled swipe keeps the current tab');
    assert.ok(Math.abs((await page.locator('.dmex-mobile-route-page').boundingBox()).x - bounds.x) < .1, 'Cancelled swipe returns without an offset');
    for (const tab of ['Artists', 'Folders', 'Tracks']) {
      await page.getByRole('button', { name: tab, exact: true }).evaluate(node => node.click());
      await page.waitForTimeout(45);
    }
    await page.waitForFunction(() => document.querySelector('.dmex-mobile-main').dataset.motion === 'idle');
    assert.equal(await page.locator('.dmex-mobile-route-page').count(), 1, 'Rapid navigation releases abandoned pages');
    assert.ok(Math.abs((await page.locator('.dmex-mobile-route-page').boundingBox()).x - bounds.x) < .1, 'Rapid navigation lands exactly');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Tracks', exact: true }).click();
    assert.equal(await main.getAttribute('data-motion'), 'idle');
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.ready === 'true');
    assert.equal(await page.locator('[data-mobile-player-sheet]').getAttribute('data-phase'), 'open');
    assert.deepEqual(errors, []);
    const dt = opening.map(value => value.dt).sort((a, b) => a - b);
    console.log(`PASS ${viewport.width}x${viewport.height}: fixed player geometry, visible library during slide, staged effects, cancelled open, retained outgoing page, gap-free handoff, aligned landing, reduced motion; browser opening frame p95=${dt[Math.floor((dt.length - 1) * .95)].toFixed(1)}ms`);
    await context.close();
  }
} finally { await browser.close(); }
