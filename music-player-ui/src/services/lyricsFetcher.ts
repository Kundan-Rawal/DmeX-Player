import { Track } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { chooseLyricsMatch, LyricsCandidate, sanitizeForLyricsAPI } from '../utils/metadataCleaner';

export async function fetchLyricsOnline(track: Track, onProgress: (message: string) => void, signal?: AbortSignal): Promise<string | null> {
  const { queryTitle, queryArtist } = sanitizeForLyricsAPI(track);
  if (!queryTitle) return null;
  const request = async (url: string) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Lyrics service returned ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  const search = async (title: string, artist: string) => {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.duration > 0) params.set('duration', String(Math.round(track.duration)));
    const exact = await request(`https://lrclib.net/api/get?${params}`);
    const match = exact && chooseLyricsMatch([exact], title, artist, track.duration);
    if (match) return match.syncedLyrics || null;
    const results: LyricsCandidate[] | null = await request(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, ...(artist ? { artist_name: artist } : {}) })}`);
    return chooseLyricsMatch(Array.isArray(results) ? results : [], title, artist, track.duration)?.syncedLyrics || null;
  };
  try {
    onProgress('Searching lyrics...');
    const artists = [...new Set([queryArtist, ...queryArtist.split(/;|,|\s+feat\.?\s+|\s+ft\.?\s+/i)])];
    for (const artist of artists.slice(0, 4)) {
      if (signal?.aborted) return null;
      const lyrics = await search(queryTitle, artist.trim());
      if (lyrics) return lyrics;
    }
    if (signal?.aborted) return null;
    onProgress('Checking song identity...');
    const identity = await invoke<{ title: string; artists: string[] } | null>('identify_lyrics_song', {
      title: queryTitle, artist: queryArtist, duration: track.duration,
    });
    if (identity && !signal?.aborted) {
      for (const artist of identity.artists.slice(0, 3)) {
        if (signal?.aborted) return null;
        const lyrics = await search(identity.title, artist);
        if (lyrics) return lyrics;
      }
    }
    onProgress('No matching synced lyrics found. Try the song and singer names below.');
  } catch {
    if (!signal?.aborted) onProgress('Lyrics search failed. Check your connection, or correct the names below and retry.');
  }
  return null;
}
