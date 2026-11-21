import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:1420/tests/mobile-redesign.html?mobile&iteration',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    const bar=page.locator('.mep-seek-bar');await bar.waitFor();
    const rect=await bar.boundingBox(),cdp=await context.newCDPSession(page);
    const seekCount=()=>page.evaluate(()=>window.libraryTest.calls.filter(c=>c.command==='audio_command'&&c.payload.cmd.startsWith('SEEK ')).length);
    const before=await seekCount();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width*.2,y:rect.y+rect.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width*.7,y:rect.y+rect.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(before=>window.libraryTest.calls.filter(c=>c.command==='audio_command'&&c.payload.cmd.startsWith('SEEK ')).length>before,before);
    assert.equal(await seekCount(),before+1,'One touch gesture commits exactly one seek');
    const doubled=await page.evaluate(async()=>{
      const count=()=>window.libraryTest.calls.filter(c=>c.command==='audio_command'&&c.payload.cmd==='SEEK 77').length;
      const before=count();await Promise.all([window.seekTestSend('SEEK 77'),window.seekTestSend('SEEK 77')]);
      return count()-before;
    });
    assert.equal(doubled,1,'Identical in-flight seek commands share a single operation');
    const repeated=await page.evaluate(async()=>{
      const before=window.libraryTest.calls.length;
      await window.seekTestSend('SEEK 77');await window.seekTestSend('SEEK 77');
      return window.libraryTest.calls.slice(before).filter(c=>c.command==='audio_command'&&c.payload.cmd==='SEEK 77').length;
    });
    assert.equal(repeated,2,'A later intentional seek to the same position must not be swallowed');
    const acrossLoad=await page.evaluate(async()=>{
      const before=window.libraryTest.calls.length;
      await Promise.all([window.seekTestSend('SEEK 12'),window.seekTestSend('LOAD /Music/test.flac'),window.seekTestSend('SEEK 12')]);
      return window.libraryTest.calls.slice(before).filter(c=>c.command==='audio_command').map(c=>c.payload.cmd);
    });
    assert.deepEqual(acrossLoad,['SEEK 12','LOAD /Music/test.flac','SEEK 12'],'A new source invalidates seek deduplication');
    const gains=await page.evaluate(()=>({voice:window.libraryTest.vocalPresenceDb(.5),maxVoice:window.libraryTest.vocalPresenceDb(1)}));
    assert.deepEqual(gains,{voice:3,maxVoice:6});
    await page.screenshot({path:`tests/artifacts/seek-naturalism-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: one touch seek, in-flight deduplication, source-change ordering and gentle gain calibration`);
    await context.close();
  }
} finally {await browser.close();}
