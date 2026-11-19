import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || 'C:/Users/LEGION/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:1420';
const active = '.dmex-mobile-route-page[data-current=true]';
async function open(viewport = { width: 360, height: 800 }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/tests/mobile-redesign.html?mobile&iteration', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Play Night Drive 1', exact: true }).waitFor();
  return { page, context, errors };
}
try {
  {
    const { page, context } = await open();
    const result = await page.evaluate(() => {
      const t = window.libraryTest;
      const years = ['1880','2003','2004','1879','','2001-07-15','not a year','0','9999','20010'];
      const q = t.createQueue([t.tracks[0], t.tracks[0], t.tracks[1]], t.tracks[0], 'test'); q.repeat = 'ONE'; q.position = 42; q.history = [...q.originalOrder];
      const clean = t.discardMissingTrack(q, t.tracks[0].path);
      return { years: years.map(year => t.releaseYear({year})), classics: years.map(year => t.isClassicYear({year})),
        ascending: t.sortTracks(years.slice(0,6).map((year,i)=>({...t.tracks[i],year})), 'year').map(track=>track.year),
        descending: t.sortTracks(years.slice(0,6).map((year,i)=>({...t.tracks[i],year})), 'year', true).map(track=>track.year),
        queue: { count: clean.entries.length, current: clean.entries.find(entry=>entry.id===clean.currentId)?.track.path, position: clean.position, history: clean.history.length, original: clean.originalOrder.length },
        category: ['Metal','Jazz','Bollywood','Podcast','unknown'].map(genre=>t.metadataCategory({genre})),
        signal: [t.signalCategory(.95,11,0,.1),t.signalCategory(.3,18,.1,.05),t.signalCategory(NaN,1,1,1),t.signalCategory(0,0,0,0)],
        recipes: Object.fromEntries(Object.keys(t.CATEGORY_LABELS).map(id=>[id,['QUALITY','IMMERSIVE','CHILL','ORIGINAL'].map(taste=>t.soundPreset(id,taste))])),
        probes: t.calls.filter(call=>call.command==='remove_missing_track').length };
    });
    assert.deepEqual(result.years, [1880,2003,2004,1879,null,2001,null,null,null,null]);
    assert.deepEqual(result.classics, [true,true,false,false,false,true,false,false,false,false]);
    assert.deepEqual(result.ascending, ['1879','1880','2001-07-15','2003','2004','']);
    assert.deepEqual(result.descending, ['2004','2003','2001-07-15','1880','1879','']);
    assert.deepEqual(result.category, ['METAL','JAZZ','SOUNDTRACK','SPOKEN',null]);
    assert.deepEqual(result.signal, ['CENTERED','DYNAMIC','BALANCED','BALANCED']);
    assert.equal(result.queue.count,1); assert.equal(result.queue.current,'/Music/Album 1/track-1.flac');
    assert.equal(result.queue.position,0); assert.equal(result.queue.history,1); assert.equal(result.queue.original,1);
    assert.equal(result.probes,0,'No startup filesystem audit');
    for(const recipes of Object.values(result.recipes)) for(const recipe of recipes) {
      assert.ok(Object.values(recipe).every(Number.isFinite));
      assert.equal(recipe.boost,0); assert.equal(recipe.compressor,0); assert.equal(recipe.loudness,0);
      assert.ok(!('volume' in recipe) && !('device' in recipe), 'Presets preserve user volume/output device');
      assert.ok(recipe.width>=1 && recipe.width<=1.1 && recipe.reverb<=.16 && recipe.air<=.1 && recipe.treble<=1.4);
    }
    assert.notDeepEqual(result.recipes.CLASSICAL[1],result.recipes.METAL[1],'Category changes actual DSP');
    await context.close();
  }
  {
    const {page,context}=await open();
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    await page.getByRole('button',{name:'Open expanded player',exact:true}).click();
    await page.locator('.mep-topbar-center').filter({hasText:'Jazz / Blues'}).waitFor();
    await page.locator('.mep-topbar-center').click();
    for(const [label,taste] of [['HD Clear','QUALITY'],['Immersive','IMMERSIVE'],['Chill','CHILL']]) {
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(taste=>{
        const t=window.libraryTest, expected=t.soundPreset('JAZZ',taste);
        const values=t.calls.filter(call=>call.command==='audio_apply_settings').at(-1)?.payload.values;
        return values && Math.abs(values[0]-expected.bass)<.00001 && Math.abs(values[1]-expected.treble)<.00001 && Math.abs(values[6]-expected.reverb)<.00001 && Math.abs(values[17]-expected.spatial)<.00001;
      },taste);
    }
    await context.close();
  }
  for(const viewport of [{width:360,height:800},{width:320,height:640},{width:800,height:360}]) {
    const { page, context, errors } = await open(viewport);
    await page.getByRole('button',{name:'Sort tracks',exact:true}).click();
    await page.getByRole('button',{name:'Release year, oldest first',exact:true}).click();
    const slider = page.locator(active).getByRole('slider',{name:'Release year index'});
    await slider.waitFor();
    assert.ok(await page.locator(active+' .dmex-mobile-track-section').first().textContent()==='1879');
    await slider.focus(); await page.keyboard.press('ArrowDown');
    await page.waitForFunction(()=>document.querySelector('.dmex-mobile-track-index')?.getAttribute('aria-valuetext')==='1880');
    const rect = await slider.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+5}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height*.55}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok((await page.locator(active+' .dmex-mobile-track-scroll').evaluate(el=>el.scrollTop))>0);
    assert.equal(await page.locator('.dmex-mobile-tabs [aria-current]').getAttribute('data-tab'),'tracks','Index does not swipe tabs');
    await page.getByRole('button',{name:'Filter tracks',exact:true}).click();
    await page.getByRole('button',{name:'90s Bollywood Classics (1880-2003)',exact:true}).click();
    assert.match(await page.locator(active+' .dmex-mobile-list-toolbar').innerText(),/50 tracks/);
    await page.getByRole('button',{name:'Sort tracks',exact:true}).click();
    await page.getByRole('switch',{name:'Reverse sort order'}).click();
    await page.getByRole('button',{name:'Close menu',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.dmex-mobile-track-section')?.textContent==='2003');
    assert.ok(await page.locator('.dmex-mobile-shell').evaluate(el=>el.scrollWidth<=el.clientWidth));
    const trackBounds = await page.locator(active+' .dmex-mobile-track').first().boundingBox();
    assert.ok(trackBounds.width<=viewport.width);
    await page.screenshot({path:`tests/artifacts/library-years-${viewport.width}.png`});
    assert.deepEqual(errors,[]);
    await context.close();
  }
  for(const status of ['missing','permission','available','unavailable']) {
    const {page,context,errors} = await open();
    await page.evaluate(status=>{window.libraryTest.failures[window.libraryTest.tracks[0].path]=status;},status);
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    if(status==='missing') {
      await page.waitForFunction(()=>document.querySelector('.dmex-mobile-mini-info strong')?.textContent==='Paper Lanterns 2');
      assert.equal(await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).count(),0);
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')||'null')?.entries.length===79);
    } else {
      await page.locator('.dmex-mobile-error').waitFor();
      assert.equal(await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).count(),1);
    }
    const probes=await page.evaluate(()=>window.libraryTest.calls.filter(call=>call.command==='remove_missing_track'));
    assert.equal(probes.length,1); assert.deepEqual(errors,[]);
    await context.close();
  }
  {
    const {page,context}=await open();
    await page.getByRole('button',{name:'Search library',exact:true}).click();
    await page.getByRole('textbox',{name:'Search library',exact:true}).fill('Night Drive 1');
    await page.evaluate(()=>{for(const track of window.libraryTest.tracks.filter(t=>t.name.includes('Night Drive 1'))) window.libraryTest.failures[track.path]='missing';});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.waitForFunction(()=>{const q=JSON.parse(localStorage.getItem('dmex_mobile_queue_v1')||'null');return q?.origin==='Tracks'&&q.entries.length>50;});
    assert.ok(await page.evaluate(()=>window.libraryTest.calls.some(call=>call.command==='audio_command'&&call.payload.cmd==='PLAY')));
    await context.close();
  }
  {
    const {page,context}=await open();
    await page.evaluate(()=>{window.libraryTest.failures[window.libraryTest.tracks[0].path]='missing';window.libraryTest.probeDelay=800;});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.waitForFunction(()=>window.libraryTest.calls.some(call=>call.command==='remove_missing_track'));
    await page.getByRole('button',{name:'Play Paper Lanterns 2',exact:true}).click();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.dmex-mobile-mini-info strong').innerText(),'Paper Lanterns 2','Stale missing-source recovery cannot replace a newer selection');
    await context.close();
  }
  {
    const {page,context}=await open();
    await page.evaluate(()=>{for(const track of window.libraryTest.tracks)window.libraryTest.failures[track.path]='missing';});
    await page.getByRole('button',{name:'Play Night Drive 1',exact:true}).click();
    await page.locator('.dmex-mobile-error').filter({hasText:'Too many unavailable tracks'}).waitFor();
    assert.equal(await page.evaluate(()=>window.libraryTest.calls.filter(call=>call.command==='remove_missing_track').length),64,'Failure recovery is bounded');
    await context.close();
  }
  console.log('PASS: release-year metadata/boundaries/sort/index, real category recipes, lazy source removal, safe failures and Tracks fallback');
} finally { await browser.close(); }
