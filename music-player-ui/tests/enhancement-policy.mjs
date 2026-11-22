import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=(await build({entryPoints:['src/config/enhancement.ts'],bundle:true,write:false,platform:'node',format:'esm'})).outputFiles[0].text;
const {referencePreset,enhancedPreset,validSignature,PRESET_PARAMETERS,isPresetParameter,suggestedSpeakerBoost}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const signature={version:1,confidence:1,sampledSeconds:12,activeSeconds:12,rmsDbfs:-17,peakDbfs:-2,crestDb:15,correlation:.5,sideRatio:.25,bassRatio:.2,lowMidRatio:.25,presenceRatio:.25,highRatio:.1,highFlatness:.2};
assert.equal(referencePreset('IMMERSIVE').bass,.63,'Displayed bass 30% maps to 0.63 internally');
assert.ok(Math.abs(referencePreset('QUALITY').bass-.945)<1e-12);
assert.equal(referencePreset('CHILL').bass,1.05);
assert.deepEqual(referencePreset('ORIGINAL'),referencePreset('IMMERSIVE'),'Enhanced default follows the immersive reference');
for(const taste of ['ORIGINAL','QUALITY','IMMERSIVE','CHILL']) {
  const reference=referencePreset(taste);
  for(const unavailable of [null,{}, {...signature,confidence:.1}, {...signature,sideRatio:NaN}])assert.deepEqual(enhancedPreset(taste,unavailable),reference);
  assert.deepEqual(Object.keys(reference).sort(),[...PRESET_PARAMETERS].sort());
  const darkNarrow=enhancedPreset(taste,{...signature,sideRatio:.01,correlation:.98,highRatio:.02,bassRatio:.03,presenceRatio:.1,lowMidRatio:.45});
  const brightWide=enhancedPreset(taste,{...signature,sideRatio:.5,correlation:-.2,highRatio:.37,bassRatio:.32,presenceRatio:.31,lowMidRatio:0});
  for(const key of ['exciter','air','vocal','width','bass','treble','reverb'])assert.notEqual(darkNarrow[key],brightWide[key],`${taste}: ${key} adapts, not just user-mentioned ranges`);
  if(taste==='QUALITY') {assert.equal(darkNarrow.spatial,0);assert.equal(darkNarrow.roomBass,0);assert.equal(darkNarrow.bassField,0);assert.ok(darkNarrow.reverb<=.1);}
  else for(const key of ['separation','depth','bassField'])assert.notEqual(darkNarrow[key],brightWide[key]);
  for(let i=0;i<1000;i++) {
    const f={...signature,confidence:Math.random(),correlation:Math.random()*2-1,sideRatio:Math.random(),bassRatio:Math.random(),lowMidRatio:Math.random(),presenceRatio:Math.random(),highRatio:Math.random()};
    const total=f.bassRatio+f.lowMidRatio+f.presenceRatio+f.highRatio+Math.random();
    for(const key of ['bassRatio','lowMidRatio','presenceRatio','highRatio'])f[key]/=total;
    assert.ok(validSignature(f));
    const settings=enhancedPreset(taste,f);
    assert.ok(Object.values(settings).every(Number.isFinite));
    for(const key of ['exciter','air','vocal','separation','depth','bassField','reverb'])assert.ok(settings[key]>=0&&settings[key]<=1);
    assert.ok(settings.width>=1&&settings.width<=2.5&&settings.bass>=0&&settings.bass<=2.1);
    assert.ok(settings.treble>=-12&&settings.treble<=12);
    assert.ok([52,60,70].includes(settings.subBassHz));
    for(const independent of ['compressor','loudness','roomSize','damping','boost','device','volume'])assert.ok(!(independent in settings));
  }
}
for(const key of ['compressor','loudness','roomSize','damping','boost','device','volume'])assert.equal(isPresetParameter(key),false);
for(const key of PRESET_PARAMETERS)assert.equal(isPresetParameter(key),true);
assert.equal(suggestedSpeakerBoost(signature),0);
assert.equal(suggestedSpeakerBoost({...signature,rmsDbfs:-29,peakDbfs:-14,crestDb:15}),.3);
assert.equal(suggestedSpeakerBoost({...signature,rmsDbfs:-29,peakDbfs:-1,crestDb:28}),0,'Quiet RMS with high peaks cannot request boost');
assert.equal(suggestedSpeakerBoost({...signature,rmsDbfs:-29,peakDbfs:-14,activeSeconds:2}),0);
console.log('PASS reference percentage mapping, all continuous preset controls adapt, signature validation, independent settings ownership and bounded None/Low boost; 4000 generated feature cases');
