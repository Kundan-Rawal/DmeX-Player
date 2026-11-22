import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile'});
const quiet={version:1,confidence:.65,sampledSeconds:12,activeSeconds:12,rmsDbfs:-29,peakDbfs:-14,crestDb:15,correlation:.5,sideRatio:.25,bassRatio:.2,lowMidRatio:.25,presenceRatio:.25,highRatio:.1,highFlatness:.2};
const loud={...quiet,rmsDbfs:-15,peakDbfs:-2,crestDb:13};
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const badge=()=>page.locator('.mep-topbar-center .processing-status-badge');
const status=()=>page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));
const selection=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')));
async function play(name) {
  await page.getByRole('button',{name:'Play '+name,exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
}
async function open(){await page.getByRole('button',{name:'Open expanded player',exact:true}).click();}
async function close(){await page.locator('.mep-topbar [aria-label=Close]').click();}
async function boost(value){await page.waitForFunction(async value=>(await window.__TAURI_INTERNALS__.invoke('audio_status')).settings[18]===value,value);}
try {
  await page.goto((process.env.PLAYER_TEST_URL||'http://127.0.0.1:1420')+'/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).waitFor();
  await page.evaluate(()=>{window.libraryTest.applyFailureCount=1;});
  await play('Night Drive 1');
  assert.equal((await selection()).manual,true);
  assert.match(await page.getByRole('alert').innerText(),/Fixture DSP update failed/,'Unrelated successful transport/boost updates do not hide the DSP error');
  await page.getByRole('button',{name:'Dismiss audio error',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.libraryTest.calls)).filter(c=>c.command==='remove_missing_track').length,0,'DSP failure is not a missing source');
  await open();await badge().click();
  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='automatic');
  await close();
  await page.evaluate(s=>{window.libraryTest.signatureResult=s;},quiet);
  await play('Paper Lanterns 2');await boost(.3);
  await open();await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
  const voice=page.getByRole('slider',{name:'Vocal Frontness',exact:true});await voice.focus();await page.keyboard.press('Home');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')).manual);
  await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
  assert.match(await badge().getAttribute('title'),/Manual tone and spatial settings/);
  await page.getByRole('button',{name:'Track Options',exact:true}).click();
  await page.getByRole('button',{name:'Bypass All',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='raw');
  const rawSettings=(await status()).settings;
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
  await close();
  await page.evaluate(s=>{window.libraryTest.signatureResult=s;},loud);
  await play('Open Water 3');
  assert.deepEqual((await status()).settings,rawSettings,'Loading in raw/Manual mode cannot reset saved speaker boost');
  await open();await page.getByRole('button',{name:'Track Options',exact:true}).click();
  await page.getByRole('button',{name:'Bypass All',exact:true}).click();
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});await close();
  await boost(0);await page.waitForTimeout(1200);
  assert.equal((await status()).settings[12],0);
  await page.evaluate(s=>{window.libraryTest.signatureResult=s;},quiet);
  await play('Every Little Moment 4');await boost(.3);
  assert.equal((await selection()).manual,true);assert.equal((await status()).settings[12],0);
  await open();await page.getByRole('button',{name:'Track Options',exact:true}).click();
  await page.getByRole('group',{name:'Speaker Boost',exact:true}).getByRole('button',{name:'High',exact:true}).click();await boost(1);
  assert.equal(await page.getByRole('switch',{name:'Automatic speaker boost',exact:true}).getAttribute('aria-checked'),'false');
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
  await badge().click();
  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='automatic');
  assert.equal((await status()).settings[18],1,'Independent user speaker boost survives preset recovery');
  await close();
  await page.evaluate(()=>{window.libraryTest.signatureFailure=true;});
  await play('Night Drive 1');await page.waitForTimeout(1300);
  assert.equal((await selection()).manual,false,'Signature failure retains reference, not Manual');
  const reference=await page.evaluate(()=>window.libraryTest.referencePreset('ORIGINAL'));
  const actual=await status();
  for(const [key,value]of Object.entries(reference)){const index=await page.evaluate(key=>window.libraryTest.PARAM[key],key);assert.ok(Math.abs(actual.settings[index]-value)<1e-5);}
  assert.equal(actual.settings[18],1);
  await open();await badge().click();
  await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='normal');
  assert.match(await badge().getAttribute('title'),/Enhancement disabled/);
  assert.deepEqual(errors,[]);
  console.log('PASS reference-apply failure does not block transport; Manual automatic boost follows new sources; independent boost survives preset recovery; analysis failure/reference fallback; truthful status details');
}finally{await browser.close();}
