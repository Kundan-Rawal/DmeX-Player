import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
if (process.env.ANDROID_MEDIA_TEST !== 'approved') throw new Error('Obtain permission to change phone playback, then set ANDROID_MEDIA_TEST=approved.');
const run=promisify(execFile), serial=process.env.ANDROID_SERIAL || 'RZGLA093AAA';
const adb=async(...args)=>(await run(process.env.ADB_PATH || 'C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args])).stdout;
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(value=>value.url().includes('tauri.localhost'));
const native=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const media=action=>adb('shell','cmd','media_session','dispatch',action);
const playing=value=>page.waitForFunction(value=>!!document.querySelector('.dmex-mobile-mini [aria-label=Pause]')===value,value,{timeout:8000});
const probe=permanent=>adb('shell','am','start','-W','-n','com.dmex.focusprobe/.FocusProbe','--ez','permanent',String(permanent),'--ei','duration','3000');
let position, volume;
try {
  await adb('install','-r','tests/artifacts/focus-probe/focus-probe.apk');
  if(await page.locator('.dmex-mobile-mini-info').isDisabled()) {
    await page.locator('.dmex-mobile-track-play').first().click();
  }
  position=(await native('audio_metrics')).currentTime; volume=(await native('audio_status')).settings[8];
  await media('play'); await playing(true);
  await probe(false); await playing(false);
  const services=await adb('shell','dumpsys','activity','services','com.dmex.player');
  assert.ok(services.includes('isForeground=true'),'Retain foreground service during transient interruption');
  const stopped=(await native('audio_metrics')).currentTime;
  await page.waitForTimeout(200);
  assert.ok(Math.abs((await native('audio_metrics')).currentTime-stopped)<.05,'Real engine cursor pauses during focus loss');
  await playing(true);
  const resumed=(await native('audio_metrics')).currentTime;
  await page.waitForTimeout(300);
  assert.ok((await native('audio_metrics')).currentTime>resumed+.1,'Real cursor advances after Android focus gain');
  console.log('PASS device: real Android transient audio-focus loss pauses and focus gain resumes native PCM playback');

  await media('pause'); await playing(false);
  await probe(false); await page.waitForTimeout(3500);
  assert.equal(await page.locator('.dmex-mobile-mini [aria-label=Pause]').count(),0,'Already paused remains paused');
  console.log('PASS device: notifications cannot start an already paused track');

  await adb('shell','am','start','-n','com.dmex.player/.MainActivity');
  await media('play'); await playing(true);
  await probe(false); await playing(false);
  await native('audio_command',{cmd:'PAUSE'});
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('.dmex-mobile-mini [aria-label=Pause]').count(),0,'Explicit user pause cancels automatic resume');
  console.log('PASS device: explicit pause during interruption cancels resume');

  await adb('shell','am','start','-n','com.dmex.player/.MainActivity');
  await media('play'); await playing(true);
  await probe(true); await playing(false); await page.waitForTimeout(3500);
  assert.equal(await page.locator('.dmex-mobile-mini [aria-label=Pause]').count(),0,'Permanent focus loss does not auto resume');
  assert.equal((await native('audio_status')).settings[8],volume,'Volume was not changed');
  console.log('PASS device: permanent focus loss remains paused; volume unchanged');
} finally {
  try { await media('pause'); } catch {}
  try { if(position!==undefined) { await native('audio_command',{cmd:`SEEK ${position}`}); await native('plugin:event|emit',{event:'mobile-transport',payload:{action:5,position:position*1000,playing:false,ok:true}}); } } catch {}
  try { await adb('uninstall','com.dmex.focusprobe'); } catch {}
  try { await adb('shell','am','start','-n','com.dmex.player/.MainActivity'); } catch {}
  await browser.close();
}
