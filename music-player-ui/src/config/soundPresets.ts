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
export function soundPreset(category: string | null, taste: Taste, analysis?: {eqDb:number[];confidence:number;crestDb:number} | null): Partial<Record<Parameter, number>> {
  const neutral = { bass: 0, treble: 0, exciter: 0, width: 1, separation: 0, depth: 0,
    reverb: 0, compressor: 0, bassField: 0, roomBass: 0, vocal: 0, air: 0, spatial: 0,
    boost: 0, loudness: 0, roomSize: .72, damping: .6 };
  if(!category&&taste==='ORIGINAL') return neutral;
  const focus={...neutral,bass:.30,vocal:.65,width:1.08,spatial:1,separation:.52,depth:.36};
  const recipe=taste==='QUALITY' ? {...focus,bass:.26,vocal:.70,width:1.05,spatial:0,separation:0,depth:0}
    :taste==='IMMERSIVE' ? {...focus,bass:.36,vocal:.65,width:1.16,separation:.72,depth:.62,reverb:.05,roomSize:.58,damping:.72}
    :taste==='CHILL' ? {...focus,bass:.30,vocal:.58,width:1.12,separation:.66,depth:.80,reverb:.10,roomSize:.68,damping:.80}
    :focus;
  // Do not fight a measured excess with a fixed enhancement in the same region.
  if(analysis&&analysis.confidence>=.8) {
    recipe.bass*=Math.max(0,1+(analysis.eqDb[0]||0)/1.5);
    recipe.vocal*=Math.cbrt(1-.5*Math.min(1,Math.abs(analysis.eqDb[2]||0)));
    if(analysis.crestDb<8) recipe.bass*=.65;
  }
  return recipe;
}
