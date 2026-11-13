import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import App from '../src/App';
import { AudioSettingsProvider, DEFAULT_AUDIO } from '../src/components/player/AudioSettingsContext';
import { LyricsSearch } from '../src/components/player/LyricsSearch';
import { cleanArtistString, buildArtistDictionary, artistCacheKey } from '../src/utils/artistEngine';
import { sanitizeForLyricsAPI, chooseLyricsMatch } from '../src/utils/metadataCleaner';
import { parseLRC } from '../src/utils/formatters';
import { Track } from '../src/types';
import { includeLibraryTrack, parseLibraryFilters, MINIMUM_DURATIONS } from '../src/utils/libraryFilters';
import { BRAND, DEFAULT_AMBIENT_COLORS } from '../src/config/brand';
import { getPalette, nudgeVibrancy, trackAccentColor } from '../src/utils/helpers';
import { createQueue } from '../src/mobile/queue';
import { emit } from '@tauri-apps/api/event';

const tracks: Track[] = [];
const query = new URLSearchParams(location.search);
const testPlaylists: { id: string; name: string; trackPaths: string[] }[] = [];
const artistImages: Record<string, string> = {};
if (query.has('mobile')) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 120;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < (query.has('navigation') ? 160 : 80); i++) {
    ctx.fillStyle = ['#315e87', '#b53f61', '#237a68', '#79583f'][i % 4]; ctx.fillRect(0, 0, 120, 120);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(String(i + 1).padStart(2, '0'), 28, 70);
    tracks.push({ path: `/Music/Album ${i % 8}/track-${i}.flac`, name: ['Night Drive', 'Paper Lanterns', 'Open Water', 'Every Little Moment'][i % 4] + ` ${i + 1}`,
      artist: query.has('navigation') ? i === 159 ? 'Unknown Artist' : `Artist ${i % 50 + 1}` : ['Kira Lane', 'Aarav', 'The Coast', 'Mina'][i % 4], album: `Sessions ${i % (query.has('navigation') ? 40 : 8) + 1}`, duration: 180 + i, dateAdded: 1794355200 - i * 1000, thumb: canvas.toDataURL(), metadataLoaded: true,
      isFavorite: i < 3, playCount: i < 8 ? 8 - i : 0, totalSecondsListened: i < 8 ? 3000 - i * 100 : 0, lastPlayed: i < 4 ? 1794355200000 - i * 1000 : 0 });
  }
  if (query.has('navigation')) tracks.forEach(track => { artistImages[artistCacheKey(track.artist)] = `/artist-art/${artistCacheKey(track.artist)}.png`; });
}
mockWindows('main');
mockConvertFileSrc('windows');
if (query.has('branding')) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d')!; context.fillStyle = '#c8222a'; context.fillRect(0, 0, 16, 16);
  tracks.push({ path: '/Music/artwork.wav', name: 'Artwork song', artist: 'Test Artist', duration: 120, metadataLoaded: true, thumb: canvas.toDataURL() },
    { path: '/Music/no-artwork.wav', name: 'No artwork song', artist: 'Test Artist', duration: 120, metadataLoaded: true });
  context.fillStyle = '#35a870'; context.fillRect(0, 0, 16, 16);
  tracks.push({ path: '/Music/second-artwork.wav', name: 'Second artwork song', artist: 'Test Artist', duration: 120, metadataLoaded: true, thumb: canvas.toDataURL() },
    { path: '/Music/broken-artwork.wav', name: 'Broken artwork song', artist: 'Test Artist', duration: 120, metadataLoaded: true, thumb: 'data:image/png;base64,broken' });
}
if (query.has('filters')) {
  for (const [name, duration] of [['Short sound', 5], ['Boundary song', 10], ['Call RECORDING 2026', 90], ['Recording of CALL', 100], ['Callback song', 120], ['Regular song', 120], ['Unknown duration', 0]] as const) {
    tracks.push({ path: `/Music/${name}.wav`, name, duration, artist: 'Test Singer', album: 'Test Album', metadataLoaded: true });
  }
}
if (query.has('metadata-failure')) tracks.push({ path: '/Music/broken.flac', name: 'Broken file', artist: 'Unknown Artist', duration: 0, metadataLoaded: false });
const store = new Map<string, unknown>();
if (query.has('native-queue')) {
  const queue = createQueue(tracks.slice(0, 3), tracks[0], 'Saved native queue'); queue.position = 41;
  store.set('dmex_mobile_queue_v1', JSON.stringify(queue));
  store.set('app_settings', { lastTrackPath: tracks[2].path, isDarkMode: true });
}
const calls: { command: string; payload: any }[] = [];
(window as any).libraryTest = { tracks, calls, emit, cleanArtistString, buildArtistDictionary, artistCacheKey, sanitizeForLyricsAPI, chooseLyricsMatch, parseLRC, includeLibraryTrack, parseLibraryFilters, MINIMUM_DURATIONS };
(window as any).brandingTest = { BRAND, DEFAULT_AMBIENT_COLORS, getPalette, nudgeVibrancy, trackAccentColor };
mockIPC((command, payload: any) => {
  calls.push({ command, payload });
  if (command === 'audio_status') return { ready: true, settings: DEFAULT_AUDIO, generation: 1, bypassAll: false, ecoMode: true };
  if (command === 'audio_metrics') return { currentTime: 0, duration: 120, audioLevel: 0, bassLevel: 0, midLevel: 0, trebleLevel: 0, limiterGain: 1 };
  if (command === 'fetch_library') {
    if (query.has('library-failure') && calls.filter(call => call.command === command).length === 1) throw new Error('Library temporarily unavailable');
    const library = tracks.map(t => ({ ...t }));
    return query.has('slow-library') ? new Promise(resolve => setTimeout(() => resolve(library), 1200)) : library;
  }
  if (command === 'get_playlists') return testPlaylists.map(p => ({ ...p }));
  if (command === 'save_playlist') { const index = testPlaylists.findIndex(p => p.id === payload.playlist.id); if (index >= 0) testPlaylists[index] = payload.playlist; else testPlaylists.push(payload.playlist); return; }
  if (command === 'delete_playlist') { const index = testPlaylists.findIndex(p => p.id === payload.id); if (index >= 0) testPlaylists.splice(index, 1); return; }
  if (command === 'toggle_favorite') { const track = tracks.find(t => t.path === payload.path); if (track) track.isFavorite = payload.isFavorite; return; }
  if (command === 'update_play_stats') { const track = tracks.find(t => t.path === payload.path); if (track) track.totalSecondsListened = (track.totalSecondsListened || 0) + payload.seconds; return; }
  if (command === 'record_play') { const track = tracks.find(t => t.path === payload.path); if (track) track.playCount = (track.playCount || 0) + 1; return; }
  if (command === 'get_all_artist_images') return { ...artistImages };
  if (command === 'download_artist_art') {
    const key = artistCacheKey(payload.artistName), path = `/artist-art/${key}.jpg`;
    artistImages[key] = path; return path;
  }
  if (command === 'nuke_artist_cache') { Object.keys(artistImages).forEach(key => delete artistImages[key]); return; }
  if (command === 'get_setting') {
    const value = store.get(payload.key) || null;
    if (query.has('native-queue') && payload.key === 'dmex_mobile_queue_v1') return new Promise(resolve => setTimeout(() => resolve(value), 1200));
    return value;
  }
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
    if (query.has('mobile')) { const track = tracks.find(t => t.path === payload.path); return { title: track?.name, artist: track?.artist, album: track?.album, duration: track?.duration || 180 }; }
    if (query.has('metadata-failure')) throw new Error('Test unreadable metadata');
    if (query.has('branding')) {
      const track = tracks.find(track => track.path === payload.path);
      const delay = (window as any).brandingTest.metadataDelay || 0;
      return new Promise(resolve => window.setTimeout(() => resolve({ title: track?.name, artist: track?.artist, duration: 120 }), delay));
    }
    return { title: 'Correct Title', artist: 'Correct Singer', album: 'Correct Album', duration: 120, quality: '16-bit / 44.1 kHz' };
  }
  if (command === 'identify_lyrics_song') return null;
  if (command === 'plugin:store|load') return 1;
  if (command === 'plugin:store|get') return [store.get(payload.key), store.has(payload.key)];
  if (command === 'plugin:store|set') store.set(payload.key, payload.value);
}, { shouldMockEvents: true });
function LyricsFixture() {
  const [saved, setSaved] = useState('');
  return <div style={{ color: 'white', background: '#111', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
    <LyricsSearch track={{ path: 'test.flac', name: 'Wrong title', artist: 'Unknown Artist', album: '', duration: 120 }} onLyrics={async (_, lyrics) => setSaved(lyrics)} />
    <output data-testid="saved-lyrics">{saved}</output>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
let mount = 0;
function render() { const app = <AudioSettingsProvider key={mount++}><App /></AudioSettingsProvider>; root.render(query.has('lyrics') ? <LyricsFixture /> : query.has('strict') ? <React.StrictMode>{app}</React.StrictMode> : app); }
(window as any).libraryTest.remount = render;
render();
