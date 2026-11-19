import type { Taste } from '../types';
import { CATEGORY_LABELS } from './soundPresets';

export type QuickTaste = 'ORIGINAL' | 'QUALITY' | 'IMMERSIVE' | 'CHILL';
export interface SoundSelection { categoryEnabled: boolean; taste: QuickTaste; manual: boolean }
export const SOUND_SELECTION_KEY = 'dmex_sound_selection_v1';
export const DEFAULT_SOUND_SELECTION: SoundSelection = { categoryEnabled: true, taste: 'ORIGINAL', manual: false };
export const TASTE_LABELS: Record<QuickTaste, string> = { ORIGINAL: '', QUALITY: 'HD Clear', IMMERSIVE: 'Immersive', CHILL: 'Chill' };
export function quickTaste(value: Taste | unknown): QuickTaste {
  return value === 'QUALITY' || value === 'IMMERSIVE' || value === 'CHILL' ? value : 'ORIGINAL';
}
export function parseSoundSelection(raw: string | null): SoundSelection | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && typeof value.categoryEnabled === 'boolean' && typeof value.manual === 'boolean'
      ? { categoryEnabled: value.categoryEnabled, manual: value.manual, taste: quickTaste(value.taste) } : null;
  } catch { return null; }
}
export function toggleCategory(selection: SoundSelection): SoundSelection {
  return { ...selection, manual: false, categoryEnabled: selection.manual || !selection.categoryEnabled };
}
export function selectTaste(selection: SoundSelection, taste: Taste): SoundSelection {
  const selected = quickTaste(taste);
  return { ...selection, manual: false, taste: !selection.manual && selection.taste === selected ? 'ORIGINAL' : selected };
}
export interface ProcessingStatus {
  label: string; category: string | null; pill: string | null;
  kind: 'automatic' | 'manual' | 'normal' | 'raw' | 'pending'; categoryEnabled: boolean;
}
export function processingStatus(selection: SoundSelection, profileId: string | null, raw = false, pending = false): ProcessingStatus {
  const base = { categoryEnabled: selection.categoryEnabled, category: null, pill: null };
  if (raw) return { ...base, label: 'Raw Stereo', kind: 'raw' };
  if (pending) return { ...base, label: 'Applying...', kind: 'pending' };
  if (selection.manual) return { ...base, label: 'Manual Override', kind: 'manual' };
  const category = selection.categoryEnabled ? CATEGORY_LABELS[profileId || 'BALANCED'] || CATEGORY_LABELS.BALANCED : null;
  const pill = TASTE_LABELS[selection.taste] || null;
  return { categoryEnabled: selection.categoryEnabled, category, pill,
    label: [category, pill].filter(Boolean).join(' + ') || 'Normal Stereo', kind: category || pill ? 'automatic' : 'normal' };
}
