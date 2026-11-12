import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://localhost:1420';
try {
  for (const width of [360, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/library-workflows.html?filters');
    await page.waitForFunction(() => document.querySelectorAll('.dmex-mobile-track').length === 7);
    const domain = await page.evaluate(() => {
      const t = window.libraryTest; const filter = { minimumDuration: 10, skipCallRecordings: true };
      const include = (name, duration = 100) => t.includeLibraryTrack({ name, duration }, filter);
      return {
        thresholds: t.MINIMUM_DURATIONS.map(minimumDuration => [minimumDuration, t.includeLibraryTrack({ duration: minimumDuration - 0.1 }, { minimumDuration, skipCallRecordings: false }), t.includeLibraryTrack({ duration: minimumDuration }, { minimumDuration, skipCallRecordings: false })]),
        words: ['CALL_recording.wav', 'recording-call', 'Call me', 'Recording artist', 'Callback recording', 'Recalling recording'].map(name => include(name)),
        unknown: include('Unknown', 0), parsed: [null, 'null', '{}', '{"minimumDuration":12}', '{"minimumDuration":15,"skipCallRecordings":true}'].map(t.parseLibraryFilters),
      };
    });
    for (const [minimum, below, boundary] of domain.thresholds) { if (minimum) assert.equal(below, false); assert.equal(boundary, true); }
    assert.deepEqual(domain.words, [false, false, true, true, true, true]); assert.equal(domain.unknown, true);
    assert.deepEqual(domain.parsed.slice(0, 4), Array(4).fill({ minimumDuration: 0, skipCallRecordings: false }));
    assert.deepEqual(domain.parsed[4], { minimumDuration: 15, skipCallRecordings: true });
    const settings = async () => { await page.getByRole('button', { name: 'Library options' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); };
    await settings();
    await page.getByRole('combobox', { name: 'Minimum duration', exact: true }).click();
    const surface = await page.locator('.custom-select-popup').evaluate(node => getComputedStyle(node).backgroundColor);
    assert.match(surface, /^rgb\(/, 'Dropdown surface must be opaque so underlying labels do not bleed through');
    assert.deepEqual(await page.getByRole('option').allTextContents(), ['Off', '10 seconds', '15 seconds', '20 seconds', '30 seconds', '60 seconds']);
    await page.getByRole('option', { name: '10 seconds', exact: true }).click();
    await page.getByRole('switch', { name: 'Skip call recordings' }).click();
    assert.equal(await page.getByRole('switch', { name: 'Skip call recordings' }).getAttribute('aria-checked'), 'true');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `tests/artifacts/library-filters-${width}.png` });
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dmex-mobile-track').length === 4);
    assert.equal(await page.evaluate(() => window.libraryTest.tracks.length), 7, 'Filters must never remove stored tracks');
    await page.evaluate(() => window.libraryTest.remount());
    await page.waitForFunction(() => document.querySelectorAll('.dmex-mobile-track').length === 4);
    await settings();
    assert.equal(await page.getByRole('combobox', { name: 'Minimum duration' }).innerText(), '10 seconds');
    assert.equal(await page.getByRole('switch', { name: 'Skip call recordings' }).getAttribute('aria-checked'), 'true');
    await page.getByRole('combobox', { name: 'Minimum duration' }).click(); await page.getByRole('option', { name: 'Off', exact: true }).click();
    await page.getByRole('switch', { name: 'Skip call recordings' }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dmex-mobile-track').length === 7);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    assert.deepEqual(errors, []);
    await page.goto(base + '/tests/library-workflows.html?metadata-failure');
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    await page.getByRole('button', { name: 'Library activity', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Metadata unavailable for 1 tracks' }).waitFor();
    await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
    assert.equal(await page.locator('.scan-progress').count(), 0);
    await page.waitForTimeout(700); assert.equal(await page.locator('.scan-progress').count(), 0);
    console.log(`Duration / call-recording filters, persistence, reversibility and warning dismissal passed at ${width}px`);
    await context.close();
  }
} finally { await browser.close(); }
