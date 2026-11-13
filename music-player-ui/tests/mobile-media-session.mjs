import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto((process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420') + '/tests/mobile-redesign.html?mobile');
  await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).click();
  await page.waitForFunction(() => window.libraryTest.calls.some(call => call.command === 'mobile_media_update' && call.payload.state.title === 'Night Drive 1' && call.payload.state.playing));
  const emit = (action, playing, position = 0) => page.evaluate(args => window.libraryTest.emit('mobile-transport', { ...args, ok: true }), { action, playing, position });
  await emit(2, false);
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  const before = await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'audio_command' && /^(PLAY|PAUSE)/.test(call.payload.cmd)).length);
  await emit(1, true);
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.libraryTest.calls.filter(call => call.command === 'audio_command' && /^(PLAY|PAUSE)/.test(call.payload.cmd)).length), before, 'Native transport state does not toggle the engine a second time');
  await emit(3, true);
  await page.waitForFunction(() => window.libraryTest.calls.some(call => call.command === 'mobile_media_update' && call.payload.state.title === 'Paper Lanterns 2'));
  await emit(4, true);
  await page.waitForFunction(() => window.libraryTest.calls.filter(call => call.command === 'mobile_media_update' && call.payload.state.title === 'Night Drive 1').length >= 2);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1') || 'null')?.entries.length === 80);
  const current = await page.evaluate(() => JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')));
  assert.ok(current.entries.length === 80, 'Headset navigation uses the existing queue');
  assert.deepEqual(errors, []);
  console.log('PASS media session: metadata/state publishing, native pause/play synchronization without duplicate commands, next/previous through shared queue');
  await context.close();
} finally { await browser.close(); }
