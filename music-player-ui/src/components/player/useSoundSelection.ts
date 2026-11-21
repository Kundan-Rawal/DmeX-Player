import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Taste } from '../../types';
import { soundPreset } from '../../config/soundPresets';
import { adaptiveCommand, AdaptiveSource, TrackAnalysis, validAnalysis } from '../../config/adaptiveAudio';
import { DEFAULT_SOUND_SELECTION, parseSoundSelection, processingStatus, quickTaste, selectTaste, SOUND_SELECTION_KEY, SoundSelection, toggleCategory } from '../../config/soundSelection';
import { useAudioSettings } from './AudioSettingsContext';

export function useSoundSelection(_profileId: string | null, ready: boolean) {
  const audio=useAudioSettings();
  const [selection,setSelection]=useState(()=>parseSoundSelection(localStorage.getItem(SOUND_SELECTION_KEY))||{...DEFAULT_SOUND_SELECTION});
  const selectionRef=useRef(selection), [pending,setPending]=useState(false);
  const [source,setSource]=useState<AdaptiveSource|null>(null), sourceRef=useRef<AdaptiveSource|null>(null);
  const analysisRef=useRef<TrackAnalysis|null>(null), [analysis,setAnalysis]=useState<TrackAnalysis|null>(null);
  const generation=useRef(0), requested=useRef<string|null>(null);
  const current=useRef(audio); current.current=audio;
  const commit=useCallback((value:SoundSelection)=>{selectionRef.current=value;setSelection(value);},[]);
  const keyFor=(value:SoundSelection)=>`${sourceRef.current?.generation??0}:${value.categoryEnabled}:${value.taste}:${analysisRef.current?.eqDb.join(',')??'neutral'}`;
  const markManual=useCallback(()=>{
    ++generation.current;requested.current=null;setPending(false);
    commit({...selectionRef.current,manual:true});
    const source=sourceRef.current;
    if(source) void current.current.command(adaptiveCommand(source,false,null)).catch(()=>{});
  },[commit]);
  const apply=useCallback(async(value:SoundSelection)=>{
    const audio=current.current, source=sourceRef.current;
    if(audio.status?.bypassAll||(!audio.status&&localStorage.getItem('dmex_bypass_all')==='true')) return;
    const id=++generation.current, fromManual=selectionRef.current.manual;
    requested.current=keyFor(value);commit(value);setPending(true);
    try {
      if(fromManual&&audio.environment!=='NONE') await audio.loadAsset('NONE',false);
      if(id!==generation.current) return;
      if(source) await audio.command(adaptiveCommand(source,false,null));
      if(id!==generation.current) return;
      await audio.update(soundPreset(value.categoryEnabled?'NATURAL':null,value.taste,value.categoryEnabled?analysisRef.current:null));
      if(id!==generation.current) return;
      if(source) await audio.command(adaptiveCommand(source,value.categoryEnabled,analysisRef.current,value.taste==='QUALITY'?1:.65));
    } catch(error) {
      if(id===generation.current) commit({...value,manual:true});
      throw error;
    } finally {if(id===generation.current) setPending(false);}
  },[commit]);
  const loadSource=useCallback(async(value:AdaptiveSource)=>{
    ++generation.current;sourceRef.current=value;analysisRef.current=null;requested.current=null;
    setAnalysis(null);setSource(value);
    if(!selectionRef.current.manual) await apply(selectionRef.current);
  },[apply]);
  const beginSource=useCallback(()=>{
    ++generation.current;sourceRef.current=null;analysisRef.current=null;requested.current=null;
    setSource(null);setAnalysis(null);setPending(false);
  },[]);
  const toggle=useCallback(()=>apply(toggleCategory(selectionRef.current)),[apply]);
  const chooseTaste=useCallback((taste:Taste)=>apply(selectTaste(selectionRef.current,taste)),[apply]);
  const setManualOverride=useCallback((manual:boolean)=>{
    if(manual) markManual(); else void apply({...selectionRef.current,categoryEnabled:true,manual:false}).catch(()=>{});
  },[apply,markManual]);
  const hydrateLegacy=useCallback((settings:{smartTaste?:unknown;isManualOverride?:boolean}|null)=>{
    if(localStorage.getItem(SOUND_SELECTION_KEY)||generation.current) return;
    commit({...DEFAULT_SOUND_SELECTION,taste:quickTaste(settings?.smartTaste),manual:settings?.isManualOverride===true});
  },[commit]);
  useEffect(()=>{if(ready) localStorage.setItem(SOUND_SELECTION_KEY,JSON.stringify(selection));},[ready,selection]);
  useEffect(()=>{
    // Raw/rate/recovery commands reopen the same file inside the native engine.
    // A normal track change clears sourceRef first, so it cannot be mistaken for this.
    const active=sourceRef.current, token=audio.status?.sourceGeneration;
    if(!audio.busy&&active&&typeof token==='number'&&Number.isSafeInteger(token)&&token>active.generation)
      void loadSource({...active,generation:token}).catch(()=>{});
  },[audio.status?.sourceGeneration,audio.busy,loadSource]);
  useEffect(()=>{
    if(audio.status?.bypassAll){requested.current=null;return;}
    if(!ready||audio.busy||!audio.status?.ready||selectionRef.current.manual) return;
    const value=selectionRef.current;
    if(requested.current!==keyFor(value)) void apply(value).catch(()=>{});
  },[source,analysis,ready,audio.busy,audio.status?.ready,audio.status?.bypassAll,apply]);
  useEffect(()=>{
    if(!source||!selection.categoryEnabled||selection.manual||audio.status?.bypassAll) return;
    let cancelled=false;
    void invoke<TrackAnalysis>('analyze_track_audio',{path:source.path,sourceGeneration:source.generation})
      .then(value=>{
        if(cancelled||sourceRef.current?.generation!==source.generation||!validAnalysis(value)) return;
        analysisRef.current=value;setAnalysis(value);
      }).catch(()=>{}); // Keep the selected intention; do not invent a corrective EQ.
    return()=>{cancelled=true;};
  },[source,selection.categoryEnabled,selection.manual,audio.status?.bypassAll]);
  return {selection,pending,analysis,beginSource,loadSource,markManual,setManualOverride,hydrateLegacy,toggle,chooseTaste,
    status:processingStatus(selection,null,!!audio.status?.bypassAll,pending||!ready||!audio.status?.ready),
    disabled:audio.busy||!ready||!audio.status?.ready||!!audio.status?.bypassAll};
}
