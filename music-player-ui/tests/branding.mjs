import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.includes('<title>DmeX Player</title>') && html.includes('/branding/favicon-32.png'));
assert.ok(!html.includes('vite.svg') && !html.includes('Tauri + React'));
async function audit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await audit(path);
    else if (/\.(tsx?|css)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      assert.ok(!/#(?:c8222a|8a1520|6a1018|c62828|ff4081|ff79b0|f39679)\b/i.test(source), `Legacy red default in ${path.pathname}`);
    }
  }
}
await audit(new URL('../src/', import.meta.url));
for (const [file, size] of [['../public/branding/dmex-orbit-d.png', 256], ['../public/branding/favicon-32.png', 32], ['../public/branding/apple-touch-icon.png', 180]]) {
  const png = await readFile(new URL(file, import.meta.url));
  assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
}
for (const icon of ['ic_launcher', 'ic_launcher_round']) {
  const xml = await readFile(new URL(`../src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/${icon}.xml`, import.meta.url), 'utf8');
  assert.ok(xml.includes('ic_launcher_foreground') && xml.includes('ic_launcher_monochrome') && xml.includes('@color/ic_launcher_background'));
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1440, 360, 320]) {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile,
      userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' : undefined });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/library-workflows.html?branding', { waitUntil: 'domcontentloaded' });
    const logo = page.locator(mobile ? '.dmex-mobile-header .app-brand-mark' : '.samsung-logo-area .app-brand-mark');
    await logo.waitFor();
    await page.waitForFunction(selector => document.querySelector(selector).naturalWidth === 256, mobile ? '.dmex-mobile-header img' : '.samsung-logo-area img');
    const row = name => mobile ? page.getByRole('button', { name: `Play ${name}`, exact: true }) : page.locator('.track-item').filter({ hasText: new RegExp('^' + name) });
    const initial = await page.locator('.app-layout').evaluate(node => ({ accent: getComputedStyle(node).getPropertyValue('--theme-color').trim(),
      blobs: [1, 2, 3].map(i => getComputedStyle(node).getPropertyValue('--blob-' + i).trim()) }));
    assert.equal(initial.accent, '#3d6390'); assert.deepEqual(initial.blobs, ['#3d6390', '#1c3d6b', '#102c50']);
    const brand = await page.locator(mobile ? '.dmex-mobile-header h1' : '.samsung-logo-area').boundingBox(), actions = await page.locator(mobile ? '.dmex-mobile-header button[aria-label="Search library"]' : '.samsung-actions').boundingBox();
    assert.ok(brand.x >= 0 && brand.x + brand.width + 4 <= actions.x && actions.x + actions.width <= width, 'Brand and header actions must not overlap');
    const palette = await page.evaluate(async () => {
      const test = window.brandingTest;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 8, 8);
      return { failed: await test.getPalette('data:image/png;base64,broken'), grey: await test.getPalette(canvas.toDataURL()),
        empty: test.nudgeVibrancy(''), accents: Array.from({ length: 40 }, (_, i) => test.trackAccentColor(String(i))) };
    });
    assert.deepEqual(palette.failed, initial.blobs); assert.deepEqual(palette.grey, initial.blobs); assert.equal(palette.empty, initial.accent);
    assert.ok(!palette.accents.includes('#c8222a') && !palette.accents.includes('#c62828'));
    await page.screenshot({ path: `tests/artifacts/brand-library-${width}.png` });
    if (mobile) await page.getByRole('button', { name: 'Library options' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    if (mobile) await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    else await page.locator('.settings-brand-heading .app-brand-mark').waitFor();
    await page.getByRole('switch', { name: 'Skip call recordings' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Skip call recordings"] .audio-toggle-track')).backgroundColor === 'rgb(61, 99, 144)');
    assert.equal(await page.getByRole('switch', { name: 'Skip call recordings' }).locator('.audio-toggle-track').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(61, 99, 144)');
    await page.getByRole('combobox', { name: 'Minimum duration' }).click();
    assert.equal(await page.locator('.custom-select-popup').evaluate(node => getComputedStyle(node).getPropertyValue('--select-accent').trim()), '#3d6390');
    await page.getByRole('combobox', { name: 'Minimum duration' }).press('Escape');
    await page.screenshot({ path: `tests/artifacts/brand-settings-${width}.png` });
    if (mobile) await page.getByRole('button', { name: 'Back', exact: true }).click(); else await page.locator('.folder-modal-close').click();
    await row('Artwork song').click();
    await page.waitForFunction(() => document.querySelector('.app-layout').style.getPropertyValue('--theme-color') === '#c8222a');
    await page.evaluate(() => {
      window.brandingTest.metadataDelay = 700;
      window.paletteHistory = [];
      window.paletteObserver = new MutationObserver(() => {
        const style = document.querySelector('.app-layout').style;
        window.paletteHistory.push({ accent: style.getPropertyValue('--theme-color'),
          blobs: [1, 2, 3].map(i => style.getPropertyValue('--blob-' + i)) });
      });
      window.paletteObserver.observe(document.querySelector('.app-layout'), { attributes: true, attributeFilter: ['style'] });
    });
    await row('Second artwork song').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.app-layout').evaluate(node => node.style.getPropertyValue('--theme-color')), '#c8222a', 'Keep old artwork colors while next metadata is pending');
    await page.waitForFunction(() => document.querySelector('.app-layout').style.getPropertyValue('--theme-color') === '#35a870');
    const history = await page.evaluate(() => window.paletteHistory);
    assert.ok(history.length > 0 && history.every(entry => ['#c8222a', '#35a870'].includes(entry.accent)), 'Artwork transitions must never flash navy');
    assert.ok(history.every(entry => entry.blobs.every(color => color === entry.accent)), 'Theme and ambient colors commit together');
    await page.evaluate(() => { window.brandingTest.metadataDelay = 900; window.paletteHistory.length = 0; });
    await row('Artwork song').click();
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.brandingTest.metadataDelay = 0; });
    await row('Second artwork song').click();
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('.app-layout').evaluate(node => node.style.getPropertyValue('--theme-color')), '#35a870', 'Late previous metadata must not overwrite the newest artwork palette');
    assert.ok((await page.evaluate(() => window.paletteHistory)).every(entry => entry.accent === '#35a870'), 'Rapid skipping must not apply stale colors or navy');
    await page.evaluate(() => window.paletteObserver.disconnect());
    await row('No artwork song').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.app-layout').evaluate(node => node.style.getPropertyValue('--theme-color')), '#35a870', 'Wait for metadata before choosing the no-art fallback');
    await page.waitForFunction(() => document.querySelector('.app-layout').style.getPropertyValue('--theme-color') === '#3d6390');
    assert.equal(await page.locator('.app-layout').evaluate(node => node.style.getPropertyValue('--theme-color')), '#3d6390', 'Missing artwork resets previous album color to navy');
    await row('Artwork song').click();
    await page.waitForFunction(() => document.querySelector('.app-layout').style.getPropertyValue('--theme-color') === '#c8222a');
    await row('Broken artwork song').click();
    await page.waitForFunction(() => document.querySelector('.app-layout').style.getPropertyValue('--theme-color') === '#3d6390');
    if (mobile) await page.getByRole('button', { name: 'Open expanded player', exact: true }).click(); else await page.locator('.mini-player-content .track-info').click();
    await page.waitForFunction(() => document.querySelector('.expanded-player-content').dataset.ready === 'true');
    await page.waitForTimeout(230);
    await page.screenshot({ path: `tests/artifacts/brand-expanded-${width}.png` });
    if (mobile) await page.locator('.mep-topbar').getByRole('button', { name: 'Close', exact: true }).click();
    else await page.evaluate(() => history.back());
    await page.waitForTimeout(500);
    if (mobile) await page.getByRole('button', { name: 'Library options' }).click();
    if (mobile) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('switch', { name: 'Dark appearance', exact: true }).click(); }
    else await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.app-layout').dataset.theme === 'light');
    await page.screenshot({ path: `tests/artifacts/brand-light-${width}.png` });
    if (mobile) {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      assert.equal(await page.locator('.dmex-mobile-tabs').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)', 'Light library tabs remain pure white rather than artwork-tinted');
    }
    assert.equal(await logo.evaluate(node => node.complete && node.naturalWidth > 0), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS branding ${width}: assets, navy defaults/fallbacks, art-driven color, settings, light/dark and header bounds`);
    await context.close();
  }
} finally { await browser.close(); }
