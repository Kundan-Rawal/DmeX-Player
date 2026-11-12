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
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    assert.ok(await page.locator('.dmex-mobile-main').evaluate(el => el.getAnimations().some(animation => animation.playState === 'running')), 'Tab content has a real transform/opacity transition');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Tracks', exact: true }).click();
    assert.equal(await page.locator('.dmex-mobile-main').evaluate(el => el.getAnimations().filter(animation => animation.playState === 'running').length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Open play queue', exact: true }).click();
    await page.getByRole('heading', { name: 'Play queue', exact: true }).waitFor();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1') || '{}').entries?.length === 80);
    const queue = page.getByRole('list', { name: 'Queue tracks', exact: true }), cdp = await context.newCDPSession(page);
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')));
    const initial = await read(), moving = initial.entries[1].id;
    const begin = async id => {
      const state = await read(), index = state.entries.findIndex(entry => entry.id === id);
      await queue.evaluate((el, index) => { el.scrollTop = index * 76; }, index);
      const handle = page.locator(`[data-queue-id="${id}"] .dmex-mobile-drag-handle`);
      await handle.waitFor();
      assert.equal(await handle.evaluate(el => getComputedStyle(el).touchAction), 'none', 'Drag handle cannot be claimed by native scrolling');
      await page.waitForFunction(() => document.querySelector('.dmex-mobile-main').getAnimations().every(animation => animation.playState !== 'running'));
      const rect = await handle.boundingBox(), bounds = await queue.boundingBox();
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await page.locator('.dmex-mobile-queue-row.is-dragging').waitFor();
      return { point, bounds, state, index };
    };
    const move = async (point, y) => {
      for (let step = 1; step <= 6; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + (y - point.y) * step / 6 }] });
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    let drag = await begin(moving);
    await move(drag.point, drag.bounds.y + drag.bounds.height - 3);
    const beforeHold = await queue.evaluate(el => el.scrollTop);
    await page.waitForFunction(top => document.querySelector('[aria-label="Queue tracks"]').scrollTop > top + 90, beforeHold, { timeout: 5000 });
    assert.deepEqual((await read()).entries.map(entry => entry.id), initial.entries.map(entry => entry.id), 'Drag preview does not persist before drop');
    await page.screenshot({ path: `tests/artifacts/mobile-queue-drag-${viewport.width}.png` });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries.findIndex(entry => entry.id === id) > 1, moving);
    const down = await read(), downIndex = down.entries.findIndex(entry => entry.id === moving);
    drag = await begin(moving);
    await move(drag.point, drag.bounds.y + 3);
    await page.waitForFunction(top => document.querySelector('[aria-label="Queue tracks"]').scrollTop < top - 90, downIndex * 76, { timeout: 5000 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(({ id, index }) => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')).entries.findIndex(entry => entry.id === id) < index, { id: moving, index: downIndex });
    const up = await read();
    assert.equal(up.currentId, initial.currentId, 'Reordering cannot change current playback');
    assert.equal(new Set(up.entries.map(entry => entry.id)).size, 80);
    assert.equal(await page.locator('.dmex-mobile-queue-row.is-current .dmex-mobile-drag-handle').count(), 0, 'Current track cannot be dragged');
    drag = await begin(moving); await move(drag.point, drag.bounds.y + drag.bounds.height - 4);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector('.dmex-mobile-queue-row.is-dragging'));
    assert.deepEqual((await read()).entries.map(entry => entry.id), up.entries.map(entry => entry.id), 'Cancelled drag preserves queue order');
    const feedback = await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'mobile_haptic').map(call => call.payload.kind));
    assert.ok(feedback.includes('dragStart') && feedback.includes('dragTick') && feedback.includes('confirm'));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const toggle = page.getByRole('switch', { name: 'Haptic feedback', exact: true });
    await toggle.click();
    const count = await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'mobile_haptic').length);
    await page.getByRole('switch', { name: 'Dark appearance', exact: true }).click();
    assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'mobile_haptic').length), count, 'Haptics off suppresses interaction feedback');
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: animated tabs, reduced motion, touch drag up/down, stationary edge auto-scroll, cancel, current-track protection, haptics and opt-out`);
    await context.close();
  }
} finally { await browser.close(); }
