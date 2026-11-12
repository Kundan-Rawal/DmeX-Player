import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('tests/artifacts', { recursive: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }, { width: 800, height: 360 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/mobile-redesign.html?mobile');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor({ timeout: 12000 }).catch(async error => {
      console.log('Page errors:', errors); console.log((await page.locator('body').innerText()).slice(0, 3000));
      await page.screenshot({ path: 'tests/artifacts/mobile-redesign-failure.png' }); throw error;
    });
    const shell = page.locator('.dmex-mobile-shell');
    await page.evaluate(landscape => {
      document.documentElement.style.setProperty('--dmex-inset-top', landscape ? '0px' : '24px');
      document.documentElement.style.setProperty('--dmex-inset-bottom', landscape ? '0px' : '28px');
    }, viewport.width > viewport.height);
    await page.waitForFunction(() => {
      const mini = document.querySelector('.bottom-player').getBoundingClientRect();
      const list = document.querySelector('.dmex-mobile-track-scroll').getBoundingClientRect();
      return Math.abs(mini.top - list.bottom) <= 1;
    });
    assert.ok(await shell.evaluate(el => el.scrollWidth <= el.clientWidth), 'Shell fits viewport');
    const mini = await page.locator('.bottom-player').boundingBox();
    assert.ok(mini.x >= 0 && mini.x + mini.width <= viewport.width && mini.y >= 0 && mini.y + mini.height <= viewport.height, 'Mini-player fits every viewport, including landscape');
    const scroller = await page.locator('.dmex-mobile-track-scroll').boundingBox();
    assert.ok(Math.abs(mini.y - scroller.y - scroller.height) <= 1, 'No extra inset gap between track list and mini-player');
    assert.ok(await page.locator('.bottom-player').evaluate(el => parseFloat(getComputedStyle(el).borderRadius) >= el.clientHeight / 2), 'Mini-player has the requested rounded pill shape');
    assert.equal(await shell.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    const neutral = await page.locator('.dmex-mobile-tabs').evaluate(el => getComputedStyle(el).backgroundColor);
    const separator = await page.locator('.dmex-mobile-track').first().evaluate(el => getComputedStyle(el).borderBottomColor);
    await page.locator('.app-layout').evaluate(el => el.style.setProperty('--theme-color', '#24c7a5'));
    assert.equal(await page.locator('.dmex-mobile-tabs').evaluate(el => getComputedStyle(el).backgroundColor), neutral, 'Artwork color cannot tint library tabs');
    assert.equal(await page.locator('.dmex-mobile-track').first().evaluate(el => getComputedStyle(el).borderBottomColor), separator, 'Separators remain neutral and do not follow artwork color');
    assert.equal(separator, 'rgba(255, 255, 255, 0.035)', 'Separators are barely visible');
    assert.ok(await page.locator('.dmex-mobile-track').count() < 30, 'Track list is virtualized');
    await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    assert.equal(await page.locator('.dmex-mobile-track-ambient').count(), 1, 'Only the current track receives an ambient artwork layer');
    assert.equal(await page.locator('.dmex-mobile-track:not(.is-current) .dmex-mobile-track-ambient').count(), 0);
    assert.equal(await page.locator('.dmex-mobile-track-ambient img').getAttribute('src'), await page.locator('.dmex-mobile-track.is-current .dmex-artwork img').getAttribute('src'), 'Ambient color texture comes from the active track artwork');
    await page.screenshot({ path: `tests/artifacts/mobile-active-track-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Favourites', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-tab="favourites"]')?.getAttribute('aria-current') === 'page');
    await page.getByRole('button', { name: 'Open play queue', exact: true }).click();
    await page.getByRole('heading', { name: 'Play queue', exact: true }).waitFor();
    assert.equal(await page.locator('.dmex-mobile-queue-spacer').getAttribute('data-count'), '80', 'Browsing favourites must not change queue');
    const queueBounds = await page.locator('.dmex-mobile-track-scroll').boundingBox();
    assert.ok(Math.abs(mini.y - queueBounds.y - queueBounds.height) <= 1, 'Queue also reaches the mini-player without a grey gap');
    assert.ok(await page.locator('.dmex-mobile-queue-row').count() < 30, 'Queue is virtualized');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('navigation', { name: 'Library views' }).waitFor();
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await page.getByRole('button', { name: /Recently added/ }).click();
    await page.getByRole('heading', { name: 'Recently added', exact: true }).waitFor();
    const summary = await page.locator('.dmex-mobile-collection-summary').boundingBox();
    assert.ok(summary.height < 100, 'Collection header stays compact');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Create playlist', exact: true }).click();
    await page.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('Road trip');
    await page.getByRole('button', { name: 'Save playlist', exact: true }).click();
    await page.getByRole('button', { name: /Road trip.*0 tracks/ }).waitFor();
    await page.getByRole('button', { name: 'Tracks', exact: true }).click();
    await page.getByRole('button', { name: 'Options for Night Drive 1', exact: true }).click();
    await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
    await page.getByRole('button', { name: 'Create and add', exact: true }).click();
    await page.getByRole('textbox', { name: 'Playlist name', exact: true }).fill('One tap collection');
    await page.getByRole('button', { name: 'Create and add', exact: true }).click();
    await page.waitForFunction(() => window.libraryTest.calls.some(c => c.command === 'save_playlist' && c.payload.playlist.name === 'One tap collection' && c.payload.playlist.trackPaths.length === 1));
    await page.getByRole('button', { name: 'Options for Paper Lanterns 2', exact: true }).click();
    await page.getByRole('button', { name: 'Add to playlist', exact: true }).click();
    await page.getByRole('button', { name: 'One tap collection', exact: true }).click();
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await page.getByRole('button', { name: /One tap collection.*2 tracks/ }).click();
    await page.getByRole('button', { name: 'Playlist options', exact: true }).click();
    await page.getByRole('button', { name: 'Edit track order', exact: true }).click();
    await page.getByRole('button', { name: 'Options for Paper Lanterns 2', exact: true }).click();
    await page.getByRole('button', { name: 'Move up', exact: true }).click();
    await page.waitForFunction(() => window.libraryTest.calls.some(c => c.command === 'save_playlist' && c.payload.playlist.name === 'One tap collection' && c.payload.playlist.trackPaths[0] === window.libraryTest.tracks[1].path));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.evaluate(() => window.libraryTest.remount());
    await page.getByRole('navigation', { name: 'Library views' }).waitFor();
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await page.getByRole('button', { name: /One tap collection.*2 tracks/ }).click();
    assert.equal(await page.locator('.dmex-mobile-track-play').first().getAttribute('aria-label'), 'Play Paper Lanterns 2', 'Playlist order survives remount');
    await page.getByRole('button', { name: 'Open play queue', exact: true }).click();
    assert.equal(await page.locator('.dmex-mobile-queue-spacer').getAttribute('data-count'), '80', 'Queue survives remount independently of playlist edits');
    await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    await page.getByRole('button', { name: 'Library activity', exact: true }).click();
    await page.getByRole('button', { name: 'Sync missing artwork', exact: true }).click();
    await page.getByText('Artwork is up to date.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(c => c.command === 'download_artist_art').length), 4, 'Only missing artists are synchronized');
    assert.equal(await page.getByRole('button', { name: 'Sync missing artwork', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Clear artwork cache', exact: true }).click();
    await page.getByRole('dialog', { name: 'Clear artist artwork?' }).waitFor();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(c => c.command === 'nuke_artist_cache').length), 0, 'Cancelling cache clear is non-destructive');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.screenshot({ path: `tests/artifacts/mobile-redesign-settings-${viewport.width}.png` });
    await page.goBack();
    await page.getByRole('button', { name: 'Tracks', exact: true }).click();
    await page.screenshot({ path: `tests/artifacts/mobile-redesign-tracks-${viewport.width}.png` });
    assert.deepEqual(errors, [], 'No runtime errors');
    console.log(`PASS ${viewport.width}x${viewport.height}: queue isolation/restoration, back, smart collection, playlist creation/reorder persistence, virtualization, bounds`);
    const domain = await page.evaluate(() => {
      const { queue: q, library: l } = window.mobileTest, tracks = window.libraryTest.tracks.slice(0, 3);
      let s = q.createQueue(tracks, tracks[0], 'Album'); s.repeat = 'ONE';
      const manual = q.advanceQueue(s, false), automatic = q.advanceQueue(s, true);
      const dup = q.insertQueue(s, [tracks[0], tracks[0]], true);
      const removed = q.removeQueueEntry(dup, dup.entries[1].id);
      return { manual: manual.currentId !== s.currentId, automatic: automatic.currentId === s.currentId,
        duplicateIds: new Set(dup.entries.map(e => e.id)).size === dup.entries.length,
        singleRemoval: removed.entries.length === dup.entries.length - 1,
        invalid: q.parseQueue('{').entries.length === 0,
        recentCount: l.smartTracks('recentlyAdded', window.libraryTest.tracks, {}).length };
    });
    assert.deepEqual(domain, { manual: true, automatic: true, duplicateIds: true, singleRemoval: true, invalid: true, recentCount: 80 });
    await context.close();
  }
  const restored = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
  const page = await restored.newPage();
  await page.goto(base + '/tests/mobile-redesign.html?mobile&native-queue');
  await page.waitForFunction(() => window.libraryTest.calls.some(c => c.command === 'audio_command' && c.payload.cmd === 'SEEK 41'));
  await page.getByRole('button', { name: 'Open play queue', exact: true }).click();
  assert.equal(await page.locator('.dmex-mobile-queue-spacer').getAttribute('data-count'), '3');
  assert.equal(await page.locator('.dmex-mobile-queue-row.is-current strong').innerText(), 'Night Drive 1');
  assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(c => c.command === 'audio_command' && /^PLAY(?:_USER)?$/.test(c.payload.cmd)).length), 0, 'Native queue restores paused without legacy fallback replacing it');
  console.log('PASS delayed native queue hydration: saved order/position restored, no fallback replacement or autoplay');
  await restored.close();
} finally { await browser.close(); }
