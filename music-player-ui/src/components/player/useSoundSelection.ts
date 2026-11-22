import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Taste } from '../../types';
import { soundPreset } from '../../config/soundPresets';
import { enhancedPreset, suggestedSpeakerBoost, validSignature, type RecordingSignature } from '../../config/enhancement';
import { DEFAULT_SOUND_SELECTION, parseSoundSelection, processingStatus, quickTaste, selectTaste, SOUND_SELECTION_KEY, SoundSelection, toggleCategory } from '../../config/soundSelection';
import { useAudioSettings } from './AudioSettingsContext';

export function useSoundSelection(ready:boolean) {
  const audio=useAudioSettings(), current=useRef(audio); current.current=audio;
  const [selection,setSelection]=useState(()=>parseSoundSelection(localStorage.getItem(SOUND_SELECTION_KEY))||{...DEFAULT_SOUND_SELECTION});
  const selectionRef=useRef(selection);
  const [pending,setPending]=useState(false),generation=useRef(0),requested=useRef<string|null>(null);
  const sourceEpoch=useRef(0), [source,setSource]=useState<{epoch:number;path:string}|null>(null);
  const signature=useRef<RecordingSignature|null>(null), [analysisRevision,setAnalysisRevision]=useState(0);
  const boostRequested=useRef<string|null>(null);
  const [analysisState,setAnalysisState]=useState<'reference'|'analysing'|'adapted'>('reference');
  const commit=useCallback((value:SoundSelection)=>{selectionRef.current=value;setSelection(value);},[]);
  const markManual=useCallback(()=>{++generation.current;requested.current=null;setPending(false);commit({...selectionRef.current,manual:true});},[commit]);
  const keyFor=useCallback((value:SoundSelection)=>`${sourceEpoch.current}:${value.categoryEnabled}:${value.taste}:${analysisRevision}:${current.current.speakerBoostAuto}`, [analysisRevision]);
  const apply=useCallback(async(value:SoundSelection)=>{
    const audio=current.current;
    if(audio.status?.bypassAll||(!audio.status&&localStorage.getItem('dmex_bypass_all')==='true'))return;
    const id=++generation.current; requested.current=keyFor(value);commit(value);setPending(true);
    try {
      const active=value.categoryEnabled||value.taste!=='ORIGINAL';
      const changes=active?enhancedPreset(value.taste,signature.current):soundPreset(null,'ORIGINAL');
      if(audio.speakerBoostAuto) changes.boost=active?suggestedSpeakerBoost(signature.current):0;
      await audio.update(changes);
    } catch(error) {if(id===generation.current)commit({...value,manual:true});throw error;}
    finally {if(id===generation.current)setPending(false);}
  },[commit,keyFor]);
  const toggle=useCallback(()=>apply(toggleCategory(selectionRef.current)),[apply]);
  const chooseTaste=useCallback((taste:Taste)=>apply(selectTaste(selectionRef.current,taste)),[apply]);
  const setManualOverride=useCallback((manual:boolean)=>{if(manual)markManual();else void apply({...selectionRef.current,categoryEnabled:true,manual:false}).catch(()=>{});},[apply,markManual]);
  const hydrateLegacy=useCallback((settings:{smartTaste?:unknown;isManualOverride?:boolean}|null)=>{
    if(localStorage.getItem(SOUND_SELECTION_KEY)||generation.current)return;
    commit({...DEFAULT_SOUND_SELECTION,taste:quickTaste(settings?.smartTaste),manual:settings?.isManualOverride===true});
  },[commit]);
  const beginSource=useCallback(()=>{
    ++sourceEpoch.current; ++generation.current; requested.current=null; signature.current=null;
    boostRequested.current=null;
    setSource(null);setAnalysisState('reference');setPending(false);
    void invoke('cancel_track_signature').catch(()=>{});
  },[]);
  const loadSource=useCallback(async(path:string)=>{
    signature.current=null;
    setSource({epoch:sourceEpoch.current,path});setAnalysisState('reference');
    // A DSP-setting failure remains visible, but must not turn a valid LOAD into
    // a missing/unplayable-track failure or prevent transport from starting.
    if(!selectionRef.current.manual)await apply(selectionRef.current).catch(()=>{});
    else if(current.current.speakerBoostAuto&&!current.current.status?.bypassAll&&localStorage.getItem('dmex_bypass_all')!=='true')
      await current.current.update({boost:0},{preserveError:true}).catch(()=>{});
  },[apply]);
  useEffect(()=>{if(ready)localStorage.setItem(SOUND_SELECTION_KEY,JSON.stringify(selection));},[ready,selection]);
  useEffect(()=>{
    const needsAnalysis=selection.manual?audio.speakerBoostAuto:selection.categoryEnabled||selection.taste!=='ORIGINAL';
    if(!source||!ready||audio.status?.bypassAll||!needsAnalysis)return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      setAnalysisState('analysing');
      void invoke<RecordingSignature>('analyze_track_signature',{path:source.path}).then(result=>{
        if(cancelled||source.epoch!==sourceEpoch.current)return;
        if(!validSignature(result)){setAnalysisState('reference');return;}
        signature.current=result;
        setAnalysisState(result.confidence>=.35?'adapted':'reference');
        setAnalysisRevision(revision=>revision+1);
      }).catch(()=>{if(!cancelled)setAnalysisState('reference');});
    },750);
    return()=>{cancelled=true;clearTimeout(timer);void invoke('cancel_track_signature').catch(()=>{});};
  },[source,ready,selection.manual,selection.categoryEnabled,selection.taste,audio.status?.bypassAll,audio.speakerBoostAuto]);
  useEffect(()=>{
    if(!audio.speakerBoostAuto){boostRequested.current=null;return;}
    if(!source||!ready||audio.busy||!audio.status?.ready||audio.status.bypassAll||!selection.manual)return;
    const key=`${source.epoch}:${analysisRevision}`;
    if(boostRequested.current===key)return;
    boostRequested.current=key;
    void current.current.update({boost:suggestedSpeakerBoost(signature.current)},{preserveError:true}).catch(()=>{});
  },[source,ready,audio.busy,audio.status?.ready,audio.status?.bypassAll,audio.speakerBoostAuto,selection.manual,analysisRevision]);
  useEffect(()=>{
    if(audio.status?.bypassAll){requested.current=null;return;}
    if(!ready||audio.busy||!audio.status?.ready||selectionRef.current.manual)return;
    const value=selectionRef.current;
    if(requested.current!==keyFor(value))void apply(value).catch(()=>{});
  },[ready,audio.busy,audio.status?.ready,audio.status?.bypassAll,audio.speakerBoostAuto,analysisRevision,apply,keyFor]);
  const status=processingStatus(selection,null,!!audio.status?.bypassAll,pending||!ready||!audio.status?.ready);
  const detail=status.kind==='raw'?'DSP bypassed':status.kind==='manual'?'Manual tone and spatial settings':status.kind==='normal'?'Enhancement disabled':
    analysisState==='adapted'?'Recording-adapted settings':analysisState==='analysing'?'Analysing recording; reference settings active':'Reference settings';
  return {selection,pending,markManual,setManualOverride,hydrateLegacy,toggle,chooseTaste,beginSource,loadSource,
    status:{...status,detail}, disabled:audio.busy||!ready||!audio.status?.ready||!!audio.status?.bypassAll};
}
