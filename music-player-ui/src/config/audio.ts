import { DSPSettings, Track } from '../types';
import { Music, Mic, Zap, Headphones, Waves, Disc3 } from 'lucide-react';
import React from 'react';
import { CATEGORY_LABELS, metadataCategory, signalCategory, soundPreset } from './soundPresets';

export interface AudioProfile { id: string; label: string; icon: React.ElementType; description: string; settings: DSPSettings }
export const PROFILES: AudioProfile[] = Object.entries(CATEGORY_LABELS).map(([id, label]) => {
  const preset = soundPreset(id, 'IMMERSIVE');
  return { id, label, icon: id === 'CLASSICAL' ? Music : id === 'VOCAL' || id === 'SPOKEN' ? Mic : id === 'ELECTRONIC' ? Zap : id === 'AMBIENT' ? Waves : id === 'HIPHOP' ? Headphones : Disc3,
    description: id === 'BOLLYWOOD' ? 'Release-year collection' : id === 'POP' ? 'Standard music profile or embedded pop genre' : 'Embedded genre metadata',
    settings: { drive: preset.bass!, widen: preset.width!, spatial: preset.separation!, depth: preset.depth!, reverb: preset.reverb!, compress: false, remaster: false } };
});
export function classifyAudio(sc: number, cf: number, zcr: number, rms: number, track?: Pick<Track, 'genre' | 'year'>): AudioProfile {
  const id = metadataCategory(track) || signalCategory(sc, cf, zcr, rms);
  return PROFILES.find(profile => profile.id === id)!;
}
