import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.PLAYER_TEST_URL||'http://127.0.0.1:1420';
const signature={version:1,confidence:1,sampledSeconds:12,activeSeconds:12,rmsDbfs:-18,peakDbfs:-2,crestDb:16,correlation:.98,sideRatio:.01,bassRatio:.05,lowMidRatio:.45,presenceRatio:.1,highRatio:.02,highFlatness:.2};
async function matches(page,taste,adapted) {
  await page.waitForFunction(async({taste,adapted})=>{
    const t=window.libraryTest,s=await window.__TAURI_INTERNALS__.invoke('audio_status');
    const expected=t.enhancedPreset(taste,adapted?t.signatureResult:null);
    return Object.entries(expected).every(([key,value])=>Math.abs(s.settings[t.PARAM[key]]-value)<1e-5);
  },{taste,adapted});
}
const mode=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')));
const status=page=>page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));
const closeMenu=page=>page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
try {
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile'});
    await context.addInitScript(()=>{
      localStorage.setItem('dmex_audio_v2',JSON.stringify([0,0,0,1,0,0,0,1,.37,60,0,0,0,1,.72,.6,0,0,.3,0]));
      localStorage.setItem('dmex_speaker_boost_auto','false');
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
    await page.evaluate(s=>{window.libraryTest.signatureResult=s;window.libraryTest.signatureDelay=180;},signature);
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await matches(page,'ORIGINAL',true);
    const badge=page.locator('.mep-topbar-center .processing-status-badge');
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.textContent==='DmeX Enhanced');
    for(const [taste,label] of [['QUALITY','HD Clear'],['IMMERSIVE','Immersive'],['CHILL','Chill']]) {
      await page.getByRole('button',{name:label,exact:true}).click();await matches(page,taste,true);
      const s=await status(page);
      for(const [index,value] of [[7,1],[8,.37],[13,1],[14,.72],[15,.6],[18,.3]])assert.ok(Math.abs(s.settings[index]-value)<1e-5,'Presets preserve independent controls');
    }
    await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
    for(const label of ['Studio Compressor','Adaptive Loudness','Automatic reverb']) {
      await page.getByRole('switch',{name:label,exact:true}).click();
      assert.equal((await mode(page)).manual,false,`${label} must not enter Manual Override`);
    }
    for(const label of ['Room Size','Damping']) {
      const slider=page.getByRole('slider',{name:label,exact:true});await slider.focus();await page.keyboard.press('ArrowLeft');
      assert.equal((await mode(page)).manual,false);
    }
    await page.getByRole('combobox',{name:'Acoustic impulse response',exact:true}).click();
    await page.getByRole('option',{name:'Head-360 Surround',exact:true}).click();
    assert.equal((await mode(page)).manual,false);
    await page.getByRole('combobox',{name:'Headphone correction',exact:true}).click();
    await page.getByRole('option',{name:'Apple EarPods',exact:true}).click();
    assert.equal((await mode(page)).manual,false);
    await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
    await page.getByRole('button',{name:'Track Options',exact:true}).click();
    await page.getByRole('group',{name:'Speaker Boost',exact:true}).getByRole('button',{name:'Low',exact:true}).click();
    assert.equal((await mode(page)).manual,false);
    await page.getByRole('button',{name:'Bypass All',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='raw');
    await page.getByRole('button',{name:'Bypass All',exact:true}).click();await matches(page,'CHILL',true);
    assert.equal((await status(page)).settings[18],.3);
    await closeMenu(page);
    await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
    const voice=page.getByRole('slider',{name:'Vocal Frontness',exact:true});await voice.focus();await page.keyboard.press('Home');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dmex_sound_selection_v1')).manual);
    await page.waitForTimeout(1100);assert.equal((await status(page)).settings[12],0,'Late analysis never overwrites a manual edit');
    await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
    await badge.click();await matches(page,'CHILL',true);
    await page.locator('.mep-topbar [aria-label=Close]').click();
    // Late results from the previous source must not affect the current source.
    await page.evaluate(s=>{window.libraryTest.signatureDelay=1800;window.libraryTest.signatureResult=s;},signature);
    await page.getByRole('button',{name:'Play Paper Lanterns 2',exact:true}).click();
    await page.waitForTimeout(900);
    await page.evaluate(()=>{window.libraryTest.signatureDelay=0;window.libraryTest.signatureResult={...window.libraryTest.signatureResult,highRatio:.37,sideRatio:.5,correlation:.1,bassRatio:.32,lowMidRatio:0,presenceRatio:.31};});
    await page.getByRole('button',{name:'Play Open Water 3',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
    await matches(page,'CHILL',true);await page.waitForTimeout(1800);await matches(page,'CHILL',true);
    assert.equal((await status(page)).settings[8],.37);
    assert.ok((await page.evaluate(()=>window.libraryTest.calls)).some(call=>call.command==='cancel_track_signature'));
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await page.locator('.mep-root').waitFor({state:'visible'});await page.waitForTimeout(800);
    await page.screenshot({path:`tests/artifacts/enhanced-engine-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: adapted references, independent controls/assets, bypass recovery, manual authority, stale-source isolation, volume preservation`);
    await context.close();
  }
}finally{await browser.close();}
