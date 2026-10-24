import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Track } from '../types';

interface NativeMetadata {
  title?: string; artist?: string; album?: string; year?: string; genre?: string;
  duration: number; quality?: string; artPath?: string;
}
type ExtractedTrack = Partial<Track> & Pick<Track, 'name' | 'artist'> & { artPath?: string };
const pending = new Map<string, Promise<ExtractedTrack>>();
export function extractTrackMetadata(track: Track): Promise<ExtractedTrack> {
  const existing = pending.get(track.path);
  if (existing) return existing;
  const operation = invoke<NativeMetadata>('extract_audio_metadata', { path: track.path }).then(meta => ({
    name: meta.title?.trim() || track.name, artist: meta.artist?.trim() || track.artist,
    album: meta.album?.trim() || track.album, year: meta.year || track.year, genre: meta.genre || track.genre,
    duration: meta.duration > 0 ? meta.duration : track.duration, quality: meta.quality || track.quality,
    thumb: meta.artPath ? convertFileSrc(meta.artPath) : track.thumb, artPath: meta.artPath, metadataLoaded: true,
  })).finally(() => pending.delete(track.path));
  pending.set(track.path, operation);
  return operation;
}
