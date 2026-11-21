import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
if(process.env.ANDROID_ORIGINAL_TEST!=='approved') throw new Error('Obtain approval to test processing controls with playback stopped.');
const run=promisify(execFile), serial=process.env.ANDROID_SERIAL;
if(!serial) throw new Error('ANDROID_SERIAL is required.');
const adb=async(...args)=>(await run('C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args])).stdout;
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));
  await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');return s.ready&&document.querySelector('button[aria-label="Open expanded player"]');});
  const before=await page.evaluate(async()=>await window.__TAURI_INTERNALS__.invoke('audio_status'));
  assert.equal(before.engineRevision,'842a9f2');
  const savedMode=await page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')));
  assert.equal(savedMode.manual,false,'Leave genuine manual settings untouched; run this test in Original mode.');
  assert.equal(savedMode.taste,'ORIGINAL','Leave a selected pill untouched.');
  assert.equal(before.bypassAll,false,'Leave an existing raw-stereo selection untouched.');
  if(process.env.ANDROID_EXPECTED_BUNDLE) assert.ok(await page.evaluate(bundle=>[...document.scripts].some(s=>s.src.includes(bundle)),process.env.ANDROID_EXPECTED_BUNDLE));
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0,'The device test never starts/stops music; restart must leave playback paused.');
  const badge=page.locator('.mep-topbar-center .processing-status-badge');
  const opened=!await badge.isVisible();
  if(opened) await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
  await badge.waitFor();
  if(!savedMode.categoryEnabled) await badge.click();

  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='automatic');
  await page.evaluate(()=>{window.adaptiveDeviceErrors=[];window.addEventListener('dmex-audio-error',e=>{if(e.detail)window.adaptiveDeviceErrors.push(e.detail);});});
  await page.getByRole('button',{name:'Track Options',exact:true}).click();
  const bypass=page.getByRole('button',{name:'Bypass All',exact:true});
  let cycles=0;
  for(let iteration=0;iteration<5;++iteration) {
    await bypass.click();
    await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');return s.bypassAll&&document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='raw';});
    await bypass.click();
    await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');const mode=JSON.parse(localStorage.getItem('dmex_sound_selection_v1'));const badge=document.querySelector('.mep-topbar-center .processing-status-badge');return !s.bypassAll&&!mode.manual&&badge?.dataset.processingKind==='automatic'&&badge.getAttribute('aria-busy')==='false';});
    const state=await page.evaluate(async()=>({s:await window.__TAURI_INTERNALS__.invoke('audio_status'),errors:window.adaptiveDeviceErrors}));
    assert.equal(state.s.settings[8],before.settings[8]);assert.deepEqual(state.errors,[]);
    assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0);
    before.settings.forEach((value,index)=>assert.ok(Math.abs(state.s.settings[index]-value)<.00001));
    ++cycles;
  }
  assert.equal(cycles,5);
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
  if(!savedMode.categoryEnabled) {
    await badge.click();
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='normal');
  }
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1'))),savedMode);
  const final=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));
  before.settings.forEach((value,index)=>assert.ok(Math.abs(final.settings[index]-value)<.00001));
  if(opened) await page.locator('.mep-topbar [aria-label=Close]').click();
  console.log(JSON.stringify({result:'PASS actual Android UI: five Raw Stereo to DmeX Original cycles, no command errors, no Manual Override fallback, restored starting selection and controls, unchanged volume, no playback',cycles}));
} finally {await browser.close();}
