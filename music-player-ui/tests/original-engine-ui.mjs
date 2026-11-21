import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile'});
    const saved=[.4,2,.3,1.4,.6,.4,.1,0,.37,60,.2,1,.7,1,.72,.6,.25,1,.3,0];
    await context.addInitScript(saved=>{localStorage.setItem('dmex_audio_v2',JSON.stringify(saved));localStorage.setItem('dmex_sound_selection_v1',JSON.stringify({categoryEnabled:true,manual:false,taste:'ORIGINAL'}));},saved);
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:1420/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
    let actual=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));
    assert.deepEqual(actual.settings,saved,'Opening/loading does not replace configured controls with a new automatic recipe');
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    const badge=page.locator('.mep-topbar-center .processing-status-badge');
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.textContent==='DmeX Original');
    for(const taste of ['QUALITY','IMMERSIVE','CHILL']) {
      const label={QUALITY:'HD Clear',IMMERSIVE:'Immersive',CHILL:'Chill'}[taste];
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(async taste=>{const t=window.libraryTest,s=await window.__TAURI_INTERNALS__.invoke('audio_status');return Object.entries(t.soundPreset(null,taste)).every(([key,value])=>Math.abs(s.settings[t.PARAM[key]]-value)<.00001);},taste);
      actual=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));assert.equal(actual.settings[8],saved[8]);
    }
    await page.getByRole('button',{name:'Track Options',exact:true}).click();
    const bass=page.getByRole('slider',{name:'Subwoofer Bass',exact:true});await bass.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>document.querySelector('.mep-topbar-center .processing-status-badge')?.dataset.processingKind==='manual');
    await page.locator('.mep-topbar > div[style*="position: fixed"]').click({position:{x:2,y:2}});
    await page.locator('.mep-topbar [aria-label=Close]').click();
    await page.getByRole('button',{name:'Play Paper Lanterns 2',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
    actual=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('audio_status'));assert.equal(actual.settings[0],2.1);
    const calls=await page.evaluate(()=>window.libraryTest.calls);
    assert.ok(!calls.some(c=>c.command==='analyze_track_audio'||c.command==='audio_command'&&c.payload.cmd.startsWith('ADAPTIVE_EQ ')));
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: configured control preservation, exact legacy pills, manual authority and no per-song adaptive retuning`);
    await context.close();
  }
}finally{await browser.close();}
