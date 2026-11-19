import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
if(process.env.ANDROID_STATUS_TEST!=='approved') throw new Error('Obtain approval to install/open the update before device verification.');
const run=promisify(execFile);
const adb=async(...args)=>(await run('C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',process.env.ANDROID_SERIAL||'RZGLA093AAA',...args])).stdout;
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(page=>page.url().includes('tauri.localhost'));
const compiled=ts.transpileModule(await readFile('src/config/soundPresets.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {soundPreset,CATEGORY_LABELS}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const badge=page.locator('.mep-topbar-center .processing-status-badge');
let opened=false;
try {
  await page.getByRole('button',{name:'Open expanded player',exact:true}).waitFor();
  if(!await badge.isVisible()) {await page.getByRole('button',{name:'Open expanded player',exact:true}).click();opened=true;}
  await page.waitForFunction(()=>{const node=document.querySelector('.mep-topbar-center .processing-status-badge');return node&&node.dataset.processingKind!=='pending';});
  const mode=await page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')));
  const status=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));
  const kind=await badge.getAttribute('data-processing-kind');
  if(status.bypassAll) assert.equal(kind,'raw');
  else if(mode.manual) assert.equal(kind,'manual');
  else {
    const category=mode.categoryEnabled ? await badge.locator('.processing-category').textContent() : null;
    const id=category ? Object.keys(CATEGORY_LABELS).find(id=>CATEGORY_LABELS[id]===category) : null;
    if(category) assert.ok(id,'Badge category resolves to a real engine recipe');
    const expected=soundPreset(id,mode.taste);
    const indices={bass:0,treble:1,exciter:2,width:3,separation:4,depth:5,reverb:6,compressor:7,bassField:10,roomBass:11,vocal:12,loudness:13,roomSize:14,damping:15,air:16,spatial:17,boost:18};
    for(const [key,value]of Object.entries(expected)) assert.ok(Math.abs(status.settings[indices[key]]-value)<.0001,`${key} agrees with the displayed category/pill recipe`);
  }
  console.log('PASS device: '+await badge.getAttribute('aria-label')+'; acknowledged native settings agree; playback and volume not touched');
} finally {
  if(opened) {try{await page.locator('.mep-topbar [aria-label=Close]').click();}catch{}}
  await browser.close();
}
