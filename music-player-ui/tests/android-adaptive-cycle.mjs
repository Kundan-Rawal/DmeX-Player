import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
if(process.env.ANDROID_ADAPTIVE_TEST!=='approved') throw new Error('Obtain approval to test processing controls with playback stopped.');
const run=promisify(execFile), serial=process.env.ANDROID_SERIAL;
if(!serial) throw new Error('ANDROID_SERIAL is required.');
const adb=async(...args)=>(await run('C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args])).stdout;
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));
  const before=await page.evaluate(async()=>await window.__TAURI_INTERNALS__.invoke('audio_status'));
  if(process.env.ANDROID_EXPECTED_BUNDLE) assert.ok(await page.evaluate(bundle=>[...document.scripts].some(s=>s.src.includes(bundle)),process.env.ANDROID_EXPECTED_BUNDLE));
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0,'The device test never starts/stops music; restart must leave playback paused.');
  const badge=page.locator('.mep-topbar-center .processing-status-badge');
  const opened=!await badge.isVisible();
  if(opened) await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
  await badge.waitFor();
  if(await badge.getAttribute('data-processing-kind')==='manual') await badge.click();
  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='automatic');
  await page.evaluate(()=>{window.adaptiveDeviceErrors=[];window.addEventListener('dmex-audio-error',e=>{if(e.detail)window.adaptiveDeviceErrors.push(e.detail);});});
  await page.getByRole('button',{name:'Track Options',exact:true}).click();
  const bypass=page.getByRole('button',{name:'Bypass All',exact:true});
  const sourceTokens=[];
  for(let iteration=0;iteration<5;++iteration) {
    await bypass.click();
    await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');return s.bypassAll&&document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='raw';});
    await bypass.click();
    await page.waitForFunction(async()=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');const mode=JSON.parse(localStorage.getItem('dmex_sound_selection_v1'));const badge=document.querySelector('.mep-topbar-center .processing-status-badge');return !s.bypassAll&&!mode.manual&&badge?.dataset.processingKind==='automatic'&&badge.getAttribute('aria-busy')==='false';});
    const state=await page.evaluate(async()=>({s:await window.__TAURI_INTERNALS__.invoke('audio_status'),errors:window.adaptiveDeviceErrors}));
    assert.equal(state.s.settings[8],before.settings[8]);assert.deepEqual(state.errors,[]);
    assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0);
    sourceTokens.push(state.s.sourceGeneration);
  }
  assert.ok(sourceTokens.every((token,index)=>index===0||token>sourceTokens[index-1]));
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
  if(opened) await page.locator('.mep-topbar [aria-label=Close]').click();
  console.log(JSON.stringify({result:'PASS actual Android UI: five Raw Stereo to DmeX Natural cycles, no command errors, no Manual Override fallback, unchanged volume, no playback',sourceTokens}));
} finally {await browser.close();}
