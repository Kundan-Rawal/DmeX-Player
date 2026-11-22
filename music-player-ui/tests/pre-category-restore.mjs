import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve('..'), revision='842a9f2';
const historic=path=>execFileSync('git',['-c','core.fsmonitor=false','show',`${revision}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const normalize=text=>text.replaceAll('\r\n','\n').trimEnd();
for(const path of ['audio-engine-cpp/DSP_Nodes.cpp','audio-engine-cpp/DSP_Nodes.h','audio-engine-cpp/NineSpeakerUpmixer.h','audio-engine-cpp/SmoothedParam.h']) {
  assert.equal(normalize(readFileSync(resolve(root,path),'utf8')),normalize(historic(path)),`${path} must match the recorded pre-category sound engine`);
}
const controller=readFileSync('src/components/player/useSoundSelection.ts','utf8');
assert.ok(!/ADAPTIVE_EQ|analyze_track_audio|adaptiveCommand|TrackAnalysis/.test(controller));
const transport=readFileSync('../audio-engine-cpp/EngineCore.cpp','utf8');
assert.ok(transport.includes('transportFade.process')&&transport.includes('processingCacheFramesRemaining=0')&&transport.includes('activeCallbacks'));
console.log('PASS exact historical DSP source parity and retained transport de-clicking; recording-adaptive preset policy is tested separately');
