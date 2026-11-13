import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }, { width: 800, height: 360 }]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    await context.addInitScript(theme => localStorage.setItem('dmex_mobile_appearance', theme), theme);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420') + '/tests/mobile-redesign.html?mobile');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const mini = await page.locator('.bottom-player').boundingBox();
    await page.evaluate(() => {
      window.morphFrames = [];
      const tick = () => {
        const sheet = document.querySelector('[data-mobile-player-sheet]'), root = sheet.querySelector('.mep-root');
        const matrix = new DOMMatrixReadOnly(getComputedStyle(sheet).transform);
        window.morphFrames.push({ phase: sheet.dataset.phase, background: getComputedStyle(root).backgroundColor, sx: matrix.m11, sy: matrix.m22 });
        window.morphFrame = requestAnimationFrame(tick);
      };
      window.morphFrame = requestAnimationFrame(tick);
    });
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    const start = await page.locator('[data-mobile-player-sheet]').evaluate(node => {
      const motion = node.getAnimations().find(value => value.effect.getKeyframes().some(frame => frame.clipPath));
      return { clips: motion?.effect.getKeyframes().map(frame => frame.clipPath), shared: !!document.querySelector('[data-player-shared-art]') };
    });
    assert.ok(start.clips?.[0].startsWith(`inset(${mini.y}px`), 'Reveal starts from the mini-player bounds');
    assert.ok(start.shared, 'Cover is shared between the pill and expanded artwork');
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.ready === 'true');
    const frames = await page.evaluate(() => { cancelAnimationFrame(window.morphFrame); return window.morphFrames.filter(frame => frame.phase === 'opening'); });
    assert.ok(frames.length > 1 && frames.every(frame => frame.sx === 1 && frame.sy === 1), 'Text/control layout never scales');
    if (theme === 'light') assert.ok(frames.every(frame => frame.background === 'rgb(255, 255, 255)'), 'No hard-coded black frame in light mode');
    assert.equal(await page.locator('[data-player-shared-art]').count(), 0, 'Shared cover layer is released at landing');
    await page.waitForTimeout(220);
    await page.screenshot({ path: `tests/artifacts/player-morph-${theme}-${viewport.width}.png` });
    await page.locator('.mep-topbar').getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.phase === 'closed');
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.waitForTimeout(65); await page.evaluate(() => history.back());
    await page.waitForFunction(() => document.querySelector('[data-mobile-player-sheet]').dataset.phase === 'closed');
    assert.equal(await page.locator('[data-player-shared-art]').count(), 0, 'Interrupted reveal leaves no orphan artwork');
    assert.deepEqual(errors, []);
    console.log(`PASS ${theme} ${viewport.width}: pill-origin rounded reveal, shared cover, unscaled controls, theme-correct opening and cancellation cleanup`);
    await context.close();
  }
} finally { await browser.close(); }
