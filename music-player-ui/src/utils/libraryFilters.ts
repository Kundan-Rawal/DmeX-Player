import { Track } from '../types';

export const MINIMUM_DURATIONS = [0, 10, 15, 20, 30, 60] as const;
export interface LibraryFilters { minimumDuration: number; skipCallRecordings: boolean }
export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = { minimumDuration: 0, skipCallRecordings: false };
export function parseLibraryFilters(value: string | null): LibraryFilters {
  try {
    const parsed = JSON.parse(value || '{}');
    return {
      minimumDuration: MINIMUM_DURATIONS.includes(parsed.minimumDuration) ? parsed.minimumDuration : 0,
      skipCallRecordings: parsed.skipCallRecordings === true,
    };
  } catch { return { ...DEFAULT_LIBRARY_FILTERS }; }
}
export function includeLibraryTrack(track: Track, filters: LibraryFilters): boolean {
  if (filters.minimumDuration > 0 && track.duration > 0 && track.duration < filters.minimumDuration) return false;
  if (filters.skipCallRecordings) {
    const words = new Set((track.name || '').normalize('NFKC').toLowerCase().match(/[\p{L}]+/gu) || []);
    if (words.has('call') && words.has('recording')) return false;
  }
  return true;
}
