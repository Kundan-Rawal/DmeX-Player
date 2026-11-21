import type { Track } from '../types';

// Filesystem timestamps and filename guesses are not release-year metadata.
export function releaseYear(track: Pick<Track, 'year'>): number | null {
  const match = String(track.year ?? '').trim().match(/^(\d{4})(?:$|[-/.T\s])/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= new Date().getFullYear() + 1 ? year : null;
}
export function isClassicYear(track: Pick<Track, 'year'>): boolean {
  const year = releaseYear(track);
  return year !== null && year >= 1980 && year <= 2003;
}
