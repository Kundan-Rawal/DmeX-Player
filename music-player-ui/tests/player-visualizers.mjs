import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PLAYER_TEST_URL || 'http://localhost:1420';
const artifacts = new URL('./artifacts/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'android' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 360, height: 800 } : { width: 1440, height: 900 },
      deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile,
      userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36' : undefined });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/player-visualizers.html');
    const bypass = page.getByRole('button', { name: 'Bypass All', exact: true });
    await bypass.waitFor();
    await page.waitForFunction(() => !document.querySelector('.audio-bypass-button')?.disabled);
    assert.equal(await page.getByRole('heading', { name: 'Fine-Tune DSP' }).count(), 0, 'DSP must not replace Track Options');
    assert.equal(await page.locator('.glass-menu-header').textContent(), 'Track Options');
    await bypass.click();
    await page.waitForFunction(() => document.querySelector('.audio-bypass-button')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.getByRole('slider', { name: 'Subwoofer Bass' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Orbit', exact: true }).isDisabled(), false);
    await page.waitForTimeout(1600);
    const canvasSignature = () => page.evaluate(() => {
      const canvas = Array.from(document.querySelectorAll('canvas')).find(c => c.width > 0 && c.height > 0);
      if (!canvas) throw new Error('Missing visualizer canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0, hash = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { ++lit; hash = (hash + i * pixels[i]) % 2147483647; }
      return { lit, hash };
    });
    const before = await canvasSignature();
    await page.waitForTimeout(250);
    const after = await canvasSignature();
    assert.ok(before.lit > 0 && after.lit > 0, name + ' canvas must be nonblank');
    assert.notEqual(before.hash, after.hash, name + ' canvas must move in raw mode');
    if (mobile) assert.ok(await page.locator('.mep-neon-ripple').evaluateAll(nodes =>
      nodes.some(n => getComputedStyle(n).animationName === 'mep-neon-expand')), 'Android beat ripple must animate');
    await page.screenshot({ path: new URL(name + '-track-options.png', artifacts).pathname.replace(/^\/(\w:)/, '$1') });
    await bypass.click();
    await page.waitForFunction(() => document.querySelector('.audio-bypass-button')?.getAttribute('aria-pressed') === 'false');
    await page.getByRole('button', { name: 'Low', exact: true }).click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.glass-boost-btn')).some(
      n => n.textContent === 'Low' && n.getAttribute('aria-pressed') === 'true'));
    await page.getByRole('button', { name: 'Orbit', exact: true }).click();
    assert.ok(await page.locator('.ambient-background .blob').count() > 0, 'Orbit remains selectable');
    await page.goto(base + '/tests/player-visualizers.html?dsp');
    await page.getByRole('heading', { name: 'Fine-Tune DSP' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.audio-toggle-switch') && !document.querySelector('.audio-toggle-switch').disabled);
    assert.equal(await page.locator('.track-options').count(), 0, 'DSP must remain a distinct surface');
    assert.equal(await page.getByRole('button', { name: 'Bypass All', exact: true }).count(), 0, 'No duplicate DSP bypass');
    assert.equal(await page.locator('input[type=checkbox], select, .manual-presets').count(), 0, 'DSP uses switches/custom selects without manual preset buttons');
    const compressor = page.getByRole('switch', { name: 'Studio Compressor' });
    await compressor.click();
    assert.equal(await compressor.getAttribute('aria-checked'), 'true');
    await page.getByRole('combobox', { name: 'Sub-bass frequency' }).click();
    await page.getByRole('option', { name: '70 Hz', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Sub-bass frequency"]').textContent.includes('70 Hz'));
    const quality = page.getByRole('combobox', { name: 'Processing quality' });
    await quality.focus();
    await quality.press('ArrowDown');
    assert.equal(await page.getByRole('listbox').count(), 1);
    await quality.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    await page.getByRole('combobox', { name: 'Headphone correction' }).click();
    await page.getByRole('textbox', { name: 'Search Headphone correction' }).fill('sennheiser');
    assert.equal(await page.getByRole('option').count(), 1, 'Long dropdown lists support search');
    await page.getByRole('textbox', { name: 'Search Headphone correction' }).press('Escape');
    assert.ok(await page.locator('.studio-dashboard').evaluate(node => node.scrollWidth <= node.clientWidth), 'DSP fits its viewport');
    await page.screenshot({ path: new URL(name + '-dsp.png', artifacts).pathname.replace(/^\/(\w:)/, '$1') });
    assert.deepEqual(errors, [], 'No component runtime errors');
    console.log('PASS ' + name + ': raw/enhanced controls, animated nonblank canvas, separate DSP');
    await context.close();
  }
} finally { await browser.close(); }
