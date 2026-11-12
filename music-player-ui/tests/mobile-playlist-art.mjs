import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
const collections = ['recentlyAdded', 'recentlyPlayed', 'mostPlayed'];
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }, { width: 800, height: 360 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const open = async () => {
      await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    };
    await page.goto(base + '/tests/mobile-redesign.html?mobile'); await open();
    for (const id of collections) {
      const card = page.locator(`[data-collection="${id}"]`);
      await page.waitForFunction(id => [...document.querySelectorAll(`[data-collection="${id}"] img`)].every(img => img.complete && img.naturalWidth > 0), id);
      const expected = await page.evaluate(id => {
        const l = window.mobileTest.library, tracks = l.smartTracks(id, window.libraryTest.tracks, {});
        return { covers: [...new Set(tracks.map(t => t.thumb).filter(Boolean))].slice(0, 4), count: tracks.length, title: l.SMART_TITLES[id] };
      }, id);
      assert.deepEqual(await card.locator('img').evaluateAll(images => images.map(img => img.getAttribute('src'))), expected.covers, `${id} uses its own ordered collection artwork`);
      assert.ok((await card.locator('.dmex-mobile-collection-art').boundingBox()).height >= 70);
      await card.click();
      await page.getByRole('heading', { name: expected.title, exact: true }).waitFor();
      assert.equal(await page.locator('.dmex-mobile-collection-summary strong').innerText(), `${expected.count} tracks`);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    assert.ok(await page.locator('.dmex-mobile-shell').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: `tests/artifacts/mobile-playlist-art-${viewport.width}.png` });
    if (viewport.width === 360) {
      await page.evaluate(() => { window.playlistArtBaseline = window.libraryTest.tracks.map(track => ({ ...track })); });
      for (const mode of ['single', 'broken', 'missing', 'empty-history']) {
        await page.evaluate(mode => {
          const tracks = window.libraryTest.tracks, baseline = window.playlistArtBaseline, cover = baseline[0].thumb;
          tracks.forEach((track, index) => { Object.assign(track, baseline[index]); track.thumb = mode === 'single' ? cover : mode === 'missing' ? undefined : index === 0 && mode === 'broken' ? 'data:image/png;base64,broken' : baseline[index].thumb;
            if (mode === 'empty-history') { track.lastPlayed = 0; track.playCount = 0; track.totalSecondsListened = 0; } });
          window.libraryTest.remount();
        }, mode);
        await open();
        const art = page.locator('[data-collection="recentlyAdded"] .dmex-mobile-collection-art');
        if (mode === 'missing') { assert.equal(await art.locator('img').count(), 0); assert.equal(await art.getAttribute('data-cover-count'), '0'); }
        else {
          await page.waitForFunction(() => { const images = [...document.querySelectorAll('[data-collection="recentlyAdded"] img')]; return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0); });
          if (mode === 'single') assert.equal(await art.locator('img').count(), 1);
          if (mode === 'broken') assert.equal(await art.locator('img[src="data:image/png;base64,broken"]').count(), 0);
        }
        if (mode === 'empty-history') {
          assert.equal(await page.locator('[data-collection="recentlyPlayed"] img').count(), 0);
          assert.equal(await page.locator('[data-collection="mostPlayed"] img').count(), 0);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: real smart-collection cover collages, matching counts/destinations, single/missing/broken artwork and empty-history fallback`);
    await context.close();
  }
} finally { await browser.close(); }
