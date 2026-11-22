import type { Parameter } from '../components/player/AudioSettingsContext';
import type { Taste } from '../types';

export interface RecordingSignature {
  version: number; confidence: number; activeSeconds: number; sampledSeconds: number;
  rmsDbfs: number; peakDbfs: number; crestDb: number; correlation: number; sideRatio: number;
  bassRatio: number; lowMidRatio: number; presenceRatio: number; highRatio: number; highFlatness: number;
}
export const PRESET_PARAMETERS = [
  'bass', 'treble', 'exciter', 'air', 'vocal', 'width', 'spatial', 'separation',
  'depth', 'roomBass', 'subBassHz', 'bassField', 'reverb',
] as const satisfies readonly Parameter[];
export const isPresetParameter = (key: Parameter) => (PRESET_PARAMETERS as readonly string[]).includes(key);
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function validSignature(value: unknown): value is RecordingSignature {
  if (!value || typeof value !== 'object') return false;
  const s = value as RecordingSignature;
  const ratios = [s.confidence, s.sideRatio, s.bassRatio, s.lowMidRatio, s.presenceRatio, s.highRatio, s.highFlatness];
  return s.version === 1 && ratios.every(v => Number.isFinite(v) && v >= 0 && v <= 1) &&
    [s.rmsDbfs, s.peakDbfs, s.crestDb, s.correlation, s.activeSeconds, s.sampledSeconds].every(Number.isFinite) &&
    s.rmsDbfs >= -200 && s.rmsDbfs <= 24 && s.peakDbfs >= -200 && s.peakDbfs <= 24 &&
    s.crestDb >= 0 && s.crestDb <= 100 && Math.abs(s.correlation) <= 1 &&
    s.activeSeconds >= 0 && s.activeSeconds <= s.sampledSeconds && s.sampledSeconds > 0 && s.sampledSeconds <= 60 &&
    s.peakDbfs >= s.rmsDbfs - 1e-6 && Math.abs(s.crestDb - (s.peakDbfs - s.rmsDbfs)) < 1e-5 &&
    s.bassRatio + s.lowMidRatio + s.presenceRatio + s.highRatio <= 1 + 1e-6;
}

// Bass is displayed as 0..100% over the engine's 0..2.1 range.
export const bassFromPercent = (percent: number) => percent * 2.1 / 100;
export function referencePreset(taste: Taste): Partial<Record<Parameter, number>> {
  if (taste === 'QUALITY') return { exciter: .9, air: .7, vocal: .8, width: 1.1,
    spatial: 0, separation: 0, depth: 0, roomBass: 0, subBassHz: 60, bassField: 0,
    reverb: 0, bass: bassFromPercent(45), treble: 4 };
  if (taste === 'CHILL') return { exciter: .4, air: .3, vocal: .8, width: 1.75,
    spatial: 1, separation: .9, depth: .9, roomBass: 1, subBassHz: 60, bassField: .3,
    reverb: .7, bass: bassFromPercent(50), treble: 5.5 };
  return { exciter: .6, air: .5, vocal: .5, width: 1.5,
    spatial: 1, separation: .9, depth: .8, roomBass: 1, subBassHz: 60, bassField: .2,
    reverb: .25, bass: bassFromPercent(30), treble: 2.5 };
}
export function enhancedPreset(taste: Taste, signature?: RecordingSignature | null): Partial<Record<Parameter, number>> {
  const preset = referencePreset(taste);
  if (!validSignature(signature) || signature.confidence < .35) return preset;
  const s = signature, weight = s.confidence;
  const narrow = clamp((.18 - s.sideRatio) / .18), wide = clamp((s.sideRatio - .28) / .35);
  const phase = clamp(-s.correlation), bright = clamp((s.highRatio - .12) / .25);
  const dark = clamp((.08 - s.highRatio) / .08), heavy = clamp((s.bassRatio - .28) / .4);
  const lean = clamp((.12 - s.bassRatio) / .12), masked = clamp((s.lowMidRatio - .25) / .35);
  const presence = clamp((s.presenceRatio - .3) / .35), recessed = clamp((.25 - s.presenceRatio) / .25);
  const dense = clamp((10 - s.crestDb) / 6);
  const adjust = (key: Parameter, delta: number, min: number, max: number) => {
    preset[key] = Math.round(clamp(preset[key]! + delta * weight, min, max) * 1000) / 1000;
  };
  // Broad spectral ratios are tonal proxies, not singer/stem recognition.
  // Every continuous reference control can adapt; no genre determines the recipe.
  adjust('exciter', .08 * dark - .12 * bright - .04 * dense, .2, .98);
  adjust('air', .08 * dark - .1 * bright, .18, .82);
  adjust('vocal', .2 * masked + .14 * recessed - .12 * presence, .45, .92);
  adjust('width', .4 * narrow - .18 * wide - .12 * phase, taste === 'QUALITY' ? 1.02 : 1.35, taste === 'QUALITY' ? 1.25 : 2);
  adjust('bass', .12 * lean - .16 * heavy - .04 * dense, bassFromPercent(taste === 'QUALITY' ? 30 : 20), bassFromPercent(taste === 'CHILL' ? 60 : 50));
  adjust('treble', .9 * dark - 1.1 * bright - .25 * presence, taste === 'CHILL' ? 3 : taste === 'QUALITY' ? 3 : 1.5, taste === 'CHILL' ? 7 : 5);
  if (taste === 'QUALITY') {
    // Its dry, non-9D identity remains deliberate, including on narrow sources.
    preset.reverb = Math.round(.08 * narrow * weight * 1000) / 1000;
  } else {
    adjust('separation', .06 * narrow - .1 * wide - .08 * phase, .72, .98);
    adjust('depth', .08 * narrow - .08 * wide - .05 * phase, .65, .98);
    adjust('bassField', .04 * narrow - .08 * heavy - .03 * phase, .1, .38);
    adjust('reverb', .06 * narrow - .08 * masked - .04 * wide, taste === 'CHILL' ? .5 : .16, taste === 'CHILL' ? .8 : .34);
  }
  preset.subBassHz = s.bassRatio > .55 ? 52 : s.bassRatio < .06 ? 70 : 60;
  return preset;
}

export function suggestedSpeakerBoost(signature?: RecordingSignature | null): number {
  if (!validSignature(signature) || signature.confidence < .65 || signature.activeSeconds < 6) return 0;
  // Conservative active-sample RMS heuristic, not LUFS or whole-song loudness.
  return signature.rmsDbfs < -24 && signature.peakDbfs < -8 && signature.crestDb < 19 ? .3 : 0;
}
