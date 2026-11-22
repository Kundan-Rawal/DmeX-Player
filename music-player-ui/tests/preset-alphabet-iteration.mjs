import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'});
    await context.addInitScript(()=>localStorage.setItem('dmex_mobile_sort','title'));
    const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:1420/tests/mobile-redesign.html?mobile&iteration&alphabet',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Play Alpha',exact:true}).waitFor();
    const result=await page.evaluate(()=>{
      const t=window.libraryTest;
      const names=['zebra','नमस्ते','Alpha','한글','42 song','! Intro','Écho','Ａlpha',' bravo','ı song','ſ song'];
      const tracks=names.map((name,i)=>({...t.tracks[i],name}));
      return {labels:t.CATEGORY_LABELS, classic:[1969,1979,1980,1995,2003,2004].map(year=>t.classifyAudio(.9,18,0,.1,{year:String(year),genre:'Pop'}).label),
        fallback:t.classifyAudio(.9,18,0,.1,{}).label,
        sections:names.map(t.alphabetSection),ascending:t.sortTracks(tracks,'title').map(x=>x.name),descending:t.sortTracks(tracks,'title',true).map(x=>x.name),
        neutral:t.soundPreset(null,'ORIGINAL'),recipes:[null,...Object.keys(t.CATEGORY_LABELS),'DYNAMIC','METAL','RNB','FOLK'].flatMap(category=>['ORIGINAL','QUALITY','IMMERSIVE','CHILL'].filter(taste=>category||taste!=='ORIGINAL').map(taste=>({category,taste,settings:t.soundPreset(category,taste)})))};
    });
    assert.ok(Object.keys(result.labels).length<=11);
    assert.ok(!Object.values(result.labels).some(label=>/unclassified|dynamic recording|1880|2003/i.test(label)));
    assert.deepEqual(result.classic,['Pop / Standard','Pop / Standard',"90's Classic","90's Classic","90's Classic",'Pop / Standard']);
    assert.equal(result.fallback,'Other / Untagged');
    assert.deepEqual(result.sections,['Z','#','A','#','#','#','#','#','B','#','#']);
    assert.deepEqual(result.ascending.slice(0,3),['Alpha',' bravo','zebra']);
    assert.deepEqual(result.descending.slice(0,3),['zebra',' bravo','Alpha']);
    for(const {category,taste,settings:s} of result.recipes) {
      if(taste==='ORIGINAL'){assert.deepEqual(s,result.neutral);continue;}
      assert.ok(s.bass>0&&s.bass<=1.1&&s.exciter>0&&s.air>0&&s.width>=1.1,`${category}/${taste} user reference recipe`);
      if(taste==='QUALITY') assert.equal(s.reverb,0);
      if(taste==='IMMERSIVE'||taste==='CHILL') assert.ok(s.reverb>0&&s.reverb<=.8);
      assert.ok(!('volume'in s)&&!('device'in s));
    }
    assert.equal(result.neutral.width,1);for(const k of ['bass','treble','exciter','air','vocal','bassField','spatial','reverb']) assert.equal(result.neutral[k],0,'No preset floor leaks into normal/manual audio');
    const rail=page.locator('.dmex-mobile-route-page[data-current=true]').getByRole('slider',{name:'Alphabet index',exact:true});
    await rail.waitFor();
    assert.deepEqual(await rail.locator('span').allTextContents(),'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split(''));
    const geometry=await rail.locator('span').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.ok(geometry.every(r=>r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+.1&&r.y+r.height<=viewport.height+.1));
    for(let i=1;i<geometry.length;i++) if(Math.abs(geometry[i].x-geometry[i-1].x)<1) assert.ok(geometry[i].y>=geometry[i-1].y+geometry[i-1].height-.1,'Alphabet labels never overlap');
    await rail.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>document.querySelector('.dmex-mobile-route-page[data-current=true] .dmex-mobile-track-index')?.getAttribute('aria-valuetext')==='#');
    await page.screenshot({path:`tests/artifacts/preset-alphabet-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${viewport.width}x${viewport.height}: category-independent tonal preservation, 1980-2003/fallback labels, neutral isolation, ASCII-first sort, full A-Z/# rail and keyboard jump`);
    await context.close();
  }
} finally {await browser.close();}
