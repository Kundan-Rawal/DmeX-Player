import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
if(process.env.ANDROID_ENHANCED_TEST!=='approved')throw new Error('Install/paused verification approval required.');
const run=promisify(execFile),serial=process.env.ANDROID_SERIAL;
if(!serial)throw new Error('ANDROID_SERIAL is required.');
const adb=async(...args)=>(await run('C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',serial,...args])).stdout;
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const compiled=(await build({entryPoints:['src/config/enhancement.ts'],bundle:true,write:false,platform:'node',format:'esm'})).outputFiles[0].text;
const {enhancedPreset,validSignature}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('tauri.localhost'));
  await page.waitForFunction(async()=>(await window.__TAURI_INTERNALS__.invoke('audio_status')).ready&&document.querySelector('button[aria-label="Open expanded player"]'));
  await page.waitForTimeout(3000);
  const before=await page.evaluate(async()=>({status:await window.__TAURI_INTERNALS__.invoke('audio_status'),mode:JSON.parse(localStorage.getItem('dmex_sound_selection_v1')),queue:JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')||'null'),scripts:[...document.scripts].map(s=>s.src)}));
  assert.equal(before.status.engineRevision,'842a9f2');
  if(process.env.ANDROID_EXPECTED_BUNDLE)assert.ok(before.scripts.some(src=>src.includes(process.env.ANDROID_EXPECTED_BUNDLE)),'Installed bundle matches final build');
  if(process.env.ANDROID_EXPECTED_VOLUME)assert.ok(Math.abs(before.status.settings[8]-Number(process.env.ANDROID_EXPECTED_VOLUME))<1e-5);
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0,'No playback started');
  const entry=before.queue?.entries.find(entry=>entry.id===before.queue.currentId);
  let signature=null;
  if(entry?.track?.path&&!entry.track.source?.includes('cloud')) {
    signature=await page.evaluate(path=>window.__TAURI_INTERNALS__.invoke('analyze_track_signature',{path}),entry.track.path);
    assert.ok(validSignature(signature),'Native decoder produces a valid recording signature');
  }
  if(signature&&!before.mode.manual&&!before.status.bypassAll&&(before.mode.categoryEnabled||before.mode.taste!=='ORIGINAL')) {
    const indices={bass:0,treble:1,exciter:2,width:3,separation:4,depth:5,reverb:6,subBassHz:9,bassField:10,roomBass:11,vocal:12,air:16,spatial:17};
    const expected=enhancedPreset(before.mode.taste,signature);
    await page.waitForFunction(async({expected,indices})=>{const s=await window.__TAURI_INTERNALS__.invoke('audio_status');return Object.entries(expected).every(([key,value])=>Math.abs(s.settings[indices[key]]-value)<1e-4);},{expected,indices});
  }
  const after=await page.evaluate(async()=>({status:await window.__TAURI_INTERNALS__.invoke('audio_status'),mode:JSON.parse(localStorage.getItem('dmex_sound_selection_v1')),alerts:[...document.querySelectorAll('.audio-global-error')].map(n=>n.textContent)}));
  assert.deepEqual(after.mode,before.mode);assert.equal(after.status.settings[8],before.status.settings[8]);
  assert.deepEqual(after.alerts,[]);assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0);
  console.log(JSON.stringify({result:'PASS installed native signature and recording-adapted values, preserved mode/volume, no errors, no playback',bundle:process.env.ANDROID_EXPECTED_BUNDLE,mode:after.mode,settings:after.status.settings,signature}));
}finally{await browser.close();}
