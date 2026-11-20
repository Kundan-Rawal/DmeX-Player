import type { Taste, Track } from '../types';
import type { Parameter } from '../components/player/AudioSettingsContext';
import { isClassicYear } from '../utils/trackYear';

export const CATEGORY_LABELS: Record<string, string> = {
  POP: 'Pop / Standard', CLASSICAL: 'Classical / Orchestral', VOCAL: 'Acoustic / Vocal',
  ELECTRONIC: 'Electronic / Dance', HIPHOP: 'Hip-Hop / R&B', JAZZ: 'Jazz / Blues',
  ROCK: 'Rock / Metal', SPOKEN: 'Speech / Podcast', AMBIENT: 'Ambient', BOLLYWOOD: "90's Classic",
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
  return 'POP';
}
export function canonicalCategory(category: string): string {
  if (category === 'RNB') return 'HIPHOP';
  if (category === 'METAL') return 'ROCK';
  if (category === 'FOLK') return 'VOCAL';
  return category in CATEGORY_LABELS ? category : 'POP';
}
export function soundPreset(category: string | null, taste: Taste): Partial<Record<Parameter, number>> {
  const neutral = { bass: 0, treble: 0, exciter: 0, width: 1, separation: 0, depth: 0,
    reverb: 0, compressor: 0, bassField: 0, roomBass: 0, vocal: 0, air: 0, spatial: 0,
    boost: 0, loudness: 0, roomSize: .72, damping: .6 };
  // Preference targets live only in preset recipes, never in engine/manual limits.
  const foundation = { ...neutral, bass: .42, treble: 2, exciter: .30, width: 1.20,
    vocal: .50, air: .20, bassField: .08, roomBass: 1, spatial: 1, separation: .55, depth: .45 };
  const categories: Record<string, Partial<typeof foundation>> = {
    POP: { bass: .55, bassField: .10, vocal: .55, reverb: .04 },
    CLASSICAL: { bassField: .06, width: 1.25, separation: .60, depth: .60, reverb: .08 },
    JAZZ: { bass: .48, bassField: .07, vocal: .55, depth: .40, reverb: .05 },
    VOCAL: { vocal: .65, bassField: .05, separation: .40, depth: .30, reverb: .04 },
    ELECTRONIC: { bass: .70, bassField: .16, width: 1.30, separation: .70, depth: .60, reverb: .06 },
    HIPHOP: { bass: .75, bassField: .12, vocal: .60, separation: .50, depth: .40, reverb: .03 },
    ROCK: { bass: .60, bassField: .08, vocal: .55, separation: .55, depth: .40, reverb: .04 },
    AMBIENT: { bassField: .20, width: 1.30, separation: .65, depth: .75, reverb: .10, damping: .75 },
    SPOKEN: { bassField: .04, vocal: .60, spatial: 0, separation: 0, depth: 0 },
    BOLLYWOOD: { bass: .50, bassField: .06, vocal: .60, separation: .45, depth: .40, reverb: .06 },
  };
  const base = category ? { ...foundation, ...categories[canonicalCategory(category)] } : neutral;
  if (!['QUALITY', 'IMMERSIVE', 'CHILL'].includes(taste)) return base;
  const pill = taste === 'QUALITY'
    ? { ...foundation, bassField: .06, treble: 2.5, vocal: .55, air: .25, spatial: 0, separation: 0, depth: 0, reverb: 0 }
    : taste === 'IMMERSIVE'
      ? { ...foundation, bass: .65, width: 1.35, separation: .75, depth: .65, reverb: .12, roomSize: .65, damping: .70 }
      : { ...foundation, bass: .55, width: 1.25, separation: .70, depth: .80, reverb: .18, roomSize: .76, damping: .80 };
  // Resolve one target vector. No second EQ pass, additive gain or multiplied width.
  return { ...pill, bass: Math.max(base.bass, pill.bass), vocal: Math.max(base.vocal, pill.vocal),
    width: Math.max(base.width, pill.width), bassField: category ? base.bassField : pill.bassField,
    reverb: taste === 'QUALITY' ? 0 : Math.max(base.reverb, pill.reverb) };
}
