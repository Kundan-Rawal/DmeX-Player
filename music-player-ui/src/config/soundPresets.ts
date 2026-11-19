import type { Taste } from '../types';
import type { Parameter } from '../components/player/AudioSettingsContext';

export const CATEGORY_LABELS: Record<string, string> = {
  POP: 'Pop', CLASSICAL: 'Classical / Orchestral', VOCAL: 'Acoustic / Vocal',
  ELECTRONIC: 'Electronic / Dance', HIPHOP: 'Hip-Hop', RNB: 'R&B / Soul', JAZZ: 'Jazz / Blues',
  ROCK: 'Rock', METAL: 'Metal', FOLK: 'Folk / World', SOUNDTRACK: 'Film / Soundtrack',
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
    ['SOUNDTRACK', /soundtrack|film score|bollywood/], ['POP', /\bpop\b/],
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
      POP: { bass: .10, treble: .3, vocal: .03, width: 1.02 },
      CLASSICAL: { bass: .04, treble: .2, width: 1.03 }, JAZZ: { bass: .05, treble: .1, width: 1.02 },
      VOCAL: { bass: .05, treble: .3, vocal: .08 }, FOLK: { bass: .04, treble: .2, vocal: .06 },
      ELECTRONIC: { bass: .14, treble: .2, width: 1.04, air: .02 }, HIPHOP: { bass: .16, width: 1.02, vocal: .04 },
      RNB: { bass: .10, treble: .2, width: 1.02, vocal: .06 }, ROCK: { bass: .08, treble: .2, width: 1.03, vocal: .04 },
      METAL: { bass: .06, treble: -.2, width: 1.02, vocal: .02 }, SOUNDTRACK: { bass: .06, width: 1.04, air: .02 },
      SPOKEN: { treble: .2, vocal: .12 }, AMBIENT: { bass: .04, width: 1.04, air: .02 },
      BOLLYWOOD: { bass: .06, treble: -.3, vocal: .08, width: 1.01 },
      DYNAMIC: { bass: .04, width: 1.02 }, DENSE: { bass: .03, treble: -.2 },
      CENTERED: { bass: .04, vocal: .04 }, WIDE: { bass: .04 }, BALANCED: { bass: .06, treble: .2, width: 1.01, vocal: .02 },
    };
    return { ...neutral, ...(defaults[category] || defaults.BALANCED) };
  }
  const result = taste === 'QUALITY' ? { ...neutral, bass: .12, treble: 1.4, exciter: .04, width: 1.02, vocal: .10, air: .10 }
    : taste === 'IMMERSIVE' ? { ...neutral, bass: .24, treble: .6, exciter: .025, width: 1.08, vocal: .08, air: .06, spatial: 1, separation: .45, depth: .34, reverb: .08 }
    : { ...neutral, bass: .18, treble: -.8, width: 1.06, vocal: .04, air: .03, spatial: 1, separation: .62, depth: .52, reverb: .16, roomSize: .76, damping: .68 };
  // Conservative source-aware adjustments; these cannot reconstruct missing source detail.
  switch (category) {
    case 'CLASSICAL': case 'JAZZ': case 'DYNAMIC':
      result.bass *= .6; result.exciter *= .5; result.reverb *= .65; result.depth *= .85; break;
    case 'AMBIENT': case 'SOUNDTRACK': case 'WIDE':
      result.reverb *= .6; result.separation *= .75; result.depth *= .8; break;
    case 'ELECTRONIC': case 'HIPHOP': case 'METAL': case 'DENSE':
      result.exciter = 0; result.treble *= .7; result.reverb *= .65; result.bass *= .85; break;
    case 'VOCAL': case 'FOLK': case 'RNB': case 'CENTERED':
      result.vocal += .03; result.separation *= .65; result.depth *= .75; break;
    case 'SPOKEN':
      result.bass = 0; result.vocal = .12; result.exciter = 0; result.width = 1;
      result.reverb = 0; result.spatial = 0; result.separation = 0; result.depth = 0; break;
    case 'BOLLYWOOD':
      result.exciter = 0; result.air *= .5; result.treble *= .5; result.separation *= .6; break;
    case 'ROCK': result.reverb *= .75; result.exciter *= .5; break;
  }
  return result;
}
