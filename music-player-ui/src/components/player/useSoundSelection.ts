import { useCallback, useEffect, useRef, useState } from 'react';
import type { Taste } from '../../types';
import { soundPreset } from '../../config/soundPresets';
import { DEFAULT_SOUND_SELECTION, parseSoundSelection, processingStatus, quickTaste, selectTaste, SOUND_SELECTION_KEY, SoundSelection, toggleCategory } from '../../config/soundSelection';
import { PARAM, Parameter, useAudioSettings } from './AudioSettingsContext';

export function useSoundSelection(_profileId:string|null,ready:boolean) {
  const audio=useAudioSettings();
  const [selection,setSelection]=useState(()=>parseSoundSelection(localStorage.getItem(SOUND_SELECTION_KEY))||{...DEFAULT_SOUND_SELECTION});
  const selectionRef=useRef(selection),current=useRef(audio);current.current=audio;
  const [pending,setPending]=useState(false),generation=useRef(0),requested=useRef<string|null>(null);
  const originalValues=useRef<number[]|null>(null);
  const commit=useCallback((value:SoundSelection)=>{selectionRef.current=value;setSelection(value);},[]);
  const markManual=useCallback(()=>{++generation.current;requested.current=null;setPending(false);commit({...selectionRef.current,manual:true});},[commit]);
  const apply=useCallback(async(value:SoundSelection,forcePreset=false,restore=false)=>{
    const audio=current.current;
    if(audio.status?.bypassAll||(!audio.status&&localStorage.getItem('dmex_bypass_all')==='true'))return;
    const id=++generation.current;requested.current=`${value.categoryEnabled}:${value.taste}`;commit(value);setPending(true);
    try {
      // The pre-category engine kept configured controls across track loads.
      // Only explicit pill selection applied its recorded runtime recipe.
      if(value.taste==='ORIGINAL'&&value.categoryEnabled&&!forcePreset) {
        if(restore&&originalValues.current) {
          const changes:Partial<Record<Parameter,number>>={};
          for(const [key,index]of Object.entries(PARAM))if(key!=='volume'&&key!=='device')changes[key as Parameter]=originalValues.current[index];
          await audio.update(changes);
        }
      } else await audio.update(soundPreset(null,value.taste));
    } catch(error) {if(id===generation.current)commit({...value,manual:true});throw error;}
    finally {if(id===generation.current)setPending(false);}
  },[commit]);
  const toggle=useCallback(()=>{
    const value=selectionRef.current;
    if(!value.manual&&value.categoryEnabled&&value.taste==='ORIGINAL')originalValues.current=[...current.current.values];
    return apply(toggleCategory(value),false,!value.categoryEnabled);
  },[apply]);
  const chooseTaste=useCallback((taste:Taste)=>apply(selectTaste(selectionRef.current,taste),true),[apply]);
  const setManualOverride=useCallback((manual:boolean)=>{if(manual)markManual();else void apply({...selectionRef.current,categoryEnabled:true,manual:false}).catch(()=>{});},[apply,markManual]);
  const hydrateLegacy=useCallback((settings:{smartTaste?:unknown;isManualOverride?:boolean}|null)=>{
    if(localStorage.getItem(SOUND_SELECTION_KEY)||generation.current)return;
    commit({...DEFAULT_SOUND_SELECTION,taste:quickTaste(settings?.smartTaste),manual:settings?.isManualOverride===true});
  },[commit]);
  useEffect(()=>{if(ready)localStorage.setItem(SOUND_SELECTION_KEY,JSON.stringify(selection));},[ready,selection]);
  useEffect(()=>{
    if(audio.status?.bypassAll){requested.current=null;return;}
    if(!ready||audio.busy||!audio.status?.ready||selectionRef.current.manual)return;
    const value=selectionRef.current,key=`${value.categoryEnabled}:${value.taste}`;
    if(requested.current!==key)void apply(value).catch(()=>{});
  },[ready,audio.busy,audio.status?.ready,audio.status?.bypassAll,apply]);
  return {selection,pending,markManual,setManualOverride,hydrateLegacy,toggle,chooseTaste,
    status:processingStatus(selection,null,!!audio.status?.bypassAll,pending||!ready||!audio.status?.ready),
    disabled:audio.busy||!ready||!audio.status?.ready||!!audio.status?.bypassAll};
}
