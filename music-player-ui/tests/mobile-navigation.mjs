import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
const image = await readFile('public/branding/dmex-d-transparent.png');
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }, { width: 800, height: 360 }]) {
    if (process.env.MOBILE_TEST_WIDTH && viewport.width !== Number(process.env.MOBILE_TEST_WIDTH)) continue;
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://asset.localhost/**', route => route.fulfill({ contentType: 'image/png', body: image }));
    await page.goto(base + '/tests/mobile-redesign.html?mobile&navigation');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'DmeX Player', exact: true }).waitFor();
    const wordmark = await page.locator('.dmex-mobile-wordmark').evaluate(el => {
      const img = el.querySelector('img'), text = el.querySelector('span'), a = img.getBoundingClientRect(), b = text.getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { text: text.textContent, sameLine: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 2,
        separate: a.right <= b.left + 1, alpha: ctx.getImageData(0, 0, 1, 1).data[3], width: el.scrollWidth, available: el.parentElement.clientWidth };
    });
    assert.equal(wordmark.text, 'meX Player'); assert.ok(wordmark.sameLine && wordmark.separate && wordmark.width <= wordmark.available);
    assert.equal(wordmark.alpha, 0, 'Header D uses an actually transparent asset');
    const cdp = await context.newCDPSession(page);
    const active = async id => {
      try { await page.waitForFunction(id => document.querySelector(`[data-tab="${id}"]`)?.getAttribute('aria-current') === 'page', id, { timeout: 8000 }); }
      catch (error) { console.log({ url: page.url(), errors, content: (await page.locator('body').innerText()).slice(0, 3000) }); await page.screenshot({ path: 'tests/artifacts/mobile-navigation-failure.png' }); throw error; }
    };
    const swipe = async (dx, dy = 0) => {
      const rect = await page.locator('.dmex-mobile-main').boundingBox(), x = rect.x + rect.width * (dx < 0 ? .8 : .2), y = rect.y + Math.min(100, rect.height / 2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] });
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const scroll = async (selector, top) => {
      await page.locator(selector).evaluate((el, top) => { el.scrollTop = top; }, top);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return page.locator(selector).evaluate(el => el.scrollTop);
    };
    const trackTop = await scroll('.dmex-mobile-track-scroll', 450);
    await swipe(-viewport.width * .55); await active('albums');
    assert.ok(await page.locator('.dmex-mobile-album.is-featured').count() > 0, 'Larger album covers are restored');
    const albumTop = await scroll('.dmex-mobile-page-scroll', 1000);
    const shapes = await page.locator('.dmex-mobile-album').evaluateAll(items => items.map(el => el.className));
    await swipe(viewport.width * .55); await active('tracks');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-track-scroll').evaluate(el => el.scrollTop) - trackTop) < 2);
    await swipe(-viewport.width * .55); await active('albums');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop) - albumTop) < 2);
    assert.deepEqual(await page.locator('.dmex-mobile-album').evaluateAll(items => items.map(el => el.className)), shapes, 'Featured cover layout stays stable');
    await page.locator('.dmex-mobile-album').first().evaluate(el => el.click());
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await active('albums');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop) - albumTop) < 2, 'Album position survives visiting an album');
    await swipe(-viewport.width * .55); await active('artists');
    await page.waitForFunction(() => document.querySelector('.dmex-mobile-artist-row img')?.naturalWidth > 0);
    const avatar = await page.locator('.dmex-mobile-artist-row .dmex-artwork').first().evaluate(el => ({ width: el.clientWidth, height: el.clientHeight, radius: getComputedStyle(el).borderRadius }));
    assert.equal(avatar.width, avatar.height); assert.equal(avatar.radius, '50%'); assert.ok(avatar.width >= 44 && avatar.width <= 48);
    const artistTop = await scroll('.dmex-mobile-page-scroll', 600);
    await swipe(viewport.width * .55); await active('albums');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop) - albumTop) < 2);
    await swipe(-viewport.width * .55); await active('artists');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop) - artistTop) < 2);
    await swipe(0, -65); await active('artists');
    assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'audio_command' && /^PLAY(?:_USER)?$/.test(call.payload.cmd)).length), 0, 'Swiping does not accidentally play a row');
    const consistency = await page.evaluate(() => {
      const tracks = window.libraryTest.tracks, lib = window.mobileTest.library, artists = window.libraryTest.buildArtistDictionary(tracks);
      return { artists: artists.every(artist => lib.routeTracks({ kind: 'artist', id: artist.id }, tracks, new Set(), [], {}).length === artist.trackIds.length),
        albums: lib.albumGroups(tracks).every(album => lib.routeTracks({ kind: 'album', id: album.id }, tracks, new Set(), [], {}).length === album.tracks.length),
        unknown: lib.routeTracks({ kind: 'artist', id: 'unknown-artist' }, tracks, new Set(), [], {}).length };
    });
    assert.deepEqual(consistency, { artists: true, albums: true, unknown: 1 });
    const unknown = page.locator('.dmex-mobile-artist-row').filter({ hasText: 'Unknown Artist' });
    await unknown.scrollIntoViewIfNeeded();
    const unknownTop = await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop);
    await unknown.click();
    await page.getByRole('heading', { name: 'Unknown Artist', exact: true }).waitFor();
    assert.equal(await page.locator('.dmex-mobile-track').count(), 1, 'Unknown artist detail matches its card count');
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await active('artists');
    assert.ok(Math.abs(await page.locator('.dmex-mobile-page-scroll').evaluate(el => el.scrollTop) - unknownTop) < 2, 'Artist position survives visiting an artist');
    await page.screenshot({ path: `tests/artifacts/mobile-navigation-artists-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await page.screenshot({ path: `tests/artifacts/mobile-navigation-albums-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: actual left/right touch swipes, no ghost playback, scroll restoration, stable featured albums, circular artists, transparent inline wordmark, collection consistency`);
    await context.close();
  }
} finally { await browser.close(); }
