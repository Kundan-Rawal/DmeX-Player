import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

if (process.env.ANDROID_MEDIA_TEST !== 'approved') throw new Error('This test changes phone playback. Obtain permission, then set ANDROID_MEDIA_TEST=approved.');
const run = promisify(execFile), serial = process.env.ANDROID_SERIAL || 'RZGLA093AAA';
const adb = async (...args) => (await run(process.env.ADB_PATH || 'C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe', ['-s', serial, ...args])).stdout;
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const pid = (await adb('shell', 'pidof', 'com.dmex.player')).trim();
await adb('forward', 'tcp:9223', 'localabstract:webview_devtools_remote_' + pid);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages().find(value => value.url().includes('tauri.localhost'));
const native = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const playing = value => page.waitForFunction(value => !!document.querySelector('.dmex-mobile-mini [aria-label=Pause]') === value, value, { timeout: 8000 });
const key = (...values) => adb('shell', 'input', 'keyevent', ...values.map(String));
const session = value => adb('shell', 'cmd', 'media_session', 'dispatch', value);
const title = () => page.locator('.dmex-mobile-mini-info strong').innerText();
const waitTitle = value => page.waitForFunction(value => document.querySelector('.dmex-mobile-mini-info strong')?.textContent === value, value, { timeout: 10000 });
let originalTitle, originalPosition;
try {
  assert.ok((await adb('shell', 'cmd', 'media_session', 'list-sessions')).includes('package=com.dmex.player'), 'Native session is actually registered, not just a successful IPC acknowledgement');
  originalTitle = await title(); originalPosition = (await native('audio_metrics')).currentTime;
  await session('play'); await playing(true);
  const before = (await native('audio_metrics')).currentTime;
  await page.waitForTimeout(450);
  assert.ok((await native('audio_metrics')).currentTime > before + .2, 'Session Play advances the real engine cursor');
  await session('pause'); await playing(false);
  const paused = (await native('audio_metrics')).currentTime;
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await native('audio_metrics')).currentTime - paused) < .02, 'Session Pause stops the real engine cursor');
  console.log('PASS device: registered session and real-engine play/pause through Android MediaSession');

  await key(87);
  await page.waitForFunction(value => document.querySelector('.dmex-mobile-mini-info strong')?.textContent !== value, originalTitle);
  const nextTitle = await title(); await playing(true);
  await key(127); await playing(false);
  await key(88); await waitTitle(originalTitle); await playing(true);
  await key(127); await playing(false);
  console.log('PASS device: dedicated media Next/Previous and UI/queue synchronization');

  await key(85); await playing(true);
  await key(85); await playing(false);
  await key(85, 85); await waitTitle(nextTitle); await playing(true);
  await key(127); await playing(false);
  await key(85, 85, 85); await waitTitle(originalTitle); await playing(true);
  await key(127); await playing(false);
  console.log('PASS device: simulated center single/double/triple clicks; physical earphone firmware not tested');

  await key(3);
  await session('play'); await playing(true);
  const services = await adb('shell', 'dumpsys', 'activity', 'services', 'com.dmex.player');
  assert.ok(services.includes('PlaybackService') && services.includes('isForeground=true'), 'Native playback service is foreground while the UI is hidden');
  await session('pause'); await playing(false);
  await adb('shell', 'am', 'start', '-n', 'com.dmex.player/.MainActivity');
  console.log('PASS device: media-session play/pause with activity in background and native foreground service');

  // Restore the original paused cursor through the existing engine, then synchronize its UI acknowledgement.
  await native('audio_command', { cmd: `SEEK ${originalPosition}` });
  await native('plugin:event|emit', { event: 'mobile-transport', payload: { action: 5, position: originalPosition * 1000, playing: false, ok: true } });
  console.log('PASS cleanup: original track/cursor restored paused; no volume commands sent');
} finally {
  try { await session('pause'); } catch {}
  try { await adb('shell', 'am', 'start', '-n', 'com.dmex.player/.MainActivity'); } catch {}
  await browser.close();
}
