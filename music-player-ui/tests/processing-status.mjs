import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.PLAYER_TEST_URL||'http://127.0.0.1:1420';
async function open(viewport) {
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'});
  const page=await context.newPage(),errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
  await label(page,'DmeX Natural');
  return {page,context,errors};
}
const badge=page=>page.locator('.mep-topbar-center .processing-status-badge');
const label=(page,value)=>page.waitForFunction(value=>document.querySelector('.mep-topbar-center .processing-status-badge')?.getAttribute('aria-label')?.startsWith(`Active sound: ${value}.`),value);
async function recipe(page,category,taste) {
  await page.waitForFunction(async({category,taste})=>{
    const t=window.libraryTest,expected=t.soundPreset(category,taste);
    const status=await window.__TAURI_INTERNALS__.invoke('audio_status');
    return Object.entries(expected).every(([key,value])=>Math.abs(status.settings[t.PARAM[key]]-value)<.00001);
  },{category,taste});
}
async function manual(page) {
  await page.getByRole('button',{name:'Track Options',exact:true}).click();
  await page.getByRole('slider',{name:'Subwoofer Bass',exact:true}).focus();
  await page.keyboard.press('End');
  await label(page,'Manual Override');
  await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
}
try {
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const {page,context,errors}=await open(viewport);
    await recipe(page,'JAZZ','ORIGINAL');
    await page.getByRole('button',{name:'Immersive',exact:true}).click();
    await label(page,'DmeX Natural + Immersive'); await recipe(page,'JAZZ','IMMERSIVE');
    await badge(page).click();
    await label(page,'Immersive'); await recipe(page,null,'IMMERSIVE');
    assert.equal(await page.getByRole('button',{name:'Immersive',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Chill',exact:true}).click();
    await label(page,'Chill'); await recipe(page,null,'CHILL');
    await badge(page).click();
    await label(page,'DmeX Natural + Chill'); await recipe(page,'JAZZ','CHILL');
    await page.getByRole('button',{name:'Chill',exact:true}).click();
    await label(page,'DmeX Natural'); await recipe(page,'JAZZ','ORIGINAL');
    await badge(page).click();
    await label(page,'Normal Stereo'); await recipe(page,null,'ORIGINAL');
    await page.getByRole('button',{name:'HD Clear',exact:true}).click();
    await label(page,'HD Clear');
    await manual(page);
    assert.equal(await page.getByRole('button',{name:'HD Clear',exact:true}).getAttribute('aria-pressed'),'false');
    const remembered=await page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')));
    assert.equal(remembered.taste,'QUALITY','Manual edits preserve the selected pill');
    await badge(page).click();
    await label(page,'DmeX Natural + HD Clear'); await recipe(page,'JAZZ','QUALITY');
    await manual(page);
    await page.getByRole('button',{name:'HD Clear',exact:true}).click();
    await label(page,'DmeX Natural + HD Clear'); await recipe(page,'JAZZ','QUALITY');
    await page.getByRole('button',{name:'HD Clear',exact:true}).click();
    await label(page,'DmeX Natural');
    await manual(page); await badge(page).click();
    await label(page,'DmeX Natural'); await recipe(page,'JAZZ','ORIGINAL');
    const bounds=await badge(page).boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width,'Status fits portrait and landscape');
    await page.screenshot({path:`tests/artifacts/processing-status-${viewport.width}.png`});
    await page.locator('.mep-topbar [aria-label=Close]').click();
    await page.getByRole('button',{name:'Play Every Little Moment 4',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await page.getByRole('button',{name:'Immersive',exact:true}).click();
    await label(page,'DmeX Natural + Immersive');
    const pillBounds=await badge(page).locator('.processing-pill').boundingBox(),tagBounds=await badge(page).boundingBox();
    assert.ok(pillBounds.x>=tagBounds.x&&pillBounds.x+pillBounds.width<=tagBounds.x+tagBounds.width,'Long category never hides the selected pill');
    await page.screenshot({path:`tests/artifacts/processing-status-combined-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: category/pill independence, actual DSP recipes, manual recovery with/without pill, bounded badge`);
    await context.close();
  }
  for(const persisted of [false,true]) {
    const context=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile'});
    if(persisted) await context.addInitScript(()=>localStorage.setItem('dmex_sound_selection_v1',JSON.stringify({categoryEnabled:false,taste:'CHILL',manual:false})));
    const page=await context.newPage();
    await page.goto(base+'/tests/mobile-redesign.html?mobile&iteration&legacy-manual',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await label(page,persisted?'Chill':'Manual Override');
    if(!persisted) { await badge(page).click(); await label(page,'DmeX Natural + Immersive'); await recipe(page,'JAZZ','IMMERSIVE'); }
    await context.close();
  }
  console.log('PASS: legacy manual/pill migration and new selection precedence');
  {
    const {page,context}=await open({width:360,height:800});
    await page.getByRole('button',{name:'HD Clear',exact:true}).click(); await label(page,'DmeX Natural + HD Clear');
    await page.evaluate(()=>{window.libraryTest.applyFailureCount=1;});
    await page.getByRole('button',{name:'Immersive',exact:true}).click(); await label(page,'Manual Override');
    await recipe(page,'JAZZ','QUALITY');
    await badge(page).click(); await label(page,'DmeX Natural + Immersive'); await recipe(page,'JAZZ','IMMERSIVE');
    await page.evaluate(()=>{window.libraryTest.applyDelay=350;});
    await page.getByRole('button',{name:'Chill',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.getAttribute('aria-busy')==='true');
    await label(page,'DmeX Natural + Chill'); await recipe(page,'JAZZ','CHILL');
    await page.evaluate(()=>{window.libraryTest.applyDelay=0;});
    await page.getByRole('button',{name:'Track Options',exact:true}).click();
    await page.getByRole('button',{name:'Bypass All',exact:true}).click();
    await label(page,'Raw Stereo'); assert.ok(await badge(page).isDisabled());
    assert.ok(await page.getByRole('button',{name:'Chill',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Bypass All',exact:true}).click();
    await label(page,'DmeX Natural + Chill'); await recipe(page,'JAZZ','CHILL');
    await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
    await badge(page).click(); await label(page,'Chill');
    await page.waitForTimeout(800); await page.evaluate(()=>window.libraryTest.remount());
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await label(page,'Chill'); await recipe(page,null,'CHILL');
    await manual(page); await page.waitForTimeout(800); await page.evaluate(()=>window.libraryTest.remount());
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await label(page,'Manual Override');
    await badge(page).click(); await label(page,'DmeX Natural + Chill'); await recipe(page,'JAZZ','CHILL');
    console.log('PASS: failed applies never claim a preset, pending acknowledgement, raw-bypass priority, persisted category/pill/manual and recovery after restart');
    await context.close();
  }
} finally {await browser.close();}
