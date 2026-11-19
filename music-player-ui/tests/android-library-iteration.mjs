import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
if(process.env.ANDROID_MEDIA_TEST!=='approved') throw new Error('Obtain permission for device verification first.');
const run=promisify(execFile);
const adb=async(...args)=>(await run('C:/Users/LEGION/AppData/Local/Android/Sdk/platform-tools/adb.exe',['-s',process.env.ANDROID_SERIAL||'RZGLA093AAA',...args])).stdout;
const pid=(await adb('shell','pidof','com.dmex.player')).trim();
await adb('forward','tcp:9223','localabstract:webview_devtools_remote_'+pid);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(page=>page.url().includes('tauri.localhost'));
const native=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const saved=await page.evaluate(()=>Object.fromEntries(['dmex_mobile_sort','dmex_mobile_sort_reverse','dmex_mobile_category'].map(key=>[key,localStorage.getItem(key)])));
try {
  const tracks=await native('fetch_library');
  const absent=await native('remove_missing_track',{path:'/storage/emulated/0/Music/__dmex_missing_probe_20261119__.flac'});
  assert.deepEqual(absent,{removed:true,status:'missing'},'Native check recognizes a confirmed absent local file');
  assert.equal((await native('fetch_library')).length,tracks.length,'Synthetic absence check did not change the real library');
  await page.getByRole('button',{name:'Sort tracks',exact:true}).click();
  await page.getByRole('button',{name:'Release year, oldest first',exact:true}).click();
  await page.locator('.dmex-mobile-track-section').first().waitFor();
  await page.getByRole('button',{name:'Filter tracks',exact:true}).click();
  await page.getByRole('button',{name:'90s Bollywood Classics (1880-2003)',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Filter tracks',exact:true}).getAttribute('aria-pressed'),'true');
  const headings=await page.locator('.dmex-mobile-track-section').allTextContents();
  assert.ok(headings.every(value=>Number(value)>=1880&&Number(value)<=2003));
  console.log(`PASS device: ${tracks.length} saved tracks retained; native missing-file detection, year sort and year-only classics filter`);
} finally {
  await page.evaluate(saved=>{for(const [key,value]of Object.entries(saved))value===null?localStorage.removeItem(key):localStorage.setItem(key,value);},saved);
  await page.reload({waitUntil:'domcontentloaded'});
  await browser.close();
}
