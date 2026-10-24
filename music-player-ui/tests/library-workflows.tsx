import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import App from '../src/App';
import { AudioSettingsProvider, DEFAULT_AUDIO } from '../src/components/player/AudioSettingsContext';
import { LyricsSearch } from '../src/components/player/LyricsSearch';
import { cleanArtistString, buildArtistDictionary, artistCacheKey } from '../src/utils/artistEngine';
import { sanitizeForLyricsAPI, chooseLyricsMatch } from '../src/utils/metadataCleaner';
import { parseLRC } from '../src/utils/formatters';
import { Track } from '../src/types';
import { includeLibraryTrack, parseLibraryFilters, MINIMUM_DURATIONS } from '../src/utils/libraryFilters';

const tracks: Track[] = [];
const query = new URLSearchParams(location.search);
if (query.has('filters')) {
  for (const [name, duration] of [['Short sound', 5], ['Boundary song', 10], ['Call RECORDING 2026', 90], ['Recording of CALL', 100], ['Callback song', 120], ['Regular song', 120], ['Unknown duration', 0]] as const) {
    tracks.push({ path: `/Music/${name}.wav`, name, duration, artist: 'Test Singer', album: 'Test Album', metadataLoaded: true });
  }
}
if (query.has('metadata-failure')) tracks.push({ path: '/Music/broken.flac', name: 'Broken file', artist: 'Unknown Artist', duration: 0, metadataLoaded: false });
const store = new Map<string, unknown>();
const calls: { command: string; payload: any }[] = [];
(window as any).libraryTest = { tracks, calls, cleanArtistString, buildArtistDictionary, artistCacheKey, sanitizeForLyricsAPI, chooseLyricsMatch, parseLRC, includeLibraryTrack, parseLibraryFilters, MINIMUM_DURATIONS };
mockIPC((command, payload: any) => {
  calls.push({ command, payload });
  if (command === 'audio_status') return { ready: true, settings: DEFAULT_AUDIO, generation: 1, bypassAll: false, ecoMode: true };
  if (command === 'audio_metrics') return { currentTime: 0, duration: 120, audioLevel: 0, bassLevel: 0, midLevel: 0, trebleLevel: 0, limiterGain: 1 };
  if (command === 'fetch_library') return tracks.map(t => ({ ...t }));
  if (command === 'get_playlists') return [];
  if (command === 'get_all_artist_images') return {};
  if (command === 'get_setting') return store.get(payload.key) || null;
  if (command === 'set_setting') { store.set(payload.key, payload.value); return; }
  if (command === 'scan_android_music') return [{ file_path: '/Music/example.flac', title: 'Filename', artist: 'Unknown Artist', album: 'Unknown Album', duration: 0 }];
  if (command === 'pick_music_folder') return 'content://test/tree/selected';
  if (command === 'add_to_library') {
    const index = tracks.findIndex(t => t.path === payload.track.path);
    if (index < 0) tracks.push({ ...payload.track }); else tracks[index] = { ...tracks[index], ...payload.track };
    return;
  }
  if (command === 'add_library_tracks') { tracks.push(...payload.tracks); return; }
  if (command === 'extract_audio_metadata') {
    if (query.has('metadata-failure')) throw new Error('Test unreadable metadata');
    return { title: 'Correct Title', artist: 'Correct Singer', album: 'Correct Album', duration: 120, quality: '16-bit / 44.1 kHz' };
  }
  if (command === 'identify_lyrics_song') return null;
  if (command === 'plugin:store|load') return 1;
  if (command === 'plugin:store|get') return [store.get(payload.key), store.has(payload.key)];
  if (command === 'plugin:store|set') store.set(payload.key, payload.value);
});
function LyricsFixture() {
  const [saved, setSaved] = useState('');
  return <div style={{ color: 'white', background: '#111', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <LyricsSearch track={{ path: 'test.flac', name: 'Wrong title', artist: 'Unknown Artist', album: '', duration: 120 }} onLyrics={async (_, lyrics) => setSaved(lyrics)} />
    <output data-testid="saved-lyrics">{saved}</output>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
let mount = 0;
function render() { root.render(query.has('lyrics') ? <LyricsFixture /> : <AudioSettingsProvider key={mount++}><App /></AudioSettingsProvider>); }
(window as any).libraryTest.remount = render;
render();
