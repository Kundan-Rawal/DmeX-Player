import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://localhost:1420';
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
try {
  for (const width of [360, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/tests/library-workflows.html');
    await page.getByRole('button', { name: 'Library options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add music', exact: true }).click();
    await page.locator('.folder-modal-item').first().waitFor();
    assert.deepEqual(await page.locator('.folder-modal-item').allTextContents(), ['Music folder', 'Internal Storage', 'Downloads', 'Custom']);
    await page.screenshot({ path: `tests/artifacts/folders-${width}.png` });
    await page.getByRole('button', { name: 'Music folder', exact: true }).click();
    await page.waitForFunction(() => window.libraryTest.tracks[0]?.metadataLoaded);
    assert.equal(await page.evaluate(() => window.libraryTest.tracks[0].name), 'Correct Title');
    assert.equal(await page.evaluate(() => window.libraryTest.tracks[0].artist), 'Correct Singer');
    await page.getByRole('button', { name: 'Library options' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add music', exact: true }).click();
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.waitForFunction(() => window.libraryTest.calls.some(c => c.command === 'scan_android_music' && c.payload.folderPath === 'content://test/tree/selected'));
    assert.equal(await page.evaluate(() => window.libraryTest.tracks.length), 1, 'Rescan must deduplicate');
    await page.getByRole('button', { name: 'Library options' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('input[type=password]').fill('test-key-not-a-secret');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(() => window.libraryTest.calls.some(c => c.command === 'set_setting' && c.payload.value === 'test-key-not-a-secret'));

    const domain = await page.evaluate(() => {
      const t = window.libraryTest;
      return {
        artist: t.cleanArtistString('Audioslave'), unknown: t.sanitizeForLyricsAPI({ name: 'Artist - Song.flac', artist: 'Unknown Artist', path: '', duration: 1 }),
        identities: t.buildArtistDictionary([{ path: 'a', artist: 'अरिजीत सिंह' }, { path: 'b', artist: 'श्रेया घोषाल' }]).length,
        cache: t.artistCacheKey('ह'),
        lrc: t.parseLRC('[offset:100]\n[00:02][00:03.5]Repeat\n[00:01.123]First'),
        wrong: t.chooseLyricsMatch([{ trackName: 'Other Song', artistName: 'Singer', duration: 120, syncedLyrics: '[00:00]wrong' }], 'Song', 'Singer', 120),
      };
    });
    assert.equal(domain.artist, 'Audioslave'); assert.equal(domain.identities, 2); assert.equal(domain.cache, 'u939_');
    assert.deepEqual(domain.unknown, { queryTitle: 'Song', queryArtist: 'Artist' });
    assert.equal(domain.lrc.length, 3); assert.equal(domain.lrc[0].text, 'First'); assert.equal(domain.lrc[1].time, 2.1); assert.equal(domain.wrong, undefined);

    await page.route('https://lrclib.net/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.locator('.dmex-mobile-track-play').first().click();
    await page.getByRole('button', { name: 'Open expanded player', exact: true }).click();
    await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await page.getByRole('button', { name: 'Fetch Lyrics Online' }).click();
    await page.getByLabel('Song name').waitFor();
    assert.equal(await page.locator('.mep-lyrics-scroll .lyrics-search').count(), 1, 'Retry must remain inside the original mobile lyrics panel');
    await page.screenshot({ path: `tests/artifacts/mobile-lyrics-retry-${width}.png` });
    await page.goto(base + '/tests/library-workflows.html?lyrics');
    await page.getByRole('button', { name: 'Fetch Lyrics Online' }).click();
    await page.getByLabel('Song name').fill('My Song'); await page.getByLabel('Singer name').fill('My Singer');
    await page.screenshot({ path: `tests/artifacts/lyrics-retry-${width}.png` });
    await page.unroute('https://lrclib.net/**');
    await page.route('https://lrclib.net/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trackName: 'My Song', artistName: 'My Singer', duration: 120, syncedLyrics: '[00:01]Found lyrics' }) }));
    await page.getByRole('button', { name: 'Search Again' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=saved-lyrics]').textContent.includes('Found lyrics'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(`Library / Settings / lyrics workflows passed at ${width}px`);
    await context.close();
  }
} finally { await browser.close(); }
