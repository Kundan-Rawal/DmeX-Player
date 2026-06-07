import { Taste, DSPSettings } from '../types';
import { Music, MicVocal, Mic, Zap, Headphones, Waves, Disc3 } from 'lucide-react';
import React from 'react';

export interface AudioProfile { id:string; label:string; icon:React.ElementType; description:string; settings:DSPSettings; }

export const PROFILES: AudioProfile[] = [
  { id:'CLASSICAL', label:'Classical / Orchestral', icon:Music, description:'High dynamic range · Natural wide field', settings:{ drive:0.2, widen:1.25, spatial:0.08, reverb:0.10, compress:false, remaster:false } },
  { id:'BOLLYWOOD', label:'90s Bollywood Classics', icon:MicVocal, description:'Warm vintage analog · Vocals front & center', settings:{ drive:0.4, widen:1.12, spatial:0.05, reverb:0.05, compress:true, remaster:false } },
  { id:'VOCAL', label:'Vocal / Acoustic', icon:Mic, description:'Center-heavy · Lead vocals protected', settings:{ drive:0.4, widen:1.10, spatial:0.05, reverb:0.04, compress:true, remaster:false } },
  { id:'ELECTRONIC', label:'Electronic / EDM', icon:Zap, description:'Brickwall master · Exciter restores air', settings:{ drive:1.4, widen:1.25, spatial:0.08, reverb:0.04, compress:true, remaster:false } },
  { id:'HIPHOP', label:'Hip-Hop / R&B', icon:Headphones, description:'Punchy · Tight dynamics', settings:{ drive:1.0, widen:1.15, spatial:0.06, reverb:0.03, compress:true, remaster:false } },
  { id:'AMBIENT', label:'Ambient / Chill', icon:Waves, description:'Low energy · Generous reverb space', settings:{ drive:0.1, widen:1.0, spatial:0.20, reverb:0.18, compress:false, remaster:false } },
  { id:'POP', label:'Pop / Standard', icon:Disc3, description:'Balanced mix · Universal profile', settings:{ drive:0.7, widen:1.20, spatial:0.07, reverb:0.06, compress:true, remaster:false } },
];

export const FIR_GAINS: Record<string, [number,number,number]> = {
  CLASSICAL:[1.05, 0.95, 1.25], BOLLYWOOD:[1.15, 0.95, 1.30], VOCAL:[1.00, 1.05, 1.35],
  ELECTRONIC:[1.35, 0.85, 1.40], HIPHOP:[1.30, 0.88, 1.25], AMBIENT:[1.05, 0.95, 1.40],
  POP:[1.10, 0.95, 1.30], DEFAULT:[1.10, 0.95, 1.25],
};

export function classifyAudio(sc:number, cf:number, zcr:number, rms:number): AudioProfile {
  if (cf>18 && rms<0.08)             return PROFILES[5];
  if (cf>14 && sc>0.70 && zcr<0.08)  return PROFILES[0];
  if (sc>0.88 && cf>10 && zcr<0.05)  return PROFILES[1];
  if (sc>0.80 && cf>10)              return PROFILES[2];
  if (cf<8   && zcr>0.12)            return PROFILES[3];
  if (cf<11  && rms>0.18)            return PROFILES[4];
  return PROFILES[6];
}

export function applyTaste(base:DSPSettings, taste:Taste): DSPSettings {
  const s = {...base};
  if (taste==='QUALITY') {
    s.drive = base.drive * 0.35;    
    s.widen = 1.08;                 
    s.spatial = 0.0;                
    s.reverb = 0.01;                
    s.compress = false; 
    s.remaster = base.remaster;
  } else if (taste==='IMMERSIVE') {
    s.drive = Math.min(2.0, base.drive + 0.15); 
    s.widen = Math.min(1.5, base.widen + 0.20); 
    s.spatial = Math.max(0.25, base.spatial + 0.15); 
    s.reverb = Math.max(0.12, base.reverb + 0.08);   
    s.compress = true;
    s.remaster = base.remaster;
  } else if (taste==='CHILL') {
    s.drive = base.drive * 0.2; 
    s.widen = 1.0;
    s.spatial = Math.min(0.30, base.spatial + 0.10); 
    s.reverb = Math.min(0.30, base.reverb + 0.12);
    s.compress = false;
    s.remaster = base.remaster;
  }
  return s;
}