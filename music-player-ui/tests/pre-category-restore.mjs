import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';
import {build} from 'esbuild';
const root=resolve('..'), revision='842a9f2';
const historic=path=>execFileSync('git',['-c','core.fsmonitor=false','show',`${revision}:${path}`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const normalize=text=>text.replaceAll('\r\n','\n').trimEnd();
for(const path of ['audio-engine-cpp/DSP_Nodes.cpp','audio-engine-cpp/DSP_Nodes.h','audio-engine-cpp/NineSpeakerUpmixer.h','audio-engine-cpp/SmoothedParam.h']) {
  assert.equal(normalize(readFileSync(resolve(root,path),'utf8')),normalize(historic(path)),`${path} must match the recorded pre-category sound engine`);
}
const app=ts.createSourceFile('App.tsx',historic('music-player-ui/src/App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let body;
function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(app)==='applySmartSettings')body=node.initializer.body;else ts.forEachChild(node,find);}
find(app);assert.ok(body);
const declarations=[];
function collect(node){if(ts.isVariableDeclaration(node)&&['neutral','selected'].includes(node.name.getText(app)))declarations.push('const '+node.getText(app)+';');else ts.forEachChild(node,collect);}
collect(body);assert.equal(declarations.length,2);
const reference=ts.transpileModule(`export function recorded(taste){${declarations.join('\n')}return selected;}`,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {recorded}=await import('data:text/javascript;base64,'+Buffer.from(reference).toString('base64'));
const compiled=(await build({entryPoints:['src/config/soundPresets.ts'],bundle:true,write:false,platform:'node',format:'esm'})).outputFiles[0].text;
const {soundPreset}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
for(const category of [null,'POP','VOCAL','BOLLYWOOD','NATURAL'])for(const taste of ['ORIGINAL','QUALITY','IMMERSIVE','CHILL'])assert.deepEqual(soundPreset(category,taste),recorded(taste));
const controller=readFileSync('src/components/player/useSoundSelection.ts','utf8');
assert.ok(!/ADAPTIVE_EQ|analyze_track_audio|adaptiveCommand|TrackAnalysis/.test(controller));
const transport=readFileSync('../audio-engine-cpp/EngineCore.cpp','utf8');
assert.ok(transport.includes('transportFade.process')&&transport.includes('processingCacheFramesRemaining=0')&&transport.includes('activeCallbacks'));
console.log('PASS exact historical DSP source parity, recorded runtime pill recipes, no adaptive retuning, retained transport de-clicking');
