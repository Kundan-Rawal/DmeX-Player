import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://localhost:1420';
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }].filter(v => !process.env.MOBILE_TEST_WIDTH || v.width === Number(process.env.MOBILE_TEST_WIDTH))) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/player-visualizers.html?nav');
    const nav = page.getByRole('navigation', { name: 'Library views' });
    await nav.waitFor();
    assert.ok(await nav.evaluate(node => node.scrollWidth > node.clientWidth), 'Mobile nav must scroll horizontally');
    for (const [name, id] of [['Favourites', 'FAVOURITES'], ['Discover', 'CLOUD_FETCH'], ['Artists', 'ARTIST']]) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForFunction(id => document.querySelector('[data-testid="selected-view"]').textContent === id, id);
      await page.waitForTimeout(650);
      assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('aria-current'), 'page');
    }
    await nav.evaluate(node => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaX: -200, bubbles: true }));
      const target = node.querySelector('[data-view="ALBUMS"]');
      const rect = target.getBoundingClientRect(), container = node.getBoundingClientRect();
      node.scrollTo({ left: node.scrollLeft + rect.left + rect.width / 2 - container.left - node.clientWidth / 2, behavior: 'instant' });
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="selected-view"]').textContent === 'ALBUMS');
    await page.screenshot({ path: `tests/artifacts/mobile-nav-${viewport.width}.png` });

    await page.goto(base + '/tests/player-visualizers.html?player');
    await page.getByRole('button', { name: 'DSP Controls', exact: true }).waitFor();
    await page.waitForTimeout(400);
    const controls = await page.locator('.mep-controls-zone').boundingBox();
    assert.deepEqual(await page.locator('.mep-art').boundingBox(), { x: viewport.width / 2 - 125, y: 113, width: 250, height: 250 }, 'Artwork matches the pre-change layout baseline');
    assert.equal(controls.y, viewport.width === 360 ? 568 : 487, 'Controls match the pre-change layout baseline');
    await page.screenshot({ path: `tests/artifacts/mobile-player-expanded-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Open lyrics', exact: true }).click();
    await page.getByText('First lyric', { exact: true }).waitFor();
    const lyricsControls = await page.locator('.mep-controls-zone').boundingBox();
    console.log(`Layout ${viewport.width}: expanded controls y=${controls.y}, lyrics y=${lyricsControls.y}`);
    if (viewport.height >= 800) assert.ok(Math.abs(controls.y - lyricsControls.y) <= 1, 'Lyrics must preserve fixed controls placement');
    else if (Math.abs(controls.y - lyricsControls.y) > 1)
      console.log('RETAINED: original short-screen lyrics height behavior; user requested no layout changes');
    await page.screenshot({ path: `tests/artifacts/mobile-lyrics-${viewport.width}.png` });
    await page.getByRole('button', { name: 'DSP Controls', exact: true }).click();
    await page.getByRole('heading', { name: 'Fine-Tune DSP' }).waitFor();
    const dspControls = await page.locator('.mep-controls-zone').boundingBox();
    if (viewport.height >= 800) assert.ok(Math.abs(controls.y - dspControls.y) <= 1, 'DSP must preserve fixed controls placement');
    assert.equal(await page.locator('.manual-presets').count(), 0);
    assert.ok(await page.locator('.mep-dsp-scroll').evaluate(node => node.scrollWidth <= node.clientWidth), 'DSP content must not overflow horizontally');
    await page.getByRole('combobox', { name: 'Processing quality' }).click();
    const popup = await page.locator('.custom-select-popup').boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= viewport.width + 1, 'Dropdown fits narrow phone width');
    await page.getByRole('combobox', { name: 'Processing quality' }).press('Escape');
    await page.screenshot({ path: `tests/artifacts/mobile-player-dsp-${viewport.width}.png` });
    await page.getByRole('button', { name: 'DSP Controls', exact: true }).click();
    await page.getByText('HD Clear', { exact: true }).waitFor();
    assert.equal(await page.getByText('Immersive', { exact: true }).count(), 1, 'Expanded taste buttons remain');
    await page.getByRole('button', { name: 'Track Options', exact: true }).click();
    await page.getByRole('slider', { name: 'Bass Field', exact: true }).waitFor();
    const menu = await page.locator('.player-track-menu').boundingBox();
    const menuButton = await page.getByRole('button', { name: 'Track Options', exact: true }).boundingBox();
    assert.ok(menu.y > menuButton.y + menuButton.height + 10, 'Track menu clears its trigger');
    assert.ok(menu.x >= 0 && menu.x + menu.width <= viewport.width + 1, 'Track menu fits phone');
    assert.deepEqual(errors, [], 'Mobile components have no runtime errors');
    console.log(`PASS mobile ${viewport.width}: scroll-select nav, mobile controls, menu spacing, popup bounds${viewport.height >= 800 ? ', stable lyrics/DSP placement' : '; original short-screen layout retained'}`);
    await context.close();
  }
} finally { await browser.close(); }
