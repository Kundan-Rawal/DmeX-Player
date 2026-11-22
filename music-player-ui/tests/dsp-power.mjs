import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const viewport of [{width:320,height:640},{width:360,height:800},{width:800,height:360}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto((process.env.PLAYER_TEST_URL||'http://127.0.0.1:1420')+'/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    const semantics=await page.evaluate(()=>{
      const t=window.libraryTest;return {voice:t.vocalPresenceDb(.5),quality:t.soundPreset(null,'QUALITY'),immersive:t.soundPreset(null,'IMMERSIVE'),chill:t.soundPreset(null,'CHILL')};
    });
    assert.equal(semantics.voice,3);
    assert.ok(Math.abs(semantics.quality.bass-.945)<1e-9);assert.equal(semantics.quality.vocal,.8);
    assert.equal(semantics.immersive.separation,.9);assert.equal(semantics.immersive.depth,.8);assert.equal(semantics.immersive.reverb,.25);
    assert.equal(semantics.chill.treble,5.5);assert.equal(semantics.chill.reverb,.7);
    for(const recipe of [semantics.quality,semantics.immersive,semantics.chill])assert.ok(!('volume' in recipe));
    await page.getByRole('button',{name:'DSP Controls',exact:true}).click();
    const field=page.getByRole('slider',{name:'Bass Field',exact:true});
    await field.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>{const call=window.libraryTest.calls.filter(c=>c.command==='audio_apply_settings').at(-1);return call?.payload.values[10]===1&&call.payload.values[11]===1;});
    await page.getByRole('switch',{name:'3D Room Bass',exact:true}).click();
    await page.waitForFunction(()=>{const call=window.libraryTest.calls.filter(c=>c.command==='audio_apply_settings').at(-1);return call?.payload.values[10]===0&&call.payload.values[11]===0;});
    const depth=page.getByRole('slider',{name:'3D Depth',exact:true});
    await depth.focus();await page.keyboard.press('End');
    await page.getByRole('switch',{name:'9D Cinema Stage',exact:true}).click();
    await page.waitForFunction(()=>{const v=window.libraryTest.calls.filter(c=>c.command==='audio_apply_settings').at(-1)?.payload.values;return v?.[17]===0&&v[4]===0&&v[5]===0;});
    const air=page.getByRole('slider',{name:'Harmonic Air',exact:true});await air.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    assert.match(await air.locator('..').locator('output').innerText(),/%/);
    const voice=page.getByRole('slider',{name:'Vocal Frontness',exact:true});await voice.focus();await page.keyboard.press('End');
    assert.match(await voice.locator('..').locator('output').innerText(),/6\.0 dB/);
    assert.ok(await page.locator('.mep-dsp-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.screenshot({path:`tests/artifacts/dsp-power-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: user-reference pills, original linear gain scale, room/stage gating and bounded DSP layout`);
    await context.close();
  }
} finally {await browser.close();}
