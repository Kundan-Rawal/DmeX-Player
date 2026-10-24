import React, { useEffect, useRef, useState, useMemo,useCallback, useLayoutEffect } from "react";
import { Track, NavView, Taste, CustomPlaylist, IS_ANDROID, IS_MOBILE, LyricLine } from './types/index';
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
// import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { extractTrackMetadata } from './services/metadata';
import { FastAverageColor } from "fast-average-color";
import "./App.css";
// import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlbumGalleryView } from './views/AlbumGalleryView';
import { ArtistGalleryView } from './views/ArtistGalleryView';
import { CloudFetchView } from './views/CloudFetchView';
import { vaultGet, vaultSet, initVault } from './services/vault';
import { splitArtists, artistCacheKey, artistIdentity } from './utils/artistEngine';
import { formatTime, parseLRC } from './utils/formatters';
import { PlaylistGalleryView } from './views/PlaylistGalleryView';
import { PROFILES, classifyAudio, AudioProfile } from './config/audio';
import { isHexDark, getPalette, stripExt } from './utils/helpers';
import { FolderModal, PlaylistPopup, SettingsModal } from './modals/modals';
import { VirtualList, DraggablePlaylistView } from './components/library/TrackLists';
import { TopNav } from './components/layout/TopNav';
import { MiniPlayer } from './components/player/MiniPlayer';
import { AmbientBackground } from './components/player/AmbientBackground';
import { fetchLyricsOnline } from './services/lyricsFetcher';

import { DSPStudio, ExpandedControls } from './components/player/ExpandedPlayerUI';
import { MobileExpandedPlayer } from './components/player/MobileExpandedPlayer';
import { sendAudioCommand } from './services/audioBridge';
import { useAudioSettings, PARAM } from './components/player/AudioSettingsContext';
import { TrackOptions } from './components/player/TrackOptions';
import { LyricsSearch } from './components/player/LyricsSearch';
import { X } from 'lucide-react';
import { DEFAULT_LIBRARY_FILTERS, includeLibraryTrack, LibraryFilters, parseLibraryFilters } from './utils/libraryFilters';
import { BulkScanner } from './components/library/BulkScanner';
// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION — evaluated once at module load, never inside a component.
// IS_ANDROID gates every Android-specific optimisation in this file.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// DEBOUNCE HOOK
// Delays the value update by `delay` ms after the last change.
// Used on the search input so useMemo filtering of 1800+ tracks only runs
// after the user pauses typing — not on every individual keystroke.
// On a 90k AnTuTu Android device, unthrottled filtering blocks the keyboard
// thread for ~150–300ms per character. With 300ms debounce the keyboard
// feels instant and filtering runs once per finished word.
// On desktop (IS_ANDROID=false) delay is set to 0 so there is no difference
// in behaviour from the user's perspective.
// ─────────────────────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}




const fac = new FastAverageColor();


// ─────────────────────────────────────────────────────────────────────────────// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const audio = useAudioSettings();
  // const appWindow = getCurrentWindow();

  const [isPlaying, setIsPlaying]           = useState(false);
  const [isLoading, setIsLoading]           = useState(false);
  const [scanProgress, setScanProgress]     = useState('');
  const [currentTime, setCurrentTime]       = useState(0);
  const [duration, setDuration]             = useState(0);
  const [audioLevel, setAudioLevel]         = useState(0);
  const [playlist, setPlaylist]             = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack]     = useState<Track | null>(null);
  const [favorites, setFavorites]           = useState<string[]>([]);
  const [currentView, setCurrentView]       = useState<NavView>('ALL');
  const scrollPositionsRef                  = useRef<Record<string, number>>({});
  const trackContainerRef                   = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery]       = useState('');
  const [sortMode, setSortMode]             = useState<'TITLE'|'ARTIST'|'ALBUM'|'YEAR'|'DATE_ADDED'>('DATE_ADDED');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  const [isProfileActive, setIsProfileActive] = useState(false);
  const isProfileActiveRef = useRef(false);

  // CHANGE: Raw search query debounced before filtering.
  // debouncedSearchQuery is what useMemo depends on — it only updates 300ms
  // after the user stops typing (0ms on desktop, no change in behaviour).
  const debouncedSearchQuery = useDebounce(searchQuery, IS_ANDROID ? 300 : 0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showFolderModal, setShowFolderModal]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const libraryFiltersRef = useRef(libraryFilters);
  libraryFiltersRef.current = libraryFilters;
  const visiblePlaylist = useMemo(() => playlist.filter(track => includeLibraryTrack(track, libraryFilters)), [playlist, libraryFilters]);
  const playablePlaylistRef = useRef(visiblePlaylist);
  playablePlaylistRef.current = visiblePlaylist;
  const scanRunning = useRef(false);
  const metadataFailures = useRef(new Set<string>());
  const metadataQueuePending = useRef(false);
  useEffect(() => {
    invoke<string | null>('get_setting', { key: 'gemini_api_key' }).then(key => setGeminiApiKey(key || '')).catch(console.error);
    invoke<string | null>('get_setting', { key: 'library_filters' }).then(value => setLibraryFilters(parseLibraryFilters(value))).catch(console.error);
  }, []);
  const [isEnvDropdownOpen, setIsEnvDropdownOpen] = useState(false);
  const [albumArt, setAlbumArt]             = useState<string | null>(null);
  const [trackTitle, setTrackTitle]         = useState('Ready');
  const [trackArtist, setTrackArtist]       = useState('DmeX Player');
  const [themeColor, setThemeColor]         = useState('#c8222a');
  const themeColorRef                       = useRef('#c8222a');
  useEffect(() => { themeColorRef.current = themeColor; }, [themeColor]);
  const [themeText, setThemeText]           = useState('#ffffff');
  const [blobColors, setBlobColors]         = useState(['#c8222a','#8a1520','#6a1018']);
  const [lyrics, setLyrics]                 = useState<LyricLine[]>([]);
  const [isExpanded, setIsExpanded]         = useState(false);
  const isExpandedRef = useRef(false);
  useEffect(() => { isExpandedRef.current = isExpanded; }, [isExpanded]);

  const [, setIsAnimatingUI] = useState(false);
  
  // THE SAMSUNG FIX: Track when the player is transitioning
  useEffect(() => {
    setIsAnimatingUI(true);
    // 350ms covers the CSS opacity fade duration + a 50ms safety buffer
    const t = setTimeout(() => setIsAnimatingUI(false), 350);
    return () => clearTimeout(t);
  }, [isExpanded]);

  
  const [showLyrics, setShowLyrics]         = useState(false);
  const [showStudio, setShowStudio]         = useState(false);
  const [showDSPPage, setShowDSPPage]       = useState(false);
  const [isDarkMode, setIsDarkMode]         = useState(true);
  const [isBooted, setIsBooted]             = useState(false);
  const [volume, setVolume]                 = useState(1.0);
  const volumeRef = useRef(1.0);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  const [isRemastered, setIsRemastered]     = useState(false);
  const [isCompressed, setIsCompressed]     = useState(false);
  const [upscaleDrive, setUpscaleDrive]     = useState(0.0);
  const [widenWidth, setWidenWidth]         = useState(1.0);
  const [spatialExtra, setSpatialExtra]     = useState(0.0);
  const [depthAmount, setDepthAmount]       = useState(0.0);
  const [reverbWet, setReverbWet]           = useState(0.0);
  const [smartTaste, setSmartTaste]         = useState<Taste>('ORIGINAL');
  const [detectedProfile, setDetectedProfile] = useState<AudioProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing]       = useState(false);
  const [bulkScanActive, setBulkScanActive] = useState(false);
  const [bulkScanPaused, setBulkScanPaused] = useState(false);
  const [bulkScanDone, setBulkScanDone]     = useState(0);
  const [bulkScanTotal, setBulkScanTotal]   = useState(0);
  const [isBulkScanOpen, setIsBulkScanOpen] = useState(false);
  const [customPlaylists, setCustomPlaylists] = useState<CustomPlaylist[]>([]);
  const [globalArtistImages, setGlobalArtistImages] = useState<Record<string, string>>({});
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [playlistModalTracks, setPlaylistModalTracks] = useState<string[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isShuffle, setIsShuffle]     = useState(false);
  const [, setShuffledQueue]          = useState<string[]>([]);
  const [repeatMode, setRepeatMode]   = useState<'OFF'|'ALL'|'ONE'>('OFF');
  const [repeatDeg, setRepeatDeg]     = useState(0);
  const [repeatBusy, setRepeatBusy]   = useState(false);
  const [bassLevel, setBassLevel]     = useState(0.25);
  const bassLevelRef                  = useRef(0.25);
  const [trebleLevel, setTrebleLevel] = useState(0.0);
  const trebleLevelRef                = useRef(0.0);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [restorationDenoise, setRestorationDenoise] = useState(0.0);
  const [restorationUpscale, setRestorationUpscale] = useState(0.0);
  const [restorationPresence, setRestorationPresence] = useState(0.0);
  const [selectedAcousticEnv, setSelectedAcousticEnv] = useState('NONE');
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [isFIRMode, setIsFIRMode]     = useState(false);
  const [visMode, setVisMode] = useState<'ORBIT'|'RADAR'>(localStorage.getItem('dmex_visualizer') === 'RADAR' ? 'RADAR' : 'ORBIT');
  useEffect(() => {
    const changed = (event: Event) => setVisMode((event as CustomEvent).detail === 'RADAR' ? 'RADAR' : 'ORBIT');
    window.addEventListener('dmex-visualizer', changed);
    return () => window.removeEventListener('dmex-visualizer', changed);
  }, []);
  const [speakerMode, setSpeakerMode] = useState<'NONE'|'LOW'|'MED'|'HIGH'>('NONE');
  const [is9DStageOn, setIs9DStageOn] = useState(() => {
    return localStorage.getItem('dmex_9d_stage') === 'true';
  });
  const is9DStageOnRef = useRef(is9DStageOn);
  useEffect(() => {
    is9DStageOnRef.current = is9DStageOn;
    localStorage.setItem('dmex_9d_stage', is9DStageOn ? 'true' : 'false');
  }, [is9DStageOn]);

  const [is9DBassRoom, setIs9DBassRoom] = useState(() => {
    return localStorage.getItem('dmex_9d_bass_mode') === 'ROOM';
  });
  const is9DBassRoomRef = useRef(is9DBassRoom);
  useEffect(() => {
    is9DBassRoomRef.current = is9DBassRoom;
    localStorage.setItem('dmex_9d_bass_mode', is9DBassRoom ? 'ROOM' : 'STEREO');
  }, [is9DBassRoom]);

  const [selectedHeadphoneModel, setSelectedHeadphoneModel] = useState(() => {
    return localStorage.getItem('dmex_headphone_model') || 'NONE';
  });
  const selectedHeadphoneModelRef = useRef(selectedHeadphoneModel);
  useEffect(() => {
    selectedHeadphoneModelRef.current = selectedHeadphoneModel;
  }, [selectedHeadphoneModel]);

  const [isPhoneSpeaker, setIsPhoneSpeaker] = useState(false);
  const isPhoneSpeakerRef = useRef(false);
  useEffect(() => { isPhoneSpeakerRef.current = isPhoneSpeaker; }, [isPhoneSpeaker]);

  const smartTasteRef      = useRef<Taste>('ORIGINAL');
  const detectedProfileRef = useRef<AudioProfile | null>(null);
  const loadIdRef          = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playlistRef        = useRef<Track[]>([]);
  const enricherRunning    = useRef(false);
  const bulkScanRunning    = useRef(false);
  const bulkScanPausedRef  = useRef(false);
  const lastCountedTrackRef = useRef<string | null>(null);
  const currentTimeRef     = useRef(0);
  const isShuffleRef       = useRef(false);
  const repeatModeRef      = useRef<'OFF'|'ALL'|'ONE'>('OFF');
  const shuffledQueueRef   = useRef<string[]>([]);
  const playHistoryRef     = useRef<string[]>([]);
  const speakerModeRef     = useRef<'NONE'|'LOW'|'MED'|'HIGH'>('NONE');
  useEffect(() => { speakerModeRef.current = speakerMode; }, [speakerMode]);
  const isDarkModeRef = useRef(isDarkMode);
  useEffect(() => { isDarkModeRef.current = isDarkMode; }, [isDarkMode]);
  const isSeekingRef = useRef(false);
  const durationRef = useRef(0);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Hold-to-seek key trackers
  const rightKeyTimerRef = useRef<any>(null);
  const rightKeyIntervalRef = useRef<any>(null);
  const leftKeyTimerRef = useRef<any>(null);
  const leftKeyIntervalRef = useRef<any>(null);

 
  const spatialData    = useRef({ bLvl:0,bPan:0,mLvl:0,mPan:0,mPhs:1,tLvl:0,tPan:0,tPhs:1 });
  const audioLevelRef  = useRef(0);
  const lastReactUpdate = useRef(0);


  const isTransitioningRef = useRef(false);

  


  // CHANGE: DUST_COUNT fenced per platform.
  // 500 particles at 60fps on Android consumes ~35% of the rAF budget on a
  // 90k AnTuTu device. 80 particles at 30fps uses equivalent GPU/CPU time
  // while freeing the compositor for scroll, touch, and CSS transitions.
  

  
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const path = currentTrack.path;
    let start = performance.now();
    const flush = () => {
      const seconds = Math.floor((performance.now() - start) / 1000);
      if (seconds <= 0) return;
      start += seconds * 1000;
      setPlaylist(prev => prev.map(t => t.path === path ? { ...t, totalSecondsListened: (t.totalSecondsListened || 0) + seconds } : t));
      invoke('update_play_stats', { path, seconds }).catch(console.error);
    };
    const timer = setInterval(flush, 15000);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, [isPlaying, currentTrack?.path]);

  useEffect(() => {
    const handlePopState = () => {
      if (showFolderModal) { setShowFolderModal(false); return; }
      if (isBulkScanOpen) { setIsBulkScanOpen(false); return; }
      if (showDSPPage) { setShowDSPPage(false); return; }
      if (showLyrics||showStudio) { setShowLyrics(false); setShowStudio(false); return; }
      if (isExpanded) { setIsExpanded(false); return; }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isExpanded, showFolderModal, isBulkScanOpen, showDSPPage, showLyrics, showStudio]);

  useEffect(() => {
    if (isExpanded || showFolderModal || isBulkScanOpen) window.history.pushState({ modal:true }, '');
  }, [isExpanded, showFolderModal, isBulkScanOpen]);

  const activePlaylistId = currentView.startsWith('PLAYLIST_') ? currentView.replace('PLAYLIST_', '') : null;
  const activeAlbumName = currentView.startsWith('ALBUM_') ? currentView.replace('ALBUM_', '') : null;
  const activeArtistName = currentView.startsWith('ARTIST_') ? currentView.replace('ARTIST_', '') : null;
  // CHANGE: useMemo depends on debouncedSearchQuery instead of searchQuery.
  // This prevents the 1800-item filter from re-running on every keystroke.
  // Also: favorites.includes() was removed — filtering by favorites now uses
  // the favorites array directly in useMemo (cheap reference check) and the
  // O(1) favoritesSet is used inside VirtualList's TrackRow render below.
  const displayedTracks = useMemo(() => {
    let base = visiblePlaylist;

    // 1. VIEW ROUTING
    if (currentView === 'FAVOURITES') {
      base = visiblePlaylist.filter(t => favorites.includes(t.path));
    } else if (currentView === 'BOLLYWOOD') {
      base = visiblePlaylist.filter(t => {
        const s = `${t.genre||''} ${t.album||''} ${t.path}`.toLowerCase();
        return s.includes('bollywood') || s.includes('hindi') || s.includes('indian');
      });
    } else if (currentView === 'TOPTRACKS') {
      base = [...visiblePlaylist].filter(t=>(t.totalSecondsListened||0)>0).sort((a,b)=>(b.totalSecondsListened||0)-(a.totalSecondsListened||0)).slice(0,50);
    } else if (activePlaylistId) {
      const pl = customPlaylists.find(p=>p.id===activePlaylistId);
      if (pl) base = pl.trackPaths.map(path=>visiblePlaylist.find(t=>t.path===path)).filter((t):t is Track=>t!==undefined);
    } else if (activeAlbumName) {
      base = visiblePlaylist.filter(t => (t.album || 'Unknown Album') === activeAlbumName);
    } else if (activeArtistName) {
      base = visiblePlaylist.filter(t => splitArtists(t.artist || 'Unknown Artist').some(name => artistIdentity(name) === artistIdentity(activeArtistName)));
    }

    // 2. THE SEARCH ENGINE
    if (debouncedSearchQuery && debouncedSearchQuery.trim() !== '') {
      const q = debouncedSearchQuery.toLowerCase();
      base = base.filter(t => String(t?.name||'').toLowerCase().includes(q) || String(t?.artist||'').toLowerCase().includes(q) || String(t?.album||'').toLowerCase().includes(q));
    }

    // 3. THE DYNAMIC SORTER
    if (currentView === 'TOPTRACKS' || activePlaylistId) return base;

    return [...base].sort((a, b) => {
      if (sortMode === 'DATE_ADDED') return (b.dateAdded || 0) - (a.dateAdded || 0);
      if (sortMode === 'TITLE') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sortMode === 'ARTIST') return String(a.artist || 'Unknown').localeCompare(String(b.artist || 'Unknown'));
      if (sortMode === 'ALBUM') return String(a.album || 'Unknown').localeCompare(String(b.album || 'Unknown'));
      if (sortMode === 'YEAR') {
        const yA = parseInt(a.year || '0') || 0;
        const yB = parseInt(b.year || '0') || 0;
        return yB - yA; 
      }
      return 0;
    });
  }, [visiblePlaylist, currentView, favorites, customPlaylists, debouncedSearchQuery, sortMode, activePlaylistId, activeAlbumName, activeArtistName]);


  // CHANGE: favorites → Set<string>, memoized.
  // Passed to VirtualList so TrackRow lookups are O(1) not O(n).
  // The Set is recreated only when the favorites array changes reference.
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = useCallback(sendAudioCommand, []);

  
  const applyHeadphoneCorrection = useCallback((modelId: string) => audio.loadAsset(modelId, true), [audio.loadAsset]);

  // 1.1 SETTINGS PERSISTER
  useEffect(() => {
    if (!isBooted) return;
    const settings = {
        isDarkMode, bassLevel, trebleLevel, speakerMode,
        isRemastered, isCompressed, upscaleDrive, widenWidth,
        spatialExtra, depthAmount, reverbWet, restorationDenoise, restorationUpscale,
        restorationPresence, selectedAcousticEnv, selectedHeadphoneModel, smartTaste,
        isManualOverride, visMode, sortMode, volume, isPhoneSpeaker,
        lastTrackPath: currentTrack?.path || null
    };
    vaultSet('app_settings', settings).catch(()=>{});
  }, [
    isBooted, isDarkMode, bassLevel, trebleLevel, speakerMode,
    isRemastered, isCompressed, upscaleDrive, widenWidth,
    spatialExtra, depthAmount, reverbWet, restorationDenoise, restorationUpscale,
    restorationPresence, selectedAcousticEnv, selectedHeadphoneModel, smartTaste,
    isManualOverride, visMode, sortMode, volume, isPhoneSpeaker,
    currentTrack
  ]);


  // 1. THE BOOT SEQUENCE
  useEffect(() => {
    async function boot() {
      setIsLoading(true);
      setScanProgress('Waking up database...');
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        const saved = await invoke<Track[]>('fetch_library');
        if (saved && saved.length > 0) {
          // No more wiping. Load the tracks and their micro-JPEGs exactly as they are in the DB.
          playlistRef.current = saved;
          setPlaylist(saved);
          setFavorites(saved.filter(t => t.isFavorite).map(t => t.path));
        }
      } catch (err) { console.error("CRITICAL: SQLite fetch_library failed", err); }

      try {
        const savedPlaylists = await invoke<CustomPlaylist[]>('get_playlists');
        if (savedPlaylists) setCustomPlaylists(savedPlaylists);
      } catch (err) { console.error("CRITICAL: SQLite get_playlists failed", err); }

      try {
        await initVault();
        const settings = await vaultGet<any>('app_settings');
        if (settings) {
          if (settings.isDarkMode !== undefined) setIsDarkMode(settings.isDarkMode);
          if (settings.bassLevel !== undefined) { setBassLevel(settings.bassLevel); bassLevelRef.current = settings.bassLevel; }
          if (settings.trebleLevel !== undefined) { setTrebleLevel(settings.trebleLevel); trebleLevelRef.current = settings.trebleLevel; }
          if (settings.speakerMode !== undefined) { setSpeakerMode(settings.speakerMode); speakerModeRef.current = settings.speakerMode; }
          
          if (settings.isRemastered !== undefined) setIsRemastered(settings.isRemastered);
          if (settings.isCompressed !== undefined) setIsCompressed(settings.isCompressed);
          if (settings.upscaleDrive !== undefined) setUpscaleDrive(settings.upscaleDrive);
          if (settings.widenWidth !== undefined) setWidenWidth(settings.widenWidth);
          if (settings.spatialExtra !== undefined) setSpatialExtra(settings.spatialExtra);
          if (settings.depthAmount !== undefined) setDepthAmount(settings.depthAmount);
          if (settings.reverbWet !== undefined) setReverbWet(settings.reverbWet);
          
          if (settings.restorationDenoise !== undefined) setRestorationDenoise(settings.restorationDenoise);
          if (settings.restorationUpscale !== undefined) setRestorationUpscale(settings.restorationUpscale);
          if (settings.restorationPresence !== undefined) setRestorationPresence(settings.restorationPresence);
          
          if (settings.selectedAcousticEnv !== undefined) setSelectedAcousticEnv(settings.selectedAcousticEnv);
          if (settings.selectedHeadphoneModel !== undefined) {
              setSelectedHeadphoneModel(settings.selectedHeadphoneModel);
              selectedHeadphoneModelRef.current = settings.selectedHeadphoneModel;
          }
          if (settings.smartTaste !== undefined) { setSmartTaste(settings.smartTaste); smartTasteRef.current = settings.smartTaste; }
          if (settings.isManualOverride !== undefined) setIsManualOverride(settings.isManualOverride);
          if (!localStorage.getItem('dmex_visualizer') && settings.visMode !== undefined) {
            setVisMode(settings.visMode); localStorage.setItem('dmex_visualizer', settings.visMode);
            window.dispatchEvent(new CustomEvent('dmex-visualizer', { detail: settings.visMode }));
          }
          if (settings.sortMode !== undefined) setSortMode(settings.sortMode);
          if (settings.volume !== undefined) { setVolume(settings.volume); volumeRef.current = settings.volume; }
          if (settings.isPhoneSpeaker !== undefined) { setIsPhoneSpeaker(settings.isPhoneSpeaker); isPhoneSpeakerRef.current = settings.isPhoneSpeaker; }

          if (settings.lastTrackPath) {
             // We use a timeout to ensure playlist is fully loaded into state
             setTimeout(async () => {
                 const currentPl = playlistRef.current;
                 const track = currentPl.find((t: any) => t.path === settings.lastTrackPath);
                 if (track && includeLibraryTrack(track, libraryFiltersRef.current)) {
                     setCurrentTrack(track);
                     setDuration(track.duration || 0);
                     setTrackTitle(track.name);
                     setTrackArtist(track.artist);
                     setLyrics(track.lyrics?.length ? track.lyrics : []);
                     setAlbumArt(track.thumb || null);
                     const storedLyrics = await vaultGet<string>(`lrc_${track.path}`);
                     if (storedLyrics) setLyrics(parseLRC(storedLyrics));
                     if (track.profile) {
                         const p = PROFILES.find((pr: any) => pr.id === track.profile);
                         if (p) setDetectedProfile(p);
                     }
                     try {
                         await writeToEngine(`LOAD ${track.path}`);
                     } catch (_) {}
                 }
             }, 500);
          }
        } else {
            // Fallback for older single-key saved settings
            const savedDark = await vaultGet<boolean>("isDarkMode");
            if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
        }
      } catch (err) {}
      
      setIsBooted(true); 

      setIsLoading(false);
      setScanProgress('');
    }
    boot();
  }, []); // Run exactly once on mount
  useLayoutEffect(() => {
    if (trackContainerRef.current) {
      trackContainerRef.current.scrollTop = scrollPositionsRef.current[currentView] || 0;
    }
  }, [currentView]);

  useEffect(() => {
    const pushTime = Date.now();
    // 1. When we dive into an Album, Playlist, Artist, or Favourites, forcefully inject a fake history state.
    // This physically stops Android from exiting the app when you swipe back.
    if (currentView.startsWith('ALBUM_') || currentView.startsWith('PLAYLIST_') || currentView.startsWith('ARTIST_') || currentView === 'FAVOURITES' || currentView === 'TOPTRACKS') {
      window.history.pushState({ fakePage: true }, '');
    }

    // 2. When the OS consumes that fake state (Hardware swipe-back)
    const handleAndroidBackSwipe = () => {
      // Prevent spontaneous popstate fired immediately after pushState (common Android WebView bug)
      if (Date.now() - pushTime < 500) return;

      if (currentView.startsWith('ALBUM_')) {
        setCurrentView('ALBUMS');
      } else if (currentView.startsWith('PLAYLIST_')) {
        setCurrentView('PLAYLIST_GALLERY');
      } else if (currentView.startsWith('ARTIST_')) {
        setCurrentView('ARTIST');
      } else if (currentView === 'FAVOURITES' || currentView === 'TOPTRACKS') {
        setCurrentView('PLAYLIST_GALLERY');
      }
    };

    window.addEventListener('popstate', handleAndroidBackSwipe);
    return () => window.removeEventListener('popstate', handleAndroidBackSwipe);
  }, [currentView]);


  const handleNext = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    const library = playablePlaylistRef.current;
    if (!library.length||!track) return;
    if (repeatModeRef.current==='ONE' && includeLibraryTrack(track, libraryFiltersRef.current)) { playTrack(track); return; }
    playHistoryRef.current.push(track.path);
    if (isShuffleRef.current&&shuffledQueueRef.current.length>0) {
      const available = new Set(library.map(t => t.path));
      const q=shuffledQueueRef.current.filter(path => available.has(path)),idx=q.indexOf(track.path);
      if (!q.length) return;
      let nextPath=q[0];
      if(idx!==-1&&idx+1<q.length) nextPath=q[idx+1];
      else if(repeatModeRef.current!=='ALL'&&idx+1>=q.length) return;
      const nextTrack=library.find(t=>t.path===nextPath);
      if(nextTrack) playTrack(nextTrack);
      return;
    }
    let activeQueue=list,i=activeQueue.findIndex(t=>t.path===track.path);
    if(i===-1){activeQueue=library;i=activeQueue.findIndex(t=>t.path===track.path);}
    if(i+1>=activeQueue.length){if(repeatModeRef.current==='ALL') playTrack(activeQueue[0]);}
    else playTrack(activeQueue[i+1]);
  }, []);

  useEffect(() => {
    let active = true;
    let timeoutId: any = null;

    const pollMetrics = async () => {
      if (!active) return;
      if (!isPlaying || isLoading) {
        timeoutId = setTimeout(pollMetrics, 100);
        return;
      }

      try {
        const m: { currentTime:number; duration:number; bassLevel:number; bassPan:number; midLevel:number; midPan:number; midPhase:number; trebleLevel:number; treblePan:number; treblePhase:number; audioLevel:number; limiterGain:number; finished:boolean; pausedByDevice:boolean } = await invoke('audio_metrics');
        if (m.pausedByDevice) { audioLevelRef.current=0; setAudioLevel(0); setIsPlaying(false); return; }
        const lvl = Math.min(1, (m.audioLevel || 0) * 3.5);
        audioLevelRef.current = lvl;
        spatialData.current = { bLvl:m.bassLevel,bPan:m.bassPan,mLvl:m.midLevel,mPan:m.midPan,mPhs:m.midPhase,tLvl:m.trebleLevel,tPan:m.treblePan,tPhs:m.treblePhase };
        
        const now = Date.now();
        if (now - lastReactUpdate.current > 250) {
          if (!isSeekingRef.current) setCurrentTime(m.currentTime);
          if (m.duration > 0) setDuration(m.duration);
          setAudioLevel(lvl);
          lastReactUpdate.current = now;
        }

        if (m.finished) {
          setIsPlaying(false);
          if (!isTransitioningRef.current) {
            isTransitioningRef.current = true;
            const currentPath = stateRefs.current.currentTrack?.path;
            if (currentPath && lastCountedTrackRef.current !== currentPath) {
              lastCountedTrackRef.current = currentPath;
              invoke('record_play', { path: currentPath }).catch(console.error);
              setPlaylist(prev => prev.map(t => t.path === currentPath ? { ...t, playCount: (t.playCount || 0) + 1 } : t));
            }
            handleNext();
            setTimeout(() => { isTransitioningRef.current = false; }, 1500);
          }
        }
      } catch (_) {}

      // CRITICAL FIX: Only queue the next frame AFTER the current one is completely finished
      if (active) timeoutId = setTimeout(pollMetrics, 32); 
    };

    pollMetrics();

    return () => { 
      active = false; 
      if (timeoutId) clearTimeout(timeoutId); 
    };
  }, [isPlaying, isLoading, handleNext]);



  useEffect(() => {
    if (!audio.status?.ready) return;
    const v=audio.values;
    setBassLevel(v[PARAM.bass]); bassLevelRef.current=v[PARAM.bass];
    setTrebleLevel(v[PARAM.treble]); trebleLevelRef.current=v[PARAM.treble];
    setUpscaleDrive(v[PARAM.exciter]); setWidenWidth(v[PARAM.width]);
    setSpatialExtra(v[PARAM.separation]); setDepthAmount(v[PARAM.depth]); setReverbWet(v[PARAM.reverb]);
    setIsCompressed(v[PARAM.compressor]>0.5); setVolume(v[PARAM.volume]); volumeRef.current=v[PARAM.volume];
    setRestorationUpscale(v[PARAM.air]); setRestorationPresence(v[PARAM.vocal]);
    setIs9DStageOn(v[PARAM.spatial]>0.5); setIs9DBassRoom(v[PARAM.roomBass]>0.5);
    setIsPhoneSpeaker(v[PARAM.device]===2);
  }, [audio.status?.ready, audio.values]);
  useEffect(() => {
    setSelectedHeadphoneModel(audio.headphone);
    setSelectedAcousticEnv(audio.environment);
  }, [audio.headphone, audio.environment]);

  const activeLyricIndex = lyrics.findIndex((lyric,i)=>{ const next=lyrics[i+1]; return currentTime>=lyric.time&&(!next||currentTime<next.time); });
  
  useEffect(() => {
    // CRITICAL FIX: Only run scrollIntoView if the player is physically expanded.
    if(isExpanded && showLyrics && lyricsContainerRef.current && activeLyricIndex !== -1){
      const el = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      el?.scrollIntoView({behavior:'smooth',block:'center'});
    }
  }, [activeLyricIndex, showLyrics, isExpanded]);

  const toggleTheme = async () => {
    const next=!isDarkMode; setIsDarkMode(next);
    await vaultSet("isDarkMode", next);
  };

  const applySmartSettings = async (_profile:AudioProfile | null, taste:Taste) => {
    if (audio.status?.bypassAll) return;
    const neutral = { bass:0, treble:0, exciter:0, width:1, separation:0, depth:0,
      reverb:0, compressor:0, bassField:0, roomBass:0, vocal:0, air:0, spatial:0, boost:0 };
    const selected = taste === 'QUALITY' ? { ...neutral, bass:0.25, vocal:0.12 }
      : taste === 'IMMERSIVE' ? { ...neutral, bass:0.35, spatial:1, separation:0.55, depth:0.4, reverb:0.08 }
      : taste === 'CHILL' ? { ...neutral, bass:0.15, treble:-1, reverb:0.12 } : neutral;
    await audio.update(selected);
    setIsFIRMode(false);
  };

  const handleTasteChange = async (taste:Taste) => {
    if (audio.status?.bypassAll) return;
    const newTaste=(smartTaste===taste)?'ORIGINAL':taste;
    setSmartTaste(newTaste);smartTasteRef.current=newTaste;
    setIsManualOverride(false);
    await applySmartSettings(detectedProfileRef.current,newTaste);
  };

  const handleToggleShuffle = useCallback((e?:React.MouseEvent) => {
    if(e) e.stopPropagation();
    const next=!isShuffle; setIsShuffle(next);
    if(next){
      const {displayedTracks:list,currentTrack:track}=stateRefs.current;
      let activeQueue=list;
      if(track&&activeQueue.findIndex(t=>t.path===track.path)===-1) activeQueue=playablePlaylistRef.current;
      let paths=activeQueue.map(t=>t.path);
      for(let i=paths.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[paths[i],paths[j]]=[paths[j],paths[i]];}
      if(track && includeLibraryTrack(track, libraryFiltersRef.current)){paths=paths.filter(p=>p!==track.path);paths.unshift(track.path);}
      setShuffledQueue(paths);shuffledQueueRef.current=paths;
    } else {setShuffledQueue([]);shuffledQueueRef.current=[];}
  }, [isShuffle]);

  const handleToggleRepeat = useCallback((e?:React.MouseEvent) => {
    if(e) e.stopPropagation();
    if(repeatBusy) return;
    setRepeatBusy(true);setRepeatDeg(d=>d+360);
    setTimeout(()=>{setRepeatMode(prev=>{const next=prev==='OFF'?'ALL':prev==='ALL'?'ONE':'OFF';repeatModeRef.current=next;return next;});setRepeatBusy(false);},390);
  }, [repeatBusy]);

  const handlePrev = useCallback(() => {
    const {displayedTracks:list,currentTrack:track}=stateRefs.current;
    const library = playablePlaylistRef.current;
    if(!library.length||!track) return;
    while(playHistoryRef.current.length>0){const prevPath=playHistoryRef.current.pop();const prevTrack=library.find(t=>t.path===prevPath);if(prevTrack){playTrack(prevTrack);return;}}
    let activeQueue=list,i=activeQueue.findIndex(t=>t.path===track.path);
    if(i===-1){activeQueue=library;i=activeQueue.findIndex(t=>t.path===track.path);}
    playTrack(activeQueue[(i-1)<0?activeQueue.length-1:i-1]);
  }, []);

  const handleSeekDrag  = (e:React.ChangeEvent<HTMLInputElement>) => setCurrentTime(parseFloat(e.target.value));
  const handleSeekCommit = async (e:React.MouseEvent|React.TouchEvent) => { await writeToEngine(`SEEK ${parseFloat((e.target as HTMLInputElement).value)}`); isSeekingRef.current=false; };

  const toggleFavorite = async (e:React.MouseEvent) => {
    e.stopPropagation(); if(!currentTrack) return;
    const isAdding=!favorites.includes(currentTrack.path);
    setFavorites(isAdding?[...favorites,currentTrack.path]:favorites.filter(p=>p!==currentTrack.path));
    setPlaylist(prev=>prev.map(t=>t.path===currentTrack.path?{...t,isFavorite:isAdding}:t));
    try { await invoke('toggle_favorite',{path:currentTrack.path,isFavorite:isAdding}); } catch(_){}
  };

  useEffect(() => {
    invoke<Record<string, string>>('get_all_artist_images')
      .then(res => setGlobalArtistImages(res))
      .catch(console.error);
  }, [currentView]);

  const scanAndAdd = async (folderPath: string) => {
    if (scanRunning.current) return;
    scanRunning.current = true;
    setIsLoading(true);
    setScanProgress('Scanning...');
    try {
      if (folderPath === 'CUSTOM') {
        const selected = IS_ANDROID
          ? await invoke<string | null>('pick_music_folder')
          : await open({ directory: true, multiple: false });
        if (!selected || typeof selected !== 'string') { setScanProgress(''); return; }
        folderPath = selected;
      }
      const discovered: Track[] = IS_ANDROID
        ? (await invoke<Array<{ file_path: string; title: string; artist: string; album: string; duration: number }>>('scan_android_music', { folderPath }))
            .map(t => ({ path: t.file_path, name: t.title, artist: t.artist, album: t.album, duration: t.duration, metadataLoaded: false }))
        : (await invoke<string[]>('scan_directory', { path: folderPath })).map(path => ({
            path, name: stripExt(path.split(/[/\\\\]/).pop() || 'Unknown Title'),
            artist: 'Unknown Artist', album: 'Unknown Album', duration: 0, metadataLoaded: false
          }));
      const known = new Set(playlistRef.current.map(t => t.path));
      const fresh = discovered.filter(t => { if (known.has(t.path)) return false; known.add(t.path); return true; });
      // Persist before publishing tracks, so enrichment cannot race a raw insert.
      for (let offset = 0; offset < fresh.length; offset += 100) {
        await invoke('add_library_tracks', { tracks: fresh.slice(offset, offset + 100) });
        setScanProgress(`Adding tracks... ${Math.min(offset + 100, fresh.length)} / ${fresh.length}`);
      }
      const importedPaths = new Set(fresh.map(t => t.path));
      const persisted = fresh.length ? await invoke<Track[]>('fetch_library') : [];
      const merged = [...playlistRef.current, ...persisted.filter(t => importedPaths.has(t.path))].sort((a, b) => a.name.localeCompare(b.name));
      playlistRef.current = merged;
      setPlaylist(merged);
      metadataFailures.current.clear();
      setScanProgress(fresh.length ? `Found ${fresh.length} new tracks. Loading metadata...` : 'No new tracks found.');
      await enrichMetadataInBackground(merged);
    } catch (error) {
      console.error('Music scan failed:', error);
      setScanProgress(String(error));
    } finally {
      scanRunning.current = false;
      setIsLoading(false);
    }
  };

  const handleAddFolder = () => {
    if (!isBooted || isLoading) return;
    if(IS_MOBILE) setShowFolderModal(true);
    else open({directory:true,multiple:false}).then(sel=>{if(sel&&typeof sel==='string') scanAndAdd(sel);});
  };
  // ====================================================================
  // THE NUCLEAR OPTION: Wipe the entire library
  // ====================================================================
  const handleClearLibrary = async () => {
    if (scanRunning.current || enricherRunning.current) {
      setScanProgress('Please wait for scanning and metadata loading to finish.');
      return;
    }
    if (!confirm("WARNING: Are you absolutely sure you want to wipe your entire library? This will delete all tracks, custom playlists, and play history. This cannot be undone.")) return;
    
    setIsLoading(true);
    setScanProgress('Annihilating database...');
    
    try {
      // Tell the Rust backend to drop the database tables
      // NOTE: You must ensure you have a 'clear_library' command in your Rust backend!
      await invoke('clear_library'); 
    } catch (e) {
      console.error('Library could not be cleared:', e);
      setIsLoading(false);
      setScanProgress('The library could not be cleared. Nothing was removed from this view.');
      return;
    }
    
    // 1. Halt the music engine
    if (isPlaying) {
      try { await writeToEngine('PAUSE'); } catch (_) {}
      setIsPlaying(false);
    }
    
    // 2. Nuke the React State
    setPlaylist([]);
    playlistRef.current = [];
    setFavorites([]);
    setCustomPlaylists([]);
    setCurrentTrack(null);
    setAlbumArt(null);
    setLyrics([]);
    
    // 3. Nuke the Persistent Vault
    await vaultSet("user_playlist", []);
    await vaultSet("user_playlists", []);
    
    setIsLoading(false);
    setScanProgress('');
  };

  const enrichMetadataInBackground = useCallback(async (tracks: Track[]) => {
    if (enricherRunning.current) { metadataQueuePending.current = true; return; }
    enricherRunning.current = true;
    let failed = 0;
    let completed = 0;
    try {
      do {
        metadataQueuePending.current = false;
        const pending = tracks.filter(t => !t.metadataLoaded && !metadataFailures.current.has(t.path));
        for (const track of pending) {
          try {
            const native = await extractTrackMetadata(track);
            let localLyrics = track.lyrics || [];
            try {
              const stored = await vaultGet<string>(`lrc_${track.path}`);
              const text = stored || (!track.path.startsWith('content://') ? await readTextFile(track.path.slice(0, track.path.lastIndexOf('.')) + '.lrc') : null);
              if (text) localLyrics = parseLRC(text);
            } catch {}
            const current = playlistRef.current.find(t => t.path === track.path);
            if (!current) continue;
            const updated = { ...current, ...native, lyrics: localLyrics };
            await invoke('add_to_library', { track: updated });
            playlistRef.current = playlistRef.current.map(t => t.path === track.path ? updated : t);
            setPlaylist(prev => prev.map(t => t.path === track.path ? { ...t, ...native, lyrics: localLyrics } : t));
          } catch (error) {
            failed++;
            metadataFailures.current.add(track.path);
            console.error('Metadata unavailable:', track.path, error);
          }
          completed++;
          if (completed % 5 === 0) setScanProgress(`Loading metadata... ${completed} tracks`);
          await new Promise(resolve => setTimeout(resolve, 15));
        }
        tracks = playlistRef.current;
      } while (metadataQueuePending.current);
    } finally {
      enricherRunning.current = false;
      setScanProgress(failed ? `Metadata unavailable for ${failed} tracks. Scan again to retry.` : '');
    }
  }, []);

  useEffect(() => {
    if (!playlist.some(t => !t.metadataLoaded && !metadataFailures.current.has(t.path))) return;
    const timer = setTimeout(() => enrichMetadataInBackground(playlistRef.current), 300);
    return () => clearTimeout(timer);
  }, [playlist.length, enrichMetadataInBackground]);

  const startBulkCategoryScan = useCallback(async () => {
    if(bulkScanRunning.current) return;
    const unscanned=playlistRef.current.filter(t=>!t.profile);
    if(!unscanned.length){setBulkScanActive(false);return;}
    bulkScanRunning.current=true;bulkScanPausedRef.current=false;
    setBulkScanActive(true);setBulkScanPaused(false);setBulkScanDone(0);setBulkScanTotal(unscanned.length);
    let done=0;let pendingSave:{path:string;profile:string}[]=[];
    for(const track of unscanned){
      while(bulkScanPausedRef.current&&bulkScanRunning.current) await new Promise(r=>setTimeout(r,200));
      if(!bulkScanRunning.current) break;
      try{
        const fpLine:string=await invoke('analyze_audio_file', { path: track.path });
        if(fpLine.startsWith("FINGERPRINT ")){
          const p=fpLine.split(' ');
          const prof=classifyAudio(parseFloat(p[1])||0,parseFloat(p[2])||10,parseFloat(p[3])||0.1,parseFloat(p[4])||0.1);
          setPlaylist(prev=>prev.map(t=>t.path===track.path?{...t,profile:prof.id}:t));
          pendingSave.push({path:track.path,profile:prof.id});
        }
      }catch(_){}
      setBulkScanDone(++done);
      if(pendingSave.length>=20){for(const s of pendingSave) invoke('update_profile',{path:s.path,profile:s.profile}).catch(()=>{});pendingSave=[];}
    }
    for(const s of pendingSave) invoke('update_profile',{path:s.path,profile:s.profile}).catch(()=>{});
    bulkScanRunning.current=false;setBulkScanActive(false);setBulkScanPaused(false);
  }, []);

  const pauseBulkScan  = useCallback(()=>{bulkScanPausedRef.current=true;setBulkScanPaused(true);},[]);
  const resumeBulkScan = useCallback(()=>{bulkScanPausedRef.current=false;setBulkScanPaused(false);},[]);
  const stopBulkScan   = useCallback(()=>{bulkScanRunning.current=false;bulkScanPausedRef.current=false;setBulkScanActive(false);setBulkScanPaused(false);},[]);

  const playTrack = async (track:Track) => {
    if (!track || !includeLibraryTrack(track, libraryFiltersRef.current)) return;
    const id=++loadIdRef.current;
    try { await writeToEngine('STOP'); } catch (_) {}
    if (id!==loadIdRef.current) return;
    currentTimeRef.current=0;lastCountedTrackRef.current=null;setDuration(track.duration || 0);
    setCurrentTrack(track);setIsPlaying(false);setCurrentTime(0);setTrackTitle(track.name);setTrackArtist(track.artist);
    setDetectedProfile(null);detectedProfileRef.current=null;setLyrics(track.lyrics?.length?track.lyrics:[]);
    setAlbumArt(prev=>{if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev);return track.thumb || null;});
    try{
      if(id!==loadIdRef.current) return;
      await writeToEngine(`LOAD ${track.path}`);
      if(id!==loadIdRef.current) return;
      await writeToEngine('PLAY');setIsPlaying(true);

      setTimeout(async()=>{
        if(id!==loadIdRef.current) return;
        try{
          const native = await extractTrackMetadata(track);
          if (id !== loadIdRef.current) return;
          const title = native.name;
          const artist = native.artist;
          setTrackTitle(title); setTrackArtist(artist);
          if (native.duration && native.duration > 0) setDuration(native.duration);
          if (native.thumb) {
            let image = native.thumb;
            if (native.artPath) {
              try {
                const bytes = await readFile(native.artPath);
                const type = native.artPath.endsWith('.png') ? 'image/png' : native.artPath.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
                image = URL.createObjectURL(new Blob([bytes], { type }));
              } catch {}
            }
            if (id !== loadIdRef.current) { if (image.startsWith('blob:')) URL.revokeObjectURL(image); return; }
            setAlbumArt(image);
            try {
              const color = await fac.getColorAsync(image, { algorithm: 'dominant' });
              if (id === loadIdRef.current && !color.error) {
                setThemeColor(color.hex); setThemeText(isHexDark(color.hex) ? '#ffffff' : '#111111');
                const palette = await getPalette(image);
                if (id === loadIdRef.current) setBlobColors(palette);
              }
            } catch {}
          }


          // 2. SHARED LOGIC: LRC Loader and DB Sync (Uses elevated title/artist)
          try {
            let lrcText = null;
            lrcText = await vaultGet(`lrc_${track.path}`);
            if (!lrcText && !track.path.startsWith('content://')) {
              const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
              lrcText = await readTextFile(lrcPath);
            }
            if (id === loadIdRef.current && lrcText && typeof lrcText === 'string') {
               setLyrics(parseLRC(lrcText));
            }
          } catch (_) {}
          
          if (id !== loadIdRef.current) return;
          const current = playlistRef.current.find(t => t.path === track.path) || track;
          const updated = { ...current, ...native };
          playlistRef.current = playlistRef.current.map(t => t.path === track.path ? updated : t);
          setPlaylist(prev => prev.map(t => t.path === track.path ? { ...t, ...native } : t));
          await invoke('add_to_library', { track: updated });
        } catch(err) {
            console.error(`GLOBAL METADATA CRASH:`, err);
        }
      },300);

      const cachedProfile=track.profile?PROFILES.find(p=>p.id===track.profile):null;
      if(cachedProfile){setDetectedProfile(cachedProfile);detectedProfileRef.current=cachedProfile;}
      else{setTimeout(async()=>{
        if(id!==loadIdRef.current) return;setIsAnalyzing(true);
        try{
          const fpLine:string=await invoke('analyze_current_track');if(id!==loadIdRef.current) return;
          if(fpLine.startsWith("FINGERPRINT ")){
            const parts=fpLine.split(' ');
            const profile=classifyAudio(parseFloat(parts[1])||0,parseFloat(parts[2])||10,parseFloat(parts[3])||0.1,parseFloat(parts[4])||0.1);
            setDetectedProfile(profile);detectedProfileRef.current=profile;
            const nl=playlistRef.current.map(t=>t.path===track.path?{...t,profile:profile.id}:t);setPlaylist(nl);
            await invoke('update_profile', { path: track.path, profile: profile.id });
            vaultSet("user_playlist", nl);          }
        }catch(_){}finally{setIsAnalyzing(false);}
      },2000);}
    }catch(error){if(id===loadIdRef.current) setIsPlaying(false); console.error('Track playback failed:', error);}
  };

  const finalizeLyrics = async (track: Track, lrc: string) => {
    const parsed = parseLRC(lrc);
    if (!parsed.length) throw new Error('No valid synced lyrics received');
    if (stateRefs.current.currentTrack?.path === track.path) setLyrics(parsed);
    setPlaylist(prev => prev.map(t => t.path === track.path ? { ...t, lyrics: parsed } : t));

    try {
      await vaultSet(`lrc_${track.path}`, lrc);
      if (IS_ANDROID || track.path.startsWith('content://')) {
        console.log(`%c[Persistence] Lyrics vaulted for: ${track.name}`, "color: #ffeb3b;");
      }else {
        // DESKTOP: Create the physical .lrc sidecar file
        const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
        await writeTextFile(lrcPath, lrc); 
        console.log(`%c[Persistence] Lyrics saved to disk: ${lrcPath}`, "color: #ffeb3b;");
      }
      setScanProgress('Lyrics saved permanently.');
    } catch (e) {
      console.error("[Persistence] Failed to save lyrics", e);
    }

    setTimeout(() => setScanProgress(''), 3000);
  };

  
  const createPlaylist = async (name: string) => {
    const newPl: CustomPlaylist = { id: Date.now().toString(), name, trackPaths: [] };
    await invoke('save_playlist', { playlist: newPl });
    const updated = [...customPlaylists, newPl];
    setCustomPlaylists(updated);
    await vaultSet("user_playlists", updated);
  };

  const deletePlaylist = async (id: string) => {
    if (!confirm("Delete this playlist?")) return;
    await invoke('delete_playlist', { id });
    const updated = customPlaylists.filter(pl => pl.id !== id);
    setCustomPlaylists(updated);
    await vaultSet("user_playlists", updated);
    // If they delete the playlist they are currently looking at, kick them back to the gallery
    if (currentView === `PLAYLIST_${id}`) setCurrentView('PLAYLIST_GALLERY');
  };


  const addToPlaylist = async (playlistId:string) => {
    const updated=customPlaylists.map(pl=>pl.id===playlistId?{...pl,trackPaths:[...pl.trackPaths,...playlistModalTracks.filter(p=>!pl.trackPaths.includes(p))]}:pl);
    const target = updated.find(p => p.id === playlistId);
    if (target) await invoke('save_playlist', { playlist: target });
    setCustomPlaylists(updated);setPlaylistModalTracks([]);setIsSelectionMode(false);setSelectedTracks(new Set());
    await vaultSet("user_playlists", updated);
  };
  const removeFromPlaylist = async (playlistId:string,pathsToRemove:string[]) => {
    const updated=customPlaylists.map(pl=>pl.id===playlistId?{...pl,trackPaths:pl.trackPaths.filter(p=>!pathsToRemove.includes(p))}:pl);
    setCustomPlaylists(updated);setIsSelectionMode(false);setSelectedTracks(new Set());
    const pl=updated.find(p=>p.id===playlistId);if(pl) invoke('save_playlist',{playlist:pl}).catch(console.error);
  };
  const reorderPlaylist = useCallback(async (playlistId:string,fromTrack:Track,toTrack:Track) => {
    setCustomPlaylists(prev=>{
      const pl=prev.find(p=>p.id===playlistId);if(!pl) return prev;
      const fromIdx=pl.trackPaths.indexOf(fromTrack.path),toIdx=pl.trackPaths.indexOf(toTrack.path);
      if(fromIdx===-1||toIdx===-1||fromIdx===toIdx) return prev;
      const newPaths=[...pl.trackPaths];const [moved]=newPaths.splice(fromIdx,1);newPaths.splice(toIdx,0,moved);
      const updated=prev.map(p=>p.id===playlistId?{...p,trackPaths:newPaths}:p);
      const plToSave=updated.find(p=>p.id===playlistId);if(plToSave) invoke('save_playlist',{playlist:plToSave}).catch(console.error);
      return updated;
    });
  }, []);
  const handlePlayPause = async () => {
    try{if(isPlaying){await writeToEngine('PAUSE');setIsPlaying(false);}else{await writeToEngine('PLAY_USER');setIsPlaying(true);}}catch(_){}
  };
  const isCurrentFavorite = currentTrack?favorites.includes(currentTrack.path):false;

  const renderMobileDSPPage = () => (
    <div className="mobile-dsp-page fade-in">
      <div className="mobile-dsp-header">
        <button className="mobile-dsp-back" onClick={()=>setShowDSPPage(false)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <h1 className="mobile-dsp-title">Sound Quality & Effects</h1>
      </div>
      <div className="mobile-dsp-body">
        <DSPStudio 
          isRemastered={isRemastered} setIsRemastered={setIsRemastered}
          isCompressed={isCompressed} setIsCompressed={setIsCompressed}
          selectedAcousticEnv={selectedAcousticEnv} setSelectedAcousticEnv={setSelectedAcousticEnv}
          isEnvDropdownOpen={isEnvDropdownOpen} setIsEnvDropdownOpen={setIsEnvDropdownOpen}
          upscaleDrive={upscaleDrive} setUpscaleDrive={setUpscaleDrive}
          widenWidth={widenWidth} setWidenWidth={setWidenWidth}
          spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra} depthAmount={depthAmount} setDepthAmount={setDepthAmount}
          reverbWet={reverbWet} setReverbWet={setReverbWet}
          restorationDenoise={restorationDenoise} setRestorationDenoise={setRestorationDenoise}
          restorationUpscale={restorationUpscale} setRestorationUpscale={setRestorationUpscale}
          restorationPresence={restorationPresence} setRestorationPresence={setRestorationPresence}
          setIsManualOverride={setIsManualOverride} setSmartTaste={setSmartTaste}
          setBassLevel={setBassLevel} setTrebleLevel={setTrebleLevel} writeToEngine={writeToEngine}
            is9DStageOn={is9DStageOn} setIs9DStageOn={setIs9DStageOn}
            is9DBassRoom={is9DBassRoom} setIs9DBassRoom={setIs9DBassRoom}
            selectedHeadphoneModel={selectedHeadphoneModel}
            setSelectedHeadphoneModel={setSelectedHeadphoneModel}
            onHeadphoneModelSelect={applyHeadphoneCorrection}
        />
      </div>
    </div>
  );




  const isRightPaneActive = showLyrics||showStudio;
  const toggleSelect = useCallback((path:string) => {
    setSelectedTracks(prev=>{const next=new Set(prev);next.has(path)?next.delete(path):next.add(path);return next;});
  }, []);

  const handleLongPress = useCallback((path: string) => {
    setIsSelectionMode(true);
    setSelectedTracks(new Set([path]));
  }, []);

  const safeNavView = currentView.startsWith('ALBUM_') ? 'ALBUMS' : 
                      currentView.startsWith('ARTIST_') ? 'ARTIST' :
                      currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' :
                      currentView;

  // MASSIVE HEADER RESOLVER
  const headerInfo = useMemo(() => {
    const getSafeName = artistCacheKey;
    if (currentView === 'FAVOURITES') return { type: 'FAVOURITES', title: 'Favourite Tracks', subtitle: `${displayedTracks.length} tracks`, isCircle: false, image: null, isMassive: true };
    if (currentView === 'TOPTRACKS') return { type: 'MOST PLAYED', title: 'Top Ranked Tracks', subtitle: `${displayedTracks.length} tracks by listen time`, isCircle: false, image: null, isMassive: true };
    if (activeArtistName) {
      const rawPath = globalArtistImages[getSafeName(activeArtistName)];
      const artistImage = rawPath ? convertFileSrc(rawPath) : null;
      return { type: 'ARTIST', title: activeArtistName, subtitle: `${displayedTracks.length} tracks`, isCircle: true, image: artistImage, isMassive: true };
    }
    if (activePlaylistId) {
      const pl = customPlaylists.find(p=>p.id === activePlaylistId);
      return { type: 'PLAYLIST', title: pl?.name || 'Unknown', subtitle: `${displayedTracks.length} tracks`, isCircle: false, image: null, isMassive: true };
    }
    // For albums we use the old logic or we can use headerInfo but not massive
    if (activeAlbumName) return { type: 'ALBUM', title: activeAlbumName, subtitle: `${displayedTracks.length} tracks • ${displayedTracks[0]?.artist || 'Unknown'}`, isCircle: false, image: displayedTracks.find(t => t.thumb)?.thumb || (currentTrack?.album === activeAlbumName ? albumArt : null), isMassive: false };
    return null;
  }, [currentView, activeArtistName, activeAlbumName, activePlaylistId, displayedTracks, customPlaylists, albumArt, currentTrack, globalArtistImages]);

  // ==========================================
  // GLOBAL KEYBOARD SHORTCUTS ENGINE
  // ==========================================
  const keyboardActionsRef = useRef({ handlePlayPause, handleNext, handlePrev, handleTasteChange, writeToEngine });
  useEffect(() => {
    keyboardActionsRef.current = { handlePlayPause, handleNext, handlePrev, handleTasteChange, writeToEngine };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Ignore if typing in Search Bar or any input
      if (e.target instanceof HTMLElement && (e.target.closest('input,textarea,select,button,[contenteditable="true"]'))) return;
      if (e.repeat) return; // Prevent OS auto-repeat from spamming timeouts

      switch(e.key.toLowerCase()) {
        case ' ': // Space
          e.preventDefault();
          keyboardActionsRef.current.handlePlayPause();
          break;
        case 'arrowup':
          e.preventDefault();
          const upV = Math.min(1.0, volumeRef.current + 0.05);
          setVolume(upV);
          volumeRef.current = upV;
          keyboardActionsRef.current.writeToEngine(`VOLUME ${upV}`);
          break;
        case 'arrowdown':
          e.preventDefault();
          const downV = Math.max(0.0, volumeRef.current - 0.05);
          setVolume(downV);
          volumeRef.current = downV;
          keyboardActionsRef.current.writeToEngine(`VOLUME ${downV}`);
          break;
        case 'arrowright':
          if (!rightKeyTimerRef.current && !rightKeyIntervalRef.current) {
            rightKeyTimerRef.current = setTimeout(() => {
              rightKeyIntervalRef.current = setInterval(async () => {
                isSeekingRef.current = true;
                const newT = Math.min(durationRef.current, currentTimeRef.current + 2.0);
                setCurrentTime(newT);
                currentTimeRef.current = newT;
                await keyboardActionsRef.current.writeToEngine(`SEEK ${newT}`);
              }, 100);
            }, 300);
          }
          break;
        case 'arrowleft':
          if (!leftKeyTimerRef.current && !leftKeyIntervalRef.current) {
            leftKeyTimerRef.current = setTimeout(() => {
              leftKeyIntervalRef.current = setInterval(async () => {
                isSeekingRef.current = true;
                const newT = Math.max(0, currentTimeRef.current - 2.0);
                setCurrentTime(newT);
                currentTimeRef.current = newT;
                await keyboardActionsRef.current.writeToEngine(`SEEK ${newT}`);
              }, 100);
            }, 300);
          }
          break;
        case 'l':
          setShowLyrics(prev => !prev);
          break;
        case 'd':
          if (IS_ANDROID) {
            setShowDSPPage(prev => !prev);
          } else {
            setShowStudio(prev => !prev);
          }
          break;
        case 'o':
          setVisMode(prev => prev === 'ORBIT' ? 'RADAR' : 'ORBIT');
          break;
        case 's':
          setIsExpanded(false);
          break;
        case 'w':
          setIsExpanded(true);
          break;
        case 'pageup':
          e.preventDefault();
          const bassDown = Math.max(0.0, bassLevelRef.current - 0.05);
          setBassLevel(bassDown);
          bassLevelRef.current = bassDown;
          keyboardActionsRef.current.writeToEngine(`BASS ${bassDown}`);
          break;
        case 'pagedown':
          e.preventDefault();
          const bassUp = Math.min(1.5, bassLevelRef.current + 0.05);
          setBassLevel(bassUp);
          bassLevelRef.current = bassUp;
          keyboardActionsRef.current.writeToEngine(`BASS ${bassUp}`);
          break;
        case 'home':
          e.preventDefault();
          const trebDown = Math.max(0.0, trebleLevelRef.current - 0.05);
          setTrebleLevel(trebDown);
          trebleLevelRef.current = trebDown;
          keyboardActionsRef.current.writeToEngine(`TREBLE ${trebDown}`);
          break;
        case 'end':
          e.preventDefault();
          const trebUp = Math.min(1.5, trebleLevelRef.current + 0.05);
          setTrebleLevel(trebUp);
          trebleLevelRef.current = trebUp;
          keyboardActionsRef.current.writeToEngine(`TREBLE ${trebUp}`);
          break;
        case 'q':
          e.preventDefault();
          if (IS_ANDROID) {
             setMobileSearchOpen(prev => !prev);
          } else {
             const searchInput = document.getElementById('main-search-input') as HTMLInputElement;
             if (searchInput) {
                 if (document.activeElement !== searchInput) searchInput.focus();
                 else searchInput.blur();
             }
          }
          break;
        case '1':
          keyboardActionsRef.current.handleTasteChange('QUALITY');
          break;
        case '2':
          keyboardActionsRef.current.handleTasteChange('IMMERSIVE');
          break;
        case '3':
          keyboardActionsRef.current.handleTasteChange('CHILL');
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'arrowright') {
        if (rightKeyTimerRef.current) { clearTimeout(rightKeyTimerRef.current); rightKeyTimerRef.current = null; }
        if (rightKeyIntervalRef.current) {
          clearInterval(rightKeyIntervalRef.current);
          rightKeyIntervalRef.current = null;
          isSeekingRef.current = false;
        } else {
          keyboardActionsRef.current.handleNext();
        }
      } else if (e.key.toLowerCase() === 'arrowleft') {
        if (leftKeyTimerRef.current) { clearTimeout(leftKeyTimerRef.current); leftKeyTimerRef.current = null; }
        if (leftKeyIntervalRef.current) {
          clearInterval(leftKeyIntervalRef.current);
          leftKeyIntervalRef.current = null;
          isSeekingRef.current = false;
        } else {
          keyboardActionsRef.current.handlePrev();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (rightKeyTimerRef.current) clearTimeout(rightKeyTimerRef.current);
      if (rightKeyIntervalRef.current) clearInterval(rightKeyIntervalRef.current);
      if (leftKeyTimerRef.current) clearTimeout(leftKeyTimerRef.current);
      if (leftKeyIntervalRef.current) clearInterval(leftKeyIntervalRef.current);
    };
  }, []);


  return (
    <div className={`app-layout ${visMode === 'RADAR' ? 'radar-mode' : ''}`} data-platform={IS_ANDROID ? 'android' : 'desktop'} data-theme={isDarkMode?'dark':'light'} style={{'--theme-color':themeColor,'--theme-text':themeText,'--blob-1':blobColors[0],'--blob-2':blobColors[1],'--blob-3':blobColors[2],'--audio-level':audioLevel} as React.CSSProperties}>
      {audio.error && <div className="audio-global-error" role="alert">{audio.error}</div>}
      {showSettings && <SettingsModal apiKey={geminiApiKey} setApiKey={setGeminiApiKey} filters={libraryFilters} onClose={() => setShowSettings(false)} onSave={async filters => {
        await invoke('set_setting', { key: 'gemini_api_key', value: geminiApiKey.trim() });
        await invoke('set_setting', { key: 'library_filters', value: JSON.stringify(filters) });
        setLibraryFilters(filters);
        setShowSettings(false);
      }} />}
      
      {showFolderModal&&<FolderModal onClose={()=>setShowFolderModal(false)} onScan={scanAndAdd}/>}
      {playlistModalTracks.length>0&&<PlaylistPopup playlists={customPlaylists} newPlaylistName={newPlaylistName} setNewPlaylistName={setNewPlaylistName} onClose={()=>setPlaylistModalTracks([])} onCreate={createPlaylist} onAdd={id=>addToPlaylist(id)}/>}
      

      <div className="app-container">
        {/* THE SEARCH BAR OVERRIDE: Absolute positioning guarantees it renders on top of everything */}
        {/* THE SEARCH BAR OVERRIDE */}
        {mobileSearchOpen && (
          <>
            {/* THE CLICK-OUTSIDE FIX: This invisible layer catches taps and destroys the search bar */}
            <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setMobileSearchOpen(false)} />
            
            <div className="fade-in" style={{
              position: 'absolute', 
              top: IS_ANDROID ? '65px' : '75px', 
              left: '16px', 
              right: '16px', 
              zIndex: 999,
              background: 'rgba(15, 15, 15, 0.85)', 
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.1)', 
              borderRadius: '24px', 
              padding: '12px 18px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              boxShadow: '0 16px 40px rgba(0,0,0,0.6)'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              
              <input 
                autoFocus 
                id="main-search-input"
                type="text" 
                placeholder="Search tracks, artists, albums..." 
                value={searchQuery} 
                onChange={e => setSearchQuery(e.target.value)} 
                style={{
                  flex: 1, 
                  background: 'transparent', 
                  border: 'none', 
                  color: '#ffffff', 
                  fontSize: '16px', 
                  outline: 'none',
                  width: '100%'
                }}
              />
              
              {/* THE SVG REPLACEMENT: Replaced the raw text with a clean X icon */}
              {searchQuery ? (
                <button 
                  onClick={() => setSearchQuery('')} 
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              ) : (
                <button 
                  onClick={() => setMobileSearchOpen(false)} 
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              )}
            </div>
          </>
        )}

        {/* TIER 0: THE DEDICATED SYSTEM TITLEBAR */}
        {/* TIER 0: THE DEDICATED SYSTEM TITLEBAR */}
        <TopNav 
          currentView={safeNavView} setCurrentView={setCurrentView}
          handleAddFolder={handleAddFolder} 
          handleClearLibrary={handleClearLibrary} 
          isLoading={!isBooted || isLoading}
          mobileSearchOpen={mobileSearchOpen} setMobileSearchOpen={setMobileSearchOpen}
          toggleTheme={toggleTheme}
          onOpenSettings={() => setShowSettings(true)}
        />
        <BulkScanner 
          playlist={playlist} bulkScanActive={bulkScanActive} bulkScanPaused={bulkScanPaused}
          bulkScanDone={bulkScanDone} bulkScanTotal={bulkScanTotal} isBulkScanOpen={isBulkScanOpen}
          setIsBulkScanOpen={setIsBulkScanOpen} startBulkCategoryScan={startBulkCategoryScan}
          pauseBulkScan={pauseBulkScan} resumeBulkScan={resumeBulkScan} stopBulkScan={stopBulkScan}
        />
        {/* THE RESTORED SCAN PROGRESS TOAST */}
        {scanProgress && (
          <div className="scan-progress fade-in" style={{ zIndex: 100 }}>
            <span className="dot-pulse" style={{ marginRight: '8px', display: 'inline-block' }}></span>
            <span role="status" style={{ flex: 1, minWidth: 0 }}>{scanProgress}</span>
            <button type="button" aria-label="Dismiss scan message" onClick={() => setScanProgress('')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: '36px', height: '36px', border: 0, borderRadius: '6px', background: 'transparent', color: 'inherit', cursor: 'pointer' }}><X size={18} /></button>
          </div>
        )}

        {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
        {/* THE SCROLL FIX: Forcefully hide native scrollbars but keep scrolling active */}
        {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
        {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
       {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
        {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
        <main className="content-area">
          {/* THE UNIFIED SCROLL FIX: The container is fully unlocked. Header and tracks scroll together natively. */}
          <div 
            ref={trackContainerRef}
            onScroll={(e) => scrollPositionsRef.current[currentView] = e.currentTarget.scrollTop}
            className="samsung-track-container" 
            style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}
          >
            
            {/* 1. HIGHEST PRIORITY: PLAYLIST GALLERY */}
            {currentView === 'CLOUD_FETCH' ? (
              <CloudFetchView 
                onPlayCloudTrack={async (trackData) => {
                  try {
                    // 1. Fetch the track details to get the raw download URL
                    // Use the Rust backend to bypass CORS blocks
                    const jsonStr = await invoke<string>('fetch_cloud_api', { 
                        url: `https://saavn.dev/api/songs?ids=${trackData.id}` 
                    });
                    const data = JSON.parse(jsonStr);
                    
                    let downloadUrl = "";
                    if (data && data.success && data.data && data.data[0] && data.data[0].downloadUrl) {
                        const urls = data.data[0].downloadUrl;
                        // Get highest quality stream
                        downloadUrl = urls[urls.length - 1].url;
                    }

                    if (downloadUrl) {
                      // 2. Safely download it to a temp cache via Rust
                      const tempPath = await invoke<string>('download_cloud_stream', { url: downloadUrl });
                      
                      // 3. Blast it through the DSP engine!
                      await invoke('audio_command', { cmd: `LOAD ${tempPath}` });
                      
                      // 4. Update the UI
                      const newTrack = {
                         path: tempPath,
                         name: (trackData.name || trackData.title).replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
                         artist: trackData.artists?.primary?.map((a:any) => a.name).join(', ') || 'Unknown',
                         album: 'Cloud Stream',
                         duration: trackData.duration || 0,
                         thumb: trackData.image?.[2]?.url || trackData.image?.[0]?.url
                      };
                      setCurrentTrack(newTrack as any);
                      setIsPlaying(true);
                    } else {
                        console.error("No download URL found in API response");
                    }
                  } catch (e) {
                      console.error("Error streaming cloud track:", e);
                  }
                }}
              />
            ) : currentView === 'PLAYLIST_GALLERY' ? (
              <PlaylistGalleryView 
                playlist={visiblePlaylist} favoritesSet={favoritesSet} customPlaylists={customPlaylists} albumArt={albumArt}
                setCurrentView={setCurrentView} createPlaylist={createPlaylist} deletePlaylist={deletePlaylist}
              />
            ) : currentView === 'ARTIST' ? (
              <ArtistGalleryView playlist={visiblePlaylist} setCurrentView={setCurrentView} />
            ) : currentView === 'ALBUMS' ? (
              /* 2. THE NEW BENTO BOX ALBUM GRID */
              <AlbumGalleryView playlist={visiblePlaylist} setCurrentView={setCurrentView}/>
              
            ) : (
              <>
                {/* 1. THE UNIFIED MASSIVE HEADER */}
                {headerInfo && (
                  <div className={`album-detail-header fade-in ${headerInfo.isMassive ? 'massive-header' : ''}`} style={{ 
                    flexShrink: 0, 
                    padding: IS_ANDROID ? '24px 16px 16px' : '24px 36px 32px',
                    display: 'flex',
                    flexDirection: IS_ANDROID ? 'column' : undefined,
                    alignItems: IS_ANDROID ? 'center' : undefined,
                    textAlign: IS_ANDROID ? 'center' : 'left',
                    gap: IS_ANDROID ? '16px' : '24px'
                  }}>
                    
                    <div className="album-detail-art" style={{ 
                      backgroundColor: 'var(--bg-surface)', overflow: 'hidden', position: 'relative',
                      width: IS_ANDROID ? (headerInfo.isMassive ? '200px' : '180px') : (headerInfo.isMassive ? '240px' : '180px'), 
                      height: IS_ANDROID ? (headerInfo.isMassive ? '200px' : '180px') : (headerInfo.isMassive ? '240px' : '180px'),
                      minWidth: IS_ANDROID ? (headerInfo.isMassive ? '200px' : '180px') : (headerInfo.isMassive ? '240px' : '180px'),
                      marginBottom: IS_ANDROID ? '8px' : undefined,
                      borderRadius: headerInfo.isCircle ? '50%' : '16px',
                      boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {(() => {
                        if (headerInfo.image) return <img src={headerInfo.image} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }} />;
                        if (['FAVOURITES', 'MOST PLAYED', 'PLAYLIST'].includes(headerInfo.type)) {
                          const thumbs = Array.from(new Set(displayedTracks.map(t => t.thumb).filter(Boolean)));
                          if (thumbs.length > 0) {
                            const grid = [thumbs[0], thumbs[1] || thumbs[0], thumbs[2] || thumbs[0], thumbs[3] || thumbs[1] || thumbs[0]];
                            return (
                              <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px', boxSizing: 'border-box' }}>
                                {grid.map((src, i) => (
                                  <div key={i} style={{ width: 'calc(50% - 2px)', height: 'calc(50% - 2px)', backgroundImage: `url("${src}")`, backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: headerInfo.isMassive ? '12px' : '6px' }} />
                                ))}
                                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.6))' }}>
                                  {headerInfo.type === 'FAVOURITES' ? (
                                    <svg width={headerInfo.isMassive ? "64" : "32"} height={headerInfo.isMassive ? "64" : "32"} viewBox="0 0 24 24" fill="var(--theme-color)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                                  ) : headerInfo.type === 'MOST PLAYED' ? (
                                    <svg width={headerInfo.isMassive ? "64" : "32"} height={headerInfo.isMassive ? "64" : "32"} viewBox="0 0 24 24" fill="var(--theme-color)"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                                  ) : (
                                    <svg width={headerInfo.isMassive ? "48" : "24"} height={headerInfo.isMassive ? "48" : "24"} viewBox="0 0 24 24" fill="var(--theme-color)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                                  )}
                                </div>
                              </div>
                            );
                          }
                        }
                        if (headerInfo.type === 'FAVOURITES') return <svg width="64" height="64" viewBox="0 0 24 24" fill="var(--theme-color)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>;
                        return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>;
                      })()}
                    </div>
                    
                    <div className="album-detail-info" style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: IS_ANDROID ? 'center' : 'flex-start', justifyContent: 'center' }}>
                      <div className="album-detail-badge" style={{ marginBottom: IS_ANDROID ? '6px' : '8px', fontSize: '13px', color: 'var(--theme-color)', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase' }}>
                        {headerInfo.type}
                      </div>
                      <div className="album-detail-title" style={{
                        fontSize: headerInfo.isMassive ? (IS_ANDROID ? '32px' : '48px') : (IS_ANDROID ? '24px' : '36px'),
                        fontWeight: 900,
                        lineHeight: 1.1,
                        marginBottom: IS_ANDROID ? '8px' : '12px',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal'
                      }}>{headerInfo.title}</div>
                      <div className="album-detail-artist" style={{
                        fontSize: '16px', marginBottom: IS_ANDROID ? '16px' : '24px', opacity: 0.7, fontWeight: 500
                      }}>{headerInfo.subtitle}</div>
                      
                      <div className="album-detail-actions" style={{ justifyContent: IS_ANDROID ? 'center' : 'flex-start', width: '100%', display: 'flex', gap: '12px' }}>
                        {displayedTracks.length > 0 && (
                          <button className="play-all-btn" style={{ flex: IS_ANDROID ? 1 : undefined, justifyContent: 'center', background: 'var(--theme-color)', color: 'var(--theme-text)', boxShadow: '0 4px 20px rgba(255,50,50,0.4)', border: 'none', padding: '12px 24px', borderRadius: '30px', fontWeight: 700, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => playTrack(displayedTracks[0])}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play All
                          </button>
                        )}
                        <button className="back-albums-btn" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '12px 24px', borderRadius: '30px', fontWeight: 600, fontSize: '15px', cursor: 'pointer' }} onClick={() => window.history.back()}>
                          ← Back
                        </button>                      
                      </div>
                    </div>
                  </div>
                )}

                {/* 1.5. EMPTY STATE IF NO TRACKS */}
                {displayedTracks.length === 0 ? (
                  <div className="empty-state" style={{ marginTop: '32px' }}>
                    <div className="empty-icon">🎵</div>
                    <p className="empty-title">{searchQuery?'No results found':headerInfo?'No tracks here yet':'No music yet'}</p>
                    <p className="empty-hint">{searchQuery?'Try a different search term':IS_MOBILE?'Tap the + button to add your music folders':'Click the + button in the top right'}</p>
                    {!searchQuery&&IS_MOBILE&&<button className="empty-add-btn" onClick={handleAddFolder}>+ Add Music Folder</button>}
                  </div>
                ) : (
                  <>
                {/* 2. THE SELECTION & SORT BAR */}
                {displayedTracks.length > 0 && (
                  <div style={{flexShrink: 0, display:'flex',justifyContent: isSelectionMode ? 'space-between' : 'flex-end',alignItems:'center',marginBottom: IS_ANDROID ? '6px' : '16px', padding: IS_ANDROID ? '0 16px' : '0 16px 0 0', transition: 'all 0.2s'}}>
                    {isSelectionMode ? (
                      <div style={{display:'flex',gap:'10px',alignItems:'center', width: '100%', justifyContent: 'space-between'}}>
                        <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
                          <button className="dsp-btn" onClick={()=>{setIsSelectionMode(false);setSelectedTracks(new Set());}}>Cancel</button>
                          <span style={{fontSize:'14px',fontWeight:600}}>{selectedTracks.size} selected</span>
                        </div>
                        {selectedTracks.size>0&&(
                          <div style={{display:'flex',gap:'8px'}}>
                            <button className="add-folder-btn" style={{padding:'0 16px',height:'34px'}} onClick={()=>setPlaylistModalTracks(Array.from(selectedTracks))}>+ Add</button>
                            {activePlaylistId&&<button className="add-folder-btn" style={{padding:'0 16px',height:'34px',background:'#e81123',color:'#fff'}} onClick={()=>removeFromPlaylist(activePlaylistId,Array.from(selectedTracks))}>🗑 Remove</button>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                          {searchQuery ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto', background: 'var(--bg-raised)', padding: '6px 12px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                              <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                                Results for <strong style={{ color: 'var(--theme-color)' }}>"{searchQuery}"</strong>
                              </span>
                              <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px', color: 'var(--text-muted)' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                              </button>
                            </div>
                          ) : (
                            !IS_ANDROID && <button className="dsp-btn" style={{marginRight: 'auto'}} onClick={()=>setIsSelectionMode(true)}>☑ Select Multiple</button>
                          )}
                        {(!activePlaylistId && !activeAlbumName && currentView !== 'TOPTRACKS') && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                            {!IS_ANDROID && <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sort By:</span>}
                            <div onClick={(e) => { e.stopPropagation(); setIsSortDropdownOpen(!isSortDropdownOpen); }} style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', minWidth: IS_ANDROID ? 'auto' : '120px', justifyContent: 'space-between', transition: 'background 0.2s' }}>
                              <span>{sortMode === 'TITLE' ? 'Title (A-Z)' : sortMode === 'ARTIST' ? 'Artist (A-Z)' : sortMode === 'ALBUM' ? 'Album (A-Z)' : sortMode === 'YEAR' ? 'Year (Newest)' : 'Date Added (Newest)'}</span>
                              <span style={{ fontSize: '10px', opacity: 0.6 }}>▼</span>
                            </div>
                            {isSortDropdownOpen && (
                              <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setIsSortDropdownOpen(false)} />
                                <div className="glass-options-menu fade-in" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 99, marginTop: '8px', padding: '6px', width: '160px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                                  {['DATE_ADDED', 'TITLE', 'ARTIST', 'ALBUM', 'YEAR'].map(mode => (
                                    <div key={mode} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', background: sortMode === mode ? 'rgba(255,255,255,0.15)' : 'transparent', transition: 'background 0.2s' }} onClick={() => { setSortMode(mode as any); setIsSortDropdownOpen(false); }}>
                                      {mode === 'TITLE' ? 'Title (A-Z)' : mode === 'ARTIST' ? 'Artist (A-Z)' : mode === 'ALBUM' ? 'Album (A-Z)' : mode === 'YEAR' ? 'Year (Newest)' : 'Date Added (Newest)'}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                
                {/* 4. THE ACTUAL LIST ENGINE */}
                {activePlaylistId ? (
                  <DraggablePlaylistView tracks={displayedTracks} currentTrackPath={currentTrack?.path} albumArt={albumArt}
                    onPlay={playTrack} formatTime={formatTime}
                    onRemove={track=>removeFromPlaylist(activePlaylistId,[track.path])}
                    onReorder={(from,to)=>reorderPlaylist(activePlaylistId,from,to)}
                    isSelectionMode={isSelectionMode} selectedTracks={selectedTracks} onToggleSelect={toggleSelect}/>
                ) : (activeAlbumName || activeArtistName || currentView === 'FAVOURITES' || currentView === 'TOPTRACKS') ? (
                  
                  /* ============================================================== */
                  /* THE FLAT LIST BOMB: Virtualization destroyed for Detail Views  */
                  /* ============================================================== */
                  <div style={{ paddingBottom: '150px' }}>
                    {displayedTracks.map((track, index) => (
                      <div 
                        key={track.path}
                        onClick={() => isSelectionMode ? toggleSelect(track.path) : playTrack(track)}
                        onContextMenu={(e) => { e.preventDefault(); handleLongPress(track.path); }}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '12px 16px', gap: '16px', cursor: 'pointer',
                          background: selectedTracks.has(track.path) ? 'rgba(255,255,255,0.1)' : 'transparent',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          transition: 'background 0.2s'
                        }}
                      >
                        {/* Track Number & Thumb */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '24px', textAlign: 'center', color: currentTrack?.path === track.path ? 'var(--theme-color)' : 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>
                            {currentTrack?.path === track.path ? '▶' : index + 1}
                          </div>
                          <div style={{ width: '40px', height: '40px', borderRadius: '6px', backgroundColor: 'var(--bg-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {currentTrack?.path === track.path && albumArt ? <div style={{ width: '100%', height: '100%', backgroundImage: `url(${albumArt})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                              : track.thumb ? <div style={{ width: '100%', height: '100%', backgroundImage: `url(${track.thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>}
                          </div>
                        </div>
                        
                        {/* Track Name & Artist */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <span style={{ fontSize: '15px', fontWeight: 600, color: currentTrack?.path === track.path ? 'var(--theme-color)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.name}
                          </span>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.artist}
                          </span>
                        </div>
                        
                        {/* Track Duration */}
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {track.duration ? formatTime(track.duration) : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                ) : (
                  
                  /* ============================================================== */
                  /* VIRTUAL LIST: Maintained ONLY for the massive All Tracks view  */
                  /* ============================================================== */
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <VirtualList tracks={displayedTracks} currentTrackPath={currentTrack?.path} albumArt={albumArt}
                      favoritesSet={favoritesSet}
                      onPlay={playTrack} formatTime={formatTime}
                      onAddToPlaylist={track=>setPlaylistModalTracks([track.path])}
                      onRemoveFromPlaylist={track=>activePlaylistId&&removeFromPlaylist(activePlaylistId,[track.path])}
                      activePlaylistId={activePlaylistId} isSelectionMode={isSelectionMode}
                      selectedTracks={selectedTracks} onToggleSelect={toggleSelect}
                      onLongPress={handleLongPress} 
                    />
                  </div>
                )}
                  </>
                )}
              </>
            )}
          </div>
        </main>



        <footer className={`bottom-player ${isExpanded?'expanded':''}`}>
          
          {/* 1. Mini Player: Never unmounted, never display:none. Just faded out. */}
          <MiniPlayer 
            isExpanded={isExpanded} setIsExpanded={setIsExpanded}
            duration={duration} currentTime={currentTime} isSeekingRef={isSeekingRef}
            handleSeekDrag={handleSeekDrag} handleSeekCommit={handleSeekCommit}
            albumArt={albumArt} trackTitle={trackTitle} trackArtist={trackArtist}
            detectedProfile={detectedProfile} isPlaying={isPlaying}
            handlePlayPause={handlePlayPause} handlePrev={handlePrev} handleNext={handleNext}
          />

          {/* 2. Expanded Player: Hardware Accelerated Decoupled Layout */}
          <div className="expanded-player-content" style={{ 
            opacity: isExpanded ? 1 : 0, 
            pointerEvents: isExpanded ? 'auto' : 'none',
            // CRITICAL FIX: 'fixed' decouples this heavy DOM tree from the parent's width/height animation!
            // The browser calculates this 100vw/100vh layout ONCE and stores it on the GPU.
            position: 'fixed', 
            top: 0,
            left: 0,
            height: '100vh',
            width: '100vw',
            transform: isExpanded ? 'translateY(0) scale(1)' : 'translateY(8%) scale(0.95)',
            // 0.7s gives it enough time to breathe, cubic-bezier makes it feel physically heavy and premium
            transition: 'opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'opacity, transform',
            zIndex: 3000
          }}>
            {IS_MOBILE ? (
              <MobileExpandedPlayer 
                is9DStageOn={is9DStageOn} setIs9DStageOn={setIs9DStageOn}
                is9DBassRoom={is9DBassRoom} setIs9DBassRoom={setIs9DBassRoom}
                selectedHeadphoneModel={selectedHeadphoneModel}
                setSelectedHeadphoneModel={setSelectedHeadphoneModel}
                onHeadphoneModelSelect={applyHeadphoneCorrection}
                isExpanded={isExpanded}
                trackTitle={trackTitle} trackArtist={trackArtist} albumArt={albumArt}
                isPlaying={isPlaying} currentTime={currentTime} duration={duration}
                isShuffle={isShuffle} repeatMode={repeatMode} repeatDeg={repeatDeg} repeatBusy={repeatBusy}
                isAnalyzing={isAnalyzing} isManualOverride={isManualOverride} detectedProfile={detectedProfile}
                smartTaste={smartTaste} isCurrentFavorite={isCurrentFavorite}
                lyrics={lyrics} activeLyricIndex={activeLyricIndex} scanProgress={scanProgress}
                isRemastered={isRemastered} setIsRemastered={setIsRemastered}
                isCompressed={isCompressed} setIsCompressed={setIsCompressed}
                selectedAcousticEnv={selectedAcousticEnv} setSelectedAcousticEnv={setSelectedAcousticEnv}
                isEnvDropdownOpen={isEnvDropdownOpen} setIsEnvDropdownOpen={setIsEnvDropdownOpen}
                upscaleDrive={upscaleDrive} setUpscaleDrive={setUpscaleDrive}
                widenWidth={widenWidth} setWidenWidth={setWidenWidth}
                spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra} depthAmount={depthAmount} setDepthAmount={setDepthAmount}
                reverbWet={reverbWet} setReverbWet={setReverbWet}
                restorationDenoise={restorationDenoise} setRestorationDenoise={setRestorationDenoise}
                restorationUpscale={restorationUpscale} setRestorationUpscale={setRestorationUpscale}
                restorationPresence={restorationPresence} setRestorationPresence={setRestorationPresence}
                setBassLevel={setBassLevel} setTrebleLevel={setTrebleLevel} setIsManualOverride={setIsManualOverride} setSmartTaste={setSmartTaste}
                isProfileActive={isProfileActive} setIsProfileActive={setIsProfileActive}
                isProfileActiveRef={isProfileActiveRef}
                applySmartSettings={applySmartSettings}
                smartTasteRef={smartTasteRef}
                bassLevel={bassLevel} bassLevelRef={bassLevelRef}
                trebleLevel={trebleLevel} trebleLevelRef={trebleLevelRef}
                speakerMode={speakerMode} setSpeakerMode={setSpeakerMode}
                isFIRMode={isFIRMode} setIsFIRMode={setIsFIRMode}
                visMode={visMode} setVisMode={setVisMode}
                isPhoneSpeaker={isPhoneSpeaker} setIsPhoneSpeaker={setIsPhoneSpeaker}
                isPhoneSpeakerRef={isPhoneSpeakerRef}
                isExpandedRef={isExpandedRef}
                audioLevelRef={audioLevelRef}
                spatialData={spatialData}
                themeColor={themeColor} isDarkMode={isDarkMode} audioLevel={audioLevel}
                onClose={() => { setIsExpanded(false); }}
                onPlayPause={handlePlayPause}
                onNext={handleNext} onPrev={handlePrev}
                onToggleShuffle={handleToggleShuffle}
                onToggleRepeat={handleToggleRepeat}
                onToggleFavorite={toggleFavorite}
                onSeekDrag={handleSeekDrag}
                onSeekCommit={handleSeekCommit}
                onTasteChange={handleTasteChange}
                lyricsSearch={currentTrack ? <LyricsSearch key={currentTrack.path} track={playlist.find(t => t.path === currentTrack.path) || currentTrack} onLyrics={finalizeLyrics} /> : undefined}
                onFetchLyrics={async () => {
                  if (currentTrack) {
                    const lrc = await fetchLyricsOnline(currentTrack, setScanProgress);
                    if (lrc) finalizeLyrics(currentTrack, lrc);
                  }
                }}
                writeToEngine={writeToEngine}
                isSeekingRef={isSeekingRef}
                setCurrentTime={setCurrentTime}
              />
            ) : (
              <>
                <AmbientBackground 
              isExpandedRef={isExpandedRef} 
              audioLevelRef={audioLevelRef} 
              spatialData={spatialData} 
              visMode={visMode} 
              themeColor={themeColor} 
              isDarkMode={isDarkMode} 
              audioLevel={audioLevel} 
            />
            {showDSPPage&&renderMobileDSPPage()}
            <div className="mobile-album-gradient"/><div className="mobile-album-gradient"/>
            {!showDSPPage&&(
              <div className="ep-header" style={{position:'relative',zIndex:50}}>
                <button className="ep-icon-btn" onClick={e=>{
    e.stopPropagation();
    setIsExpanded(false);
    setShowOptionsMenu(false);
    
    // UX FIX: Kill right-pane layout engines when minimized
    setShowLyrics(false);
    setShowStudio(false);
  }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </button>
                {detectedProfile && (
                  <div 
                    className={`ep-profile-badge ${isProfileActive ? 'active' : ''}`} 
                    style={{ cursor: 'pointer', transition: 'all 0.2s', opacity: isProfileActive ? 1 : 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newState = !isProfileActive;
                      setIsProfileActive(newState);
                      isProfileActiveRef.current = newState;
                      
                      // Instantly recalculate the audio without the profile base
                      if (detectedProfileRef.current) {
                        applySmartSettings(detectedProfileRef.current, smartTasteRef.current);
                      }
                    }}
                  >
                    {React.createElement(detectedProfile.icon as any, {size: 16})} {detectedProfile.label} {!isProfileActive && '(Manual)'}
                  </div>
                )}
                <button className={`ep-icon-btn ${showOptionsMenu?'active-glow':''}`} onClick={e=>{e.stopPropagation();setShowOptionsMenu(!showOptionsMenu);}}>⋮</button>
                {showOptionsMenu&&(
                  <>
                    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:99}} onClick={e=>{e.stopPropagation();setShowOptionsMenu(false);}}/>
                    <div className="glass-options-menu player-track-menu fade-in" onClick={e=>e.stopPropagation()}>
                      <TrackOptions visMode={visMode} setVisMode={setVisMode}
                        onManualEdit={() => { setIsManualOverride(true); setSmartTaste('ORIGINAL'); }} />
                    </div>
                  </>
                )}
              </div>
            )}
            <div className={`ep-content ${isRightPaneActive?'lyrics-mode':''}`} style={{position:'relative',zIndex:10}}>
              <div className="ep-left">
                <div className="ep-art" style={{backgroundImage:albumArt?`url(${albumArt})`:'none',backgroundColor:'rgba(128,128,128,0.08)'}} onClick={()=>{if(window.innerWidth<=768&&lyrics.length>0){setShowLyrics(true);setShowStudio(false);}}}>
                  {!albumArt&&<span>🎵</span>}
                  {lyrics.length>0&&<div className="lyrics-art-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>Synced lyrics</div>}
                </div>
                {isRightPaneActive && (
                  <ExpandedControls 
                    trackTitle={trackTitle} trackArtist={trackArtist} isAnalyzing={isAnalyzing} isManualOverride={isManualOverride}
                    detectedProfile={detectedProfile} smartTaste={smartTaste} handleTasteChange={handleTasteChange}
                    volume={volume} setVolume={setVolume} writeToEngine={writeToEngine} isCurrentFavorite={isCurrentFavorite}
                    toggleFavorite={toggleFavorite} showLyrics={showLyrics} setShowLyrics={setShowLyrics} showStudio={showStudio} setShowStudio={setShowStudio}
                    duration={duration} currentTime={currentTime} isSeekingRef={isSeekingRef} handleSeekDrag={handleSeekDrag} handleSeekCommit={handleSeekCommit}
                    isShuffle={isShuffle} handleToggleShuffle={handleToggleShuffle} handlePrev={handlePrev} isPlaying={isPlaying} handlePlayPause={handlePlayPause}
                    handleNext={handleNext} handleToggleRepeat={handleToggleRepeat} repeatDeg={repeatDeg} repeatMode={repeatMode} repeatBusy={repeatBusy}
                  />
                )}
              </div>
              <div className="ep-right">
                {!isRightPaneActive  && 
                <ExpandedControls 
                    trackTitle={trackTitle} trackArtist={trackArtist} isAnalyzing={isAnalyzing} isManualOverride={isManualOverride}
                    detectedProfile={detectedProfile} smartTaste={smartTaste} handleTasteChange={handleTasteChange}
                    volume={volume} setVolume={setVolume} writeToEngine={writeToEngine} isCurrentFavorite={isCurrentFavorite}
                    toggleFavorite={toggleFavorite} showLyrics={showLyrics} setShowLyrics={setShowLyrics} showStudio={showStudio} setShowStudio={setShowStudio}
                    duration={duration} currentTime={currentTime} isSeekingRef={isSeekingRef} handleSeekDrag={handleSeekDrag} handleSeekCommit={handleSeekCommit}
                    isShuffle={isShuffle} handleToggleShuffle={handleToggleShuffle} handlePrev={handlePrev} isPlaying={isPlaying} handlePlayPause={handlePlayPause}
                    handleNext={handleNext} handleToggleRepeat={handleToggleRepeat} repeatDeg={repeatDeg} repeatMode={repeatMode} repeatBusy={repeatBusy}
                  />}
                {showLyrics&&(
                  <div className="lyrics-display full" ref={lyricsContainerRef}>
                    {lyrics.length > 0 ? (
                      lyrics.map((line,i) => <p key={i} className={`lyric-line ${i===activeLyricIndex?'active':''}`}>{line.text}</p>)
                    ) : (
                      currentTrack && <LyricsSearch key={currentTrack.path} track={playlist.find(t => t.path === currentTrack.path) || currentTrack} onLyrics={finalizeLyrics} />
                    )}
                  </div>
                )}
                {showStudio && (
                  <DSPStudio 
                    isRemastered={isRemastered} setIsRemastered={setIsRemastered} isCompressed={isCompressed} setIsCompressed={setIsCompressed}
                    selectedAcousticEnv={selectedAcousticEnv} setSelectedAcousticEnv={setSelectedAcousticEnv} isEnvDropdownOpen={isEnvDropdownOpen} setIsEnvDropdownOpen={setIsEnvDropdownOpen}
                    upscaleDrive={upscaleDrive} setUpscaleDrive={setUpscaleDrive} widenWidth={widenWidth} setWidenWidth={setWidenWidth}
                    spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra} depthAmount={depthAmount} setDepthAmount={setDepthAmount} reverbWet={reverbWet} setReverbWet={setReverbWet}
                    restorationDenoise={restorationDenoise} setRestorationDenoise={setRestorationDenoise}
                    restorationUpscale={restorationUpscale} setRestorationUpscale={setRestorationUpscale}
                    restorationPresence={restorationPresence} setRestorationPresence={setRestorationPresence}
                    setIsManualOverride={setIsManualOverride} setSmartTaste={setSmartTaste} setBassLevel={setBassLevel} setTrebleLevel={setTrebleLevel} writeToEngine={writeToEngine}
            is9DStageOn={is9DStageOn} setIs9DStageOn={setIs9DStageOn}
            is9DBassRoom={is9DBassRoom} setIs9DBassRoom={setIs9DBassRoom}
            selectedHeadphoneModel={selectedHeadphoneModel}
            setSelectedHeadphoneModel={setSelectedHeadphoneModel}
            onHeadphoneModelSelect={applyHeadphoneCorrection}
                  />
                )}
              </div>
            </div>
            </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
