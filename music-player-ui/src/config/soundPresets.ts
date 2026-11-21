import type { Taste, Track } from '../types';
import type { Parameter } from '../components/player/AudioSettingsContext';
import { isClassicYear } from '../utils/trackYear';

export const CATEGORY_LABELS: Record<string, string> = {
  POP: 'Pop / Standard', CLASSICAL: 'Classical / Orchestral', VOCAL: 'Acoustic / Vocal',
  ELECTRONIC: 'Electronic / Dance', HIPHOP: 'Hip-Hop / R&B', JAZZ: 'Jazz / Blues',
  ROCK: 'Rock / Metal', SPOKEN: 'Speech / Podcast', AMBIENT: 'Ambient', BOLLYWOOD: "90's Classic",
  OTHER: 'Other / Untagged',
};
export function metadataCategory(track?: Pick<Track, 'genre' | 'year'>): string | null {
  if (track && isClassicYear(track)) return 'BOLLYWOOD';
  const genre = track?.genre?.normalize('NFKC').toLowerCase() || '';
  const rules: [string, RegExp][] = [
    ['SPOKEN', /podcast|spoken|speech|audiobook/], ['ROCK', /metal/],
    ['CLASSICAL', /classical|orchestr|symphon|opera|chamber/], ['JAZZ', /jazz|blues/],
    ['HIPHOP', /r\s*&\s*b|rhythm.*blues|soul|hip[ -]?hop|\brap\b/],
    ['ELECTRONIC', /electronic|\bedm\b|house|techno|trance|dance|dubstep/],
    ['AMBIENT', /ambient|meditation|new age/], ['ROCK', /rock|punk/],
    ['VOCAL', /folk|world|country|traditional|acoustic|vocal|singer.songwriter/],
    ['POP', /\bpop\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(genre))?.[0] || null;
}
export function signalCategory(_sc: number, _cf: number, _zcr: number, _rms: number): string {
  // These statistics do not establish a genre or release year.
  return 'OTHER';
}
export function canonicalCategory(category: string): string {
  if (category === 'RNB') return 'HIPHOP';
  if (category === 'METAL') return 'ROCK';
  if (category === 'FOLK') return 'VOCAL';
  return category in CATEGORY_LABELS ? category : 'OTHER';
}
// Runtime quick-preset recipes from 842a9f2 App.applySmartSettings.
export function soundPreset(_category:string|null,taste:Taste):Partial<Record<Parameter,number>> {
  const neutral={bass:0,treble:0,exciter:0,width:1,separation:0,depth:0,reverb:0,compressor:0,
    bassField:0,roomBass:0,vocal:0,air:0,spatial:0,boost:0};
  if(taste==='QUALITY')return {...neutral,bass:.25,vocal:.12};
  if(taste==='IMMERSIVE')return {...neutral,bass:.35,spatial:1,separation:.55,depth:.40,reverb:.08};
  if(taste==='CHILL')return {...neutral,bass:.15,treble:-1,reverb:.12};
  return neutral;
}
