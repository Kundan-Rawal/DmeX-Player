import type { Taste } from '../types';
import type { Parameter } from '../components/player/AudioSettingsContext';

export const CATEGORY_LABELS: Record<string, string> = {
  POP: 'Pop', CLASSICAL: 'Classical / Orchestral', VOCAL: 'Acoustic / Vocal',
  ELECTRONIC: 'Electronic / Dance', HIPHOP: 'Hip-Hop', RNB: 'R&B / Soul', JAZZ: 'Jazz / Blues',
  ROCK: 'Rock', METAL: 'Metal', FOLK: 'Folk / World',
  SPOKEN: 'Speech / Podcast', AMBIENT: 'Ambient', BOLLYWOOD: 'Classics (1880-2003)',
  DYNAMIC: 'Dynamic recording', DENSE: 'Dense recording', CENTERED: 'Center-focused recording',
  WIDE: 'Wide recording', BALANCED: 'Balanced / Unclassified',
};
export function metadataCategory(track?: { genre?: string }): string | null {
  const genre = track?.genre?.normalize('NFKC').toLowerCase() || '';
  const rules: [string, RegExp][] = [
    ['SPOKEN', /podcast|spoken|speech|audiobook/], ['METAL', /metal/],
    ['CLASSICAL', /classical|orchestr|symphon|opera|chamber/], ['JAZZ', /jazz|blues/],
    ['RNB', /r\s*&\s*b|rhythm.*blues|soul/], ['HIPHOP', /hip[ -]?hop|\brap\b/],
    ['ELECTRONIC', /electronic|\bedm\b|house|techno|trance|dance|dubstep/],
    ['AMBIENT', /ambient|meditation|new age/], ['ROCK', /rock|punk/],
    ['FOLK', /folk|world|country|traditional/], ['VOCAL', /acoustic|vocal|singer.songwriter/],
    ['POP', /\bpop\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(genre))?.[0] || null;
}
export function signalCategory(sc: number, cf: number, _zcr: number, rms: number): string {
  if (![sc, cf, rms].every(Number.isFinite) || rms <= .00001 || cf < 0 || sc < -1.01 || sc > 1.01) return 'BALANCED';
  if (cf > 14 && rms < .16) return 'DYNAMIC';
  if (cf < 9 && rms > .15) return 'DENSE';
  if (sc > .88) return 'CENTERED';
  if (sc < .35) return 'WIDE';
  return 'BALANCED';
}
export function soundPreset(category: string | null, taste: Taste): Partial<Record<Parameter, number>> {
  const neutral = { bass: 0, treble: 0, exciter: 0, width: 1, separation: 0, depth: 0,
    reverb: 0, compressor: 0, bassField: 0, roomBass: 0, vocal: 0, air: 0, spatial: 0,
    boost: 0, loudness: 0, roomSize: .72, damping: .6 };
  if (!['QUALITY', 'IMMERSIVE', 'CHILL'].includes(taste)) {
    if (!category) return neutral;
    const defaults: Record<string, Partial<typeof neutral>> = {
      POP: { bass: .65, treble: 3, vocal: .45, width: 1.15, air: .35 },
      CLASSICAL: { bass: .35, treble: 2, vocal: .30, width: 1.12, air: .30 }, JAZZ: { bass: .45, treble: 2, width: 1.12, vocal: .35, air: .30 },
      VOCAL: { bass: .45, treble: 3, vocal: .65, air: .40 }, FOLK: { bass: .45, treble: 2.5, vocal: .60, air: .35 },
      ELECTRONIC: { bass: .85, treble: 3.5, width: 1.22, air: .35, vocal: .35 }, HIPHOP: { bass: .95, width: 1.12, vocal: .55, treble: 2.5, air: .25 },
      RNB: { bass: .70, treble: 2.5, width: 1.12, vocal: .60, air: .35 }, ROCK: { bass: .65, treble: 3, width: 1.18, vocal: .50, air: .30 },
      METAL: { bass: .55, treble: 1.5, width: 1.18, vocal: .40, air: .20 },
      SPOKEN: { treble: 2, vocal: .65 }, AMBIENT: { bass: .55, width: 1.20, air: .35, treble: 2, vocal: .30 },
      BOLLYWOOD: { bass: .60, treble: 1.5, vocal: .65, width: 1.08, air: .25 },
      DYNAMIC: { bass: .45, treble: 2, vocal: .35, width: 1.12, air: .30 }, DENSE: { bass: .55, treble: 1.5, vocal: .40, air: .20 },
      CENTERED: { bass: .55, vocal: .60, treble: 2.5, air: .35 }, WIDE: { bass: .55, vocal: .40, treble: 2.5, air: .30 },
      BALANCED: { bass: .65, treble: 3, width: 1.12, vocal: .45, air: .35 },
    };
    return { ...neutral, ...(defaults[category] || defaults.BALANCED) };
  }
  const result = taste === 'QUALITY' ? { ...neutral, bass: .75, treble: 5, exciter: .20, width: 1.12, vocal: .65, air: .60 }
    : taste === 'IMMERSIVE' ? { ...neutral, bass: .95, treble: 5, exciter: .15, width: 1.20, vocal: .60, air: .50, spatial: 1, separation: .85, depth: .70, reverb: .20, bassField: .20, roomBass: 1 }
    : { ...neutral, bass: .85, treble: 2, width: 1.15, vocal: .60, air: .50, spatial: 1, separation: .90, depth: .85, reverb: .35, bassField: .32, roomBass: 1, roomSize: .80, damping: .65 };
  // Source-aware adjustments preserve each preset's character without tiny no-op recipes.
  switch (category) {
    case 'CLASSICAL': case 'JAZZ': case 'DYNAMIC':
      result.bass *= .8; result.exciter *= .5; result.reverb *= .8; break;
    case 'AMBIENT': case 'WIDE':
      result.reverb *= .8; break;
    case 'ELECTRONIC': case 'HIPHOP': case 'METAL': case 'DENSE':
      result.exciter = 0; result.reverb *= .8; result.bass *= .9; break;
    case 'VOCAL': case 'FOLK': case 'RNB': case 'CENTERED':
      result.vocal += .05; break;
    case 'SPOKEN':
      result.bass = 0; result.vocal = .65; result.exciter = 0; result.width = 1; result.bassField = 0; result.roomBass = 0;
      result.reverb = 0; result.spatial = 0; result.separation = 0; result.depth = 0; break;
    case 'BOLLYWOOD':
      result.exciter = 0; result.treble *= .7; break;
    case 'ROCK': result.reverb *= .75; result.exciter *= .5; break;
  }
  return result;
}
