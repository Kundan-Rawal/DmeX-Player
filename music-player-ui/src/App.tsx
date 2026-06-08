import React, { useEffect, useRef, useState, useMemo,useCallback } from "react";
import { Track, NavView, Taste, CustomPlaylist, IS_ANDROID, IS_MOBILE, LyricLine } from './types/index';
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
// import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import * as mm from "music-metadata";
import { FastAverageColor } from "fast-average-color";
import "./App.css";
// import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLibraryScanner } from './hooks/useLibraryScanner';
import { AlbumGalleryView } from './views/AlbumGalleryView';
import { ArtistGalleryView } from './views/ArtistGalleryView';
import { vaultGet, vaultSet, initVault } from './services/vault';
import { splitArtists } from './utils/artistEngine';
import { formatTime, parseLRC } from './utils/formatters';
import { PlaylistGalleryView } from './views/PlaylistGalleryView';
import { PROFILES, FIR_GAINS, classifyAudio, applyTaste, AudioProfile } from './config/audio';
import { isHexDark, getPalette, getMime, stripExt } from './utils/helpers';
import { FolderModal, PlaylistPopup } from './modals/modals';
import { VirtualList, DraggablePlaylistView } from './components/library/TrackLists';
import { TopNav } from './components/layout/TopNav';
import { MiniPlayer } from './components/player/MiniPlayer';
import { AmbientBackground } from './components/player/AmbientBackground';
import { fetchLyricsOnline } from './services/lyricsFetcher';

import { DSPStudio, ExpandedControls } from './components/player/ExpandedPlayerUI';
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
  const [searchQuery, setSearchQuery]       = useState('');
  const [sortMode, setSortMode]             = useState<'TITLE'|'ARTIST'|'ALBUM'|'YEAR'>('TITLE');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  const [isProfileActive, setIsProfileActive] = useState(true);
  const isProfileActiveRef = useRef(true);

  // CHANGE: Raw search query debounced before filtering.
  // debouncedSearchQuery is what useMemo depends on — it only updates 300ms
  // after the user stops typing (0ms on desktop, no change in behaviour).
  const debouncedSearchQuery = useDebounce(searchQuery, IS_ANDROID ? 300 : 0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showFolderModal, setShowFolderModal]   = useState(false);
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
  const [volume, setVolume]                 = useState(1.0);
  const volumeRef = useRef(1.0);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  const [isRemastered, setIsRemastered]     = useState(false);
  const [isCompressed, setIsCompressed]     = useState(false);
  const [upscaleDrive, setUpscaleDrive]     = useState(0.0);
  const [widenWidth, setWidenWidth]         = useState(1.0);
  const [spatialExtra, setSpatialExtra]     = useState(0.0);
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
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [playlistModalTracks, setPlaylistModalTracks] = useState<string[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isShuffle, setIsShuffle]     = useState(false);
  const [, setShuffledQueue]          = useState<string[]>([]);
  const [repeatMode, setRepeatMode]   = useState<'OFF'|'ALL'|'ONE'>('OFF');
  const [repeatDeg, setRepeatDeg]     = useState(0);
  const [repeatBusy, setRepeatBusy]   = useState(false);
  const [bassLevel, setBassLevel]     = useState(0.0);
  const bassLevelRef                  = useRef(0.0);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [selectedAcousticEnv, setSelectedAcousticEnv] = useState('NONE');
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [isFIRMode, setIsFIRMode]     = useState(false);
  const [visMode, setVisMode]         = useState<'ORBIT'|'RADAR'>('ORBIT');
  const [speakerMode, setSpeakerMode] = useState<'NONE'|'LOW'|'MED'|'HIGH'>('NONE');

  const [isPhoneSpeaker, setIsPhoneSpeaker] = useState(false);
  const isPhoneSpeakerRef = useRef(false);
  useEffect(() => { isPhoneSpeakerRef.current = isPhoneSpeaker; }, [isPhoneSpeaker]);

  const smartTasteRef      = useRef<Taste>('QUALITY');
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

 
  const spatialData    = useRef({ bLvl:0,bPan:0,mLvl:0,mPan:0,mPhs:1,tLvl:0,tPan:0,tPhs:1 });
  const audioLevelRef  = useRef(0);
  const lastReactUpdate = useRef(0);


  const isTransitioningRef = useRef(false);
    useLibraryScanner(
      setIsLoading,
      setScanProgress,
      setPlaylist,
      setFavorites,
      setCustomPlaylists,
      setIsDarkMode,
      playlistRef
    );

  


  // CHANGE: DUST_COUNT fenced per platform.
  // 500 particles at 60fps on Android consumes ~35% of the rAF budget on a
  // 90k AnTuTu device. 80 particles at 30fps uses equivalent GPU/CPU time
  // while freeing the compositor for scroll, touch, and CSS transitions.
  

  
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

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
    let base = playlist;

    // 1. VIEW ROUTING
    if (currentView === 'FAVORITES') {
      base = playlist.filter(t => favorites.includes(t.path));
    } else if (currentView === 'BOLLYWOOD') {
      base = playlist.filter(t => {
        const s = `${t.genre||''} ${t.album||''} ${t.path}`.toLowerCase();
        return s.includes('bollywood') || s.includes('hindi') || s.includes('indian');
      });
    } else if (currentView === 'TOPTRACKS') {
      base = [...playlist].filter(t=>(t.playCount||0)>0).sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,50);
    } else if (activePlaylistId) {
      const pl = customPlaylists.find(p=>p.id===activePlaylistId);
      if (pl) base = pl.trackPaths.map(path=>playlist.find(t=>t.path===path)).filter((t):t is Track=>t!==undefined);
    } else if (activeAlbumName) {
      base = playlist.filter(t => (t.album || 'Unknown Album') === activeAlbumName);
    } else if (activeArtistName) {
      base = playlist.filter(t => splitArtists(t.artist || 'Unknown Artist').includes(activeArtistName));
    }

    // 2. THE SEARCH ENGINE
    if (debouncedSearchQuery && debouncedSearchQuery.trim() !== '') {
      const q = debouncedSearchQuery.toLowerCase();
      base = base.filter(t => String(t?.name||'').toLowerCase().includes(q) || String(t?.artist||'').toLowerCase().includes(q) || String(t?.album||'').toLowerCase().includes(q));
    }

    // 3. THE DYNAMIC SORTER
    if (currentView === 'TOPTRACKS' || activePlaylistId) return base;

    return [...base].sort((a, b) => {
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
  }, [playlist, currentView, favorites, customPlaylists, debouncedSearchQuery, sortMode, activePlaylistId, activeAlbumName, activeArtistName]);


  // CHANGE: favorites → Set<string>, memoized.
  // Passed to VirtualList so TrackRow lookups are O(1) not O(n).
  // The Set is recreated only when the favorites array changes reference.
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = useCallback(async (cmd:string) => {
    try { await invoke('audio_command', { cmd: cmd.trim() }); } catch (_) {}
  }, []);

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
        const savedDark = await vaultGet<boolean>("isDarkMode");
        if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
      } catch (err) {} // <--- THIS IS WHAT WAS MISSING

      setIsLoading(false);
      setScanProgress('');
    }
    boot();
  }, []); // Run exactly once on mount

  useEffect(() => {
    // 1. When we dive into an Album or Playlist, forcefully inject a fake history state.
    // This physically stops Android from exiting the app when you swipe back.
    if (currentView.startsWith('ALBUM_') || currentView.startsWith('PLAYLIST_')) {
      window.history.pushState({ fakePage: true }, '');
    }

    // 2. When the OS consumes that fake state (Hardware swipe-back)
    const handleAndroidBackSwipe = () => {
      if (currentView.startsWith('ALBUM_')) {
        setCurrentView('ALBUMS');
      } else if (currentView.startsWith('PLAYLIST_')) {
        setCurrentView('PLAYLIST_GALLERY');
      }
    };

    window.addEventListener('popstate', handleAndroidBackSwipe);
    return () => window.removeEventListener('popstate', handleAndroidBackSwipe);
  }, [currentView]);


  const handleNext = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    if (!playlistRef.current.length||!track) return;
    if (repeatModeRef.current==='ONE') { playTrack(track); return; }
    playHistoryRef.current.push(track.path);
    if (isShuffleRef.current&&shuffledQueueRef.current.length>0) {
      const q=shuffledQueueRef.current,idx=q.indexOf(track.path);
      let nextPath=q[0];
      if(idx!==-1&&idx+1<q.length) nextPath=q[idx+1];
      else if(repeatModeRef.current!=='ALL'&&idx+1>=q.length) return;
      const nextTrack=playlistRef.current.find(t=>t.path===nextPath);
      if(nextTrack) playTrack(nextTrack);
      return;
    }
    let activeQueue=list,i=activeQueue.findIndex(t=>t.path===track.path);
    if(i===-1){activeQueue=playlistRef.current;i=activeQueue.findIndex(t=>t.path===track.path);}
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
        const m: number[] = await invoke('audio_metrics');
        const lvl = Math.min(1, (m[10] || 0) * 3.5);
        audioLevelRef.current = lvl;
        spatialData.current = { bLvl:m[2],bPan:m[3],mLvl:m[4],mPan:m[5],mPhs:m[6],tLvl:m[7],tPan:m[8],tPhs:m[9] };
        
        const now = Date.now();
        if (now - lastReactUpdate.current > 250) {
          if (!isSeekingRef.current) setCurrentTime(m[0]);
          if (m[1] > 0) setDuration(m[1]);
          setAudioLevel(lvl);
          lastReactUpdate.current = now;
        }

        if (m[11] === 1.0 || (m[1] > 0 && m[0] >= m[1] - 1.0)) {
          if (!isTransitioningRef.current) {
            isTransitioningRef.current = true;
            const currentPath = stateRefs.current.currentTrack?.path;
            if (currentPath && lastCountedTrackRef.current !== currentPath) {
              lastCountedTrackRef.current = currentPath;
              const listened = Math.floor(m[1]);
              setPlaylist(prev => prev.map(t => t.path === currentPath ? { ...t, playCount: (t.playCount || 0) + 1, totalSecondsListened: (t.totalSecondsListened || 0) + listened } : t));
              invoke('update_play_stats', { path: currentPath, seconds: listened }).catch(console.error);
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

  const applySmartSettings = async (profile:AudioProfile, taste:Taste) => {
    const s = applyTaste(profile.settings, taste);
    setUpscaleDrive(s.drive);
    setWidenWidth(s.widen);
    setSpatialExtra(s.spatial);
    setReverbWet(s.reverb);
    setIsCompressed(s.compress);
    setIsRemastered(s.remaster);

    await writeToEngine(`UPSCALE ${s.drive}`);
    await writeToEngine(`WIDEN ${s.widen}`);
    await writeToEngine(`3D ${s.spatial}`);
    await writeToEngine(`REVERB ${s.reverb}`);
    await writeToEngine(`COMPRESS ${s.compress ? 1 : 0}`);
    await writeToEngine(`REMASTER ${s.remaster ? 1 : 0}`);

    // CRITICAL FIX: The True Flat Bypass
    // FIR_GAINS.DEFAULT is actually [1.50, 0.79, 1.33]. It is a massive V-shape.
    // If the AI profile is bypassed, we MUST force absolute 1.0s.
    const baseGains = isProfileActiveRef.current 
        ? (FIR_GAINS[profile.id] ?? FIR_GAINS.DEFAULT) 
        : [1.0, 1.0, 1.0];
    
    const baseBass = baseGains[0];
    const baseMid = baseGains[1];
    const baseTreble = baseGains[2];

    let modB = 0, modM = 0, modT = 0;
    if (taste === 'QUALITY') {
      modB = 0.15; modM = 0.05; modT = 0.20; 
    } else if (taste === 'IMMERSIVE') {
      modB = 0.25; modM = -0.10; modT = 0.15; 
    } else if (taste === 'CHILL') {
      modB = 0.10; modM = 0.15; modT = -0.20; 
    }

    const finalBass = baseBass + modB;
    const finalMid = baseMid + modM;
    const finalTreble = baseTreble + modT;

    setIsFIRMode(true);

    await writeToEngine(`FIRMODE 1`); 
    await writeToEngine(`FIRGAIN ${finalBass.toFixed(3)} ${finalMid.toFixed(3)} ${finalTreble.toFixed(3)}`);
  };


  const handleTasteChange = async (taste:Taste) => {
    const newTaste=(smartTaste===taste)?'ORIGINAL':taste;
    setSmartTaste(newTaste);smartTasteRef.current=newTaste;
    if(isManualOverride){setIsManualOverride(false);setSelectedAcousticEnv('NONE');await writeToEngine(`LOAD_IR `);await writeToEngine(`CONVOLUTION 0.0`);}
    if(detectedProfileRef.current) await applySmartSettings(detectedProfileRef.current,newTaste);
    else if(newTaste==='ORIGINAL'){
      setUpscaleDrive(0);setWidenWidth(1.0);setSpatialExtra(0);setReverbWet(0);setIsCompressed(false);setIsRemastered(false);
      await writeToEngine(`UPSCALE 0`);await writeToEngine(`WIDEN 1.0`);await writeToEngine(`3D 0`);await writeToEngine(`REVERB 0`);await writeToEngine(`COMPRESS 0`);await writeToEngine(`REMASTER 0`);
    }
  };

  const handleToggleShuffle = useCallback((e?:React.MouseEvent) => {
    if(e) e.stopPropagation();
    const next=!isShuffle; setIsShuffle(next);
    if(next){
      const {displayedTracks:list,currentTrack:track}=stateRefs.current;
      let activeQueue=list;
      if(track&&activeQueue.findIndex(t=>t.path===track.path)===-1) activeQueue=playlistRef.current;
      let paths=activeQueue.map(t=>t.path);
      for(let i=paths.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[paths[i],paths[j]]=[paths[j],paths[i]];}
      if(track){paths=paths.filter(p=>p!==track.path);paths.unshift(track.path);}
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
    if(!playlistRef.current.length||!track) return;
    if(playHistoryRef.current.length>0){const prevPath=playHistoryRef.current.pop();const prevTrack=playlistRef.current.find(t=>t.path===prevPath);if(prevTrack){playTrack(prevTrack);return;}}
    let activeQueue=list,i=activeQueue.findIndex(t=>t.path===track.path);
    if(i===-1){activeQueue=playlistRef.current;i=activeQueue.findIndex(t=>t.path===track.path);}
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

  const scanAndAdd = async (folderPath:string) => {
    setIsLoading(true); setScanProgress('Scanning…');
    if(IS_ANDROID){
      try { await invoke('scan_android_music',{folderPath}); }
      catch(e){ console.error(e); setIsLoading(false); setScanProgress('Scan failed.'); }
      return;
    }
    try {
      let filePaths:string[]=[];
      if(folderPath==='ALL') filePaths=await invoke<string[]>('scan_mobile_audio');
      else filePaths=await invoke<string[]>('scan_directory',{path:folderPath});
      if(!filePaths?.length){setScanProgress('No audio files found');setTimeout(()=>setScanProgress(''),2500);return;}
      const existing=new Set(playlistRef.current.map(t=>t.path));
      const newTracks:Track[]=filePaths.filter(p=>!existing.has(p)).map(fullPath=>{
        const fileName=fullPath.split(/[/\\]/).pop()||'Unknown';
        const cleanName=stripExt(fileName).replace(/9convert\.com\s*-\s*/i,'').replace(/\[PagalWorld\.com\]/i,'').replace(/\(Pagalworld\.mobi\)/i,'').trim();
        return {name:cleanName,path:fullPath,artist:'Unknown Artist',album:'Unknown Album',year:'-',quality:'-',duration:0};
      });
      setScanProgress(`Found ${newTracks.length} new tracks — loading metadata…`);
      const merged=[...playlistRef.current,...newTracks].sort((a,b)=>a.name.localeCompare(b.name));
      setPlaylist(merged);
      for(const t of newTracks){try{await invoke('add_to_library',{track:t});}catch(e){console.error(e);}}
      setTimeout(()=>enrichMetadataInBackground(merged),400);
    } finally { setIsLoading(false); }
  };

  const handleAddFolder = () => {
    if(IS_MOBILE) setShowFolderModal(true);
    else open({directory:true,multiple:false}).then(sel=>{if(sel&&typeof sel==='string') scanAndAdd(sel);});
  };
  // ====================================================================
  // THE NUCLEAR OPTION: Wipe the entire library
  // ====================================================================
  const handleClearLibrary = async () => {
    if (!confirm("WARNING: Are you absolutely sure you want to wipe your entire library? This will delete all tracks, custom playlists, and play history. This cannot be undone.")) return;
    
    setIsLoading(true);
    setScanProgress('Annihilating database...');
    
    try {
      // Tell the Rust backend to drop the database tables
      // NOTE: You must ensure you have a 'clear_library' command in your Rust backend!
      await invoke('clear_library'); 
    } catch (e) {
      console.error("Backend clear failed. Wiping frontend state anyway.", e);
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

  const enrichMetadataInBackground = useCallback(async (tracks:Track[]) => {
    if(enricherRunning.current) return;
    enricherRunning.current=true;
    const needsEnrich=tracks.filter(t=>!t.metadataLoaded);
    if(!needsEnrich.length){enricherRunning.current=false;return;}
    setScanProgress(`Loading metadata for ${needsEnrich.length} tracks…`);
    let enriched=0;
    
    for(const track of needsEnrich){
      if(!enricherRunning.current) break;
      
      try {
        let meta;
        let thumbPath = track.thumb;

        const uniqueString = (meta?.common?.album || track.album || 'unknown') + "_" + (meta?.common?.title || track.name);
        const safeAlbum = uniqueString.replace(/[^a-z0-9]/gi, '_');

        if (IS_ANDROID) {
            // ==============================================================
            // ANDROID ONLY: 256KB buffer, JS ignores images, Rust extracts
            // ==============================================================
            const raw = await invoke<string>('read_file_head', { path: track.path, maxBytes: 256000 });
            const bin = atob(raw);
            const uint8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) uint8[i] = bin.charCodeAt(i);
            
            meta = await mm.parseBuffer(uint8, { mimeType: getMime(track.path) }, { skipCovers: true });
            
            if (!thumbPath) {
                try {
                    const rustExtractedPath = await invoke<string>('extract_and_cache_art', { path: track.path, safeAlbum: safeAlbum });
                    if (rustExtractedPath) thumbPath = convertFileSrc(rustExtractedPath);
                } catch (e) { /* Suppress Symphonia missing feature spam */ }
            }
        } else {
            // ==============================================================
            // WINDOWS ONLY: 5MB buffer, JS extraction (UNTOUCHED)
            // ==============================================================
            const raw = await invoke<string>('read_file_head', { path: track.path, maxBytes: 5242880 });
            const bin = atob(raw);
            const uint8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) uint8[i] = bin.charCodeAt(i);
            
            meta = await mm.parseBuffer(uint8, { mimeType: getMime(track.path) });
            
            if (!thumbPath && meta.common.picture?.length) {
                try {
                    const pic = meta.common.picture[0];
                    const ext = pic.format.includes('png') ? 'png' : 'jpg';
                    const fileName = `art_${safeAlbum}.${ext}`;
                    
                    const fullPath = await invoke<string>('save_art_to_cache', { fileName: fileName, data: Array.from(new Uint8Array(pic.data)) });
                    thumbPath = convertFileSrc(fullPath);
                } catch (e) { console.error("Rust Disk cache error:", e); }
            }
        }
        
        // THE SPLIT SCANNER: Check Vault on Android, Disk on PC
        let localLyrics = track.lyrics || [];
        try {
          let lrcContent = null;
          if (IS_ANDROID) {
            lrcContent = await vaultGet(`lrc_${track.path}`);
          } else {
            const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
            lrcContent = await readTextFile(lrcPath);
          }
          
          if (lrcContent && typeof lrcContent === 'string') {
            localLyrics = parseLRC(lrcContent);
          }
        } catch(e) {}
          const updatedTrack = {
          ...track,
          name: meta.common.title || track.name,
          artist: meta.common.artist || track.artist,
          album: meta.common.album || track.album,
          year: meta.common.year?.toString() || track.year,
          quality: meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality,
          duration: meta.format.duration || track.duration,
          metadataLoaded: true,
          genre: meta.common.genre?.[0] || track.genre || '',
          thumb: thumbPath, /* <-- CRITICAL FIX: This was crashing the scanner */
          lyrics: localLyrics
        };        
        
        setPlaylist(prev => prev.map(t => t.path === track.path ? updatedTrack : t));
        playlistRef.current = playlistRef.current.map(t => t.path === track.path ? updatedTrack : t);
        
        // PREVENT DB SPAM: Save to DB if text changed, OR if we just marked a raw track as loaded
        if (!track.metadataLoaded || track.name !== updatedTrack.name || track.artist !== updatedTrack.artist || track.album !== updatedTrack.album) {
            await invoke('add_to_library', { track: updatedTrack });
        }
      } catch(err) {
        console.error(`METADATA CRASH [${track.name}]:`, err);
        setPlaylist(prev=>prev.map(t=>t.path===track.path?{...t,metadataLoaded:true}:t));
      }
      
      enriched++;
      if(enriched%3===0) setScanProgress(`Loading metadata… ${Math.round((enriched/needsEnrich.length)*100)}%`);
      
      // THE FIX: Do not use requestAnimationFrame! It fires 60 times a second.
      // We force a 150ms delay between tracks to give the Chromium Garbage Collector 
      // time to clear the RAM before fetching the next 500KB file.
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    setScanProgress('');
    enricherRunning.current=false;
  }, []);


  useEffect(()=>{
    const needsWork=playlist.some(t=>!t.metadataLoaded);
    if(needsWork&&!enricherRunning.current) setTimeout(()=>enrichMetadataInBackground(playlistRef.current),800);
  },[playlist.length]);

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
        await invoke('audio_command',{cmd:`LOAD ${track.path}`});
        await new Promise(r=>setTimeout(r,150));
        const fpLine:string=await invoke('analyze_current_track');
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
    try { await writeToEngine('STOP'); } catch (_) {}
    const oldTrack=stateRefs.current.currentTrack;const listened=currentTimeRef.current;
    if(oldTrack&&listened>0&&oldTrack.path!==track.path){
      setPlaylist(prev=>{
        const nextList=prev.map(t=>t.path===oldTrack.path?{...t,playCount:listened>=5?(t.playCount||0)+1:(t.playCount||0),totalSecondsListened:(t.totalSecondsListened||0)+Math.floor(listened)}:t);
        vaultSet("user_playlist", nextList);
        return nextList;
      });
    }
    currentTimeRef.current=0;lastCountedTrackRef.current=null;
    const id=++loadIdRef.current;
    setCurrentTrack(track);setIsPlaying(false);setCurrentTime(0);setTrackTitle(track.name);setTrackArtist(track.artist);
    setDetectedProfile(null);detectedProfileRef.current=null;setLyrics(track.lyrics?.length?track.lyrics:[]);
    setAlbumArt(prev=>{if(prev) URL.revokeObjectURL(prev);return null;});
    try{
      await Promise.all([
        writeToEngine(`VOLUME ${volumeRef.current}`),writeToEngine('REMASTER 0'),writeToEngine('COMPRESS 0'),
        writeToEngine('UPSCALE 0'),writeToEngine('WIDEN 1.0'),writeToEngine('3D 0'),writeToEngine('REVERB 0'),
        writeToEngine(`BASS ${bassLevelRef.current}`),
        writeToEngine(`LIMITER ${speakerModeRef.current==='NONE'?0:speakerModeRef.current==='LOW'?0.3:speakerModeRef.current==='MED'?0.6:1.0}`),
        writeToEngine(`FIRGAIN ${FIR_GAINS.DEFAULT[0].toFixed(3)} ${FIR_GAINS.DEFAULT[1].toFixed(3)} ${FIR_GAINS.DEFAULT[2].toFixed(3)}`),
        writeToEngine(`ANDROID_SPEAKER ${isPhoneSpeakerRef.current ? 1 : 0}`)
      ]);
      if(id!==loadIdRef.current) return;
      await writeToEngine(`LOAD ${track.path}`);
      if(id!==loadIdRef.current) return;
      await writeToEngine('PLAY');setIsPlaying(true);

      setTimeout(async()=>{
        if(id!==loadIdRef.current) return;
        try{
          // 1. ELEVATED SCOPE: Declared here so they survive the OS branch
          let meta;
          let title = track.name;
          let artist = track.artist;

          if (IS_ANDROID) {
              // ==============================================================
              // ANDROID PIPELINE: 256KB buffer + Rust C++ Extractor
              // ==============================================================
              const raw = await invoke<string>('read_file_head', { path: track.path, maxBytes: 256000 });
              if (id !== loadIdRef.current) return;
              const bin = atob(raw);
              const fileData = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) fileData[i] = bin.charCodeAt(i);

              meta = await mm.parseBuffer(fileData, { mimeType: getMime(track.path) }, { skipCovers: true });
              if (id !== loadIdRef.current) return;
              
              title = meta.common.title || track.name; 
              artist = meta.common.artist || track.artist;
              setTrackTitle(title); setTrackArtist(artist);
              
              const uniqueString = (meta.common.album || track.album || 'unknown') + "_" + title;
              const safeAlbum = uniqueString.replace(/[^a-z0-9]/gi, '_');

              try {
                  const rustExtractedPath = await invoke<string>('extract_and_cache_art', { path: track.path, safeAlbum: safeAlbum });
                  if (rustExtractedPath) {
                      // THE CORS FIX: Read the file natively into a Blob to bypass Canvas security
                      const imgData = await readFile(rustExtractedPath);
                      const blob = new Blob([imgData], { type: 'image/jpeg' });
                      const imgUrl = URL.createObjectURL(blob);
                      
                      if(id !== loadIdRef.current) return;
                      setAlbumArt(imgUrl);
                      
                      try{
                        const [facColor, palette] = await Promise.all([
                          fac.getColorAsync(imgUrl, { algorithm: 'dominant' }).catch(() => null),
                          getPalette(imgUrl)
                        ]);
                        if(id === loadIdRef.current){
                          setBlobColors(palette);
                          const dom = (facColor && !facColor.error) ? facColor.hex : (palette[1] || '#c8222a');
                          setThemeColor(dom);
                          setThemeText(isHexDark(dom) ? '#ffffff' : '#111111');
                        }
                      }catch(_){}
                  }
              } catch(e) { /* Suppress Symphonia missing feature spam */ }

          } else {
              // ==============================================================
              // WINDOWS PIPELINE: 5MB buffer + JS extraction (UNTOUCHED)
              // ==============================================================
              const raw = await invoke<string>('read_file_head', { path: track.path, maxBytes: 5242880 });
              if (id !== loadIdRef.current) return;
              const bin = atob(raw);
              const fileData = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) fileData[i] = bin.charCodeAt(i);

              meta = await mm.parseBuffer(fileData, { mimeType: getMime(track.path) });
              if (id !== loadIdRef.current) return;
              
              title = meta.common.title || track.name; 
              artist = meta.common.artist || track.artist;
              setTrackTitle(title); setTrackArtist(artist);
              
              if(meta.common.picture?.length){
                const pic = meta.common.picture[0];
                const uniqueString = (meta.common.album || track.album || 'unknown') + "_" + title;
                const safeAlbum = uniqueString.replace(/[^a-z0-9]/gi, '_');
                const ext = pic.format.includes('png') ? 'png' : 'jpg';
                const fileName = `art_${safeAlbum}.${ext}`;
                
                try {
                    await invoke<string>('save_art_to_cache', { fileName: fileName, data: Array.from(new Uint8Array(pic.data)) });
                } catch(e) { console.error("Windows disk cache failed:", e); }
                
                const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' });
                const imgUrl = URL.createObjectURL(blob);
                if(id !== loadIdRef.current) return;
                
                setAlbumArt(imgUrl);
                
                try{
                  const [facColor, palette] = await Promise.all([
                    fac.getColorAsync(imgUrl, { algorithm: 'dominant' }).catch(() => null),
                    getPalette(imgUrl)
                  ]);
                  if(id === loadIdRef.current){
                    setBlobColors(palette);
                    const dom = (facColor && !facColor.error) ? facColor.hex : (palette[1] || '#c8222a');
                    setThemeColor(dom);
                    setThemeText(isHexDark(dom) ? '#ffffff' : '#111111');
                  }
                }catch(_){}
              }
          }


          // 2. SHARED LOGIC: LRC Loader and DB Sync (Uses elevated title/artist)
          try {
            let lrcText = null;
            if (IS_ANDROID) {
              lrcText = await vaultGet(`lrc_${track.path}`);
            } else {
              const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
              lrcText = await readTextFile(lrcPath);
            }
            if (id === loadIdRef.current && lrcText && typeof lrcText === 'string') {
               setLyrics(parseLRC(lrcText));
            }
          } catch (_) {}
          
          if(title!==track.name||artist!==track.artist||(meta.format.duration&&meta.format.duration!==track.duration)){
            const upd:Track={...track,name:title,artist,album:meta.common.album||track.album,year:meta.common.year?.toString()||track.year,quality:meta.format.bitrate?`${Math.round(meta.format.bitrate/1000)} kbps`:track.quality,duration:meta.format.duration||track.duration, thumb: track.thumb};
            setPlaylist(playlistRef.current.map(t=>t.path===track.path?upd:t));
            invoke('add_to_library', { track: upd }).catch(console.error);
          }
        } catch(err) {
            console.error(`GLOBAL METADATA CRASH:`, err);
        }
      },300);

      const cachedProfile=track.profile?PROFILES.find(p=>p.id===track.profile):null;
      if(cachedProfile){setDetectedProfile(cachedProfile);detectedProfileRef.current=cachedProfile;await applySmartSettings(cachedProfile,smartTasteRef.current);}
      else{setTimeout(async()=>{
        if(id!==loadIdRef.current) return;setIsAnalyzing(true);
        try{
          const fpLine:string=await invoke('analyze_current_track');if(id!==loadIdRef.current) return;
          if(fpLine.startsWith("FINGERPRINT ")){
            const parts=fpLine.split(' ');
            const profile=classifyAudio(parseFloat(parts[1])||0,parseFloat(parts[2])||10,parseFloat(parts[3])||0.1,parseFloat(parts[4])||0.1);
            setDetectedProfile(profile);detectedProfileRef.current=profile;await applySmartSettings(profile,smartTasteRef.current);
            const upd={...track,profile:profile.id};const nl=playlistRef.current.map(t=>t.path===track.path?upd:t);setPlaylist(nl);
            vaultSet("user_playlist", nl);          }
        }catch(_){}finally{setIsAnalyzing(false);}
      },2000);}
    }catch(_){if(id===loadIdRef.current){try{await writeToEngine(`LOAD ${track.path}`);await writeToEngine('PLAY');setIsPlaying(true);}catch(_){}}}
  };
//AIzaSyAoOyi6NwaoVzcSIplFsTk3zHopfCl0WWg

  const finalizeLyrics = async (track: Track, lrc: string) => {
    const parsed = parseLRC(lrc);
    setLyrics(parsed);
    setPlaylist(prev => prev.map(t => t.path === track.path ? { ...t, lyrics: parsed } : t));

    try {
      if (IS_ANDROID) {
        await vaultSet(`lrc_${track.path}`, lrc);
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
    const updated = [...customPlaylists, newPl];
    setCustomPlaylists(updated);
    await vaultSet("user_playlists", updated);
  };

  const deletePlaylist = async (id: string) => {
    if (!confirm("Delete this playlist?")) return;
    const updated = customPlaylists.filter(pl => pl.id !== id);
    setCustomPlaylists(updated);
    await vaultSet("user_playlists", updated);
    // If they delete the playlist they are currently looking at, kick them back to the gallery
    if (currentView === `PLAYLIST_${id}`) setCurrentView('PLAYLIST_GALLERY');
  };


  const addToPlaylist = async (playlistId:string) => {
    const updated=customPlaylists.map(pl=>pl.id===playlistId?{...pl,trackPaths:[...pl.trackPaths,...playlistModalTracks.filter(p=>!pl.trackPaths.includes(p))]}:pl);
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
    try{if(isPlaying){await writeToEngine('PAUSE');setIsPlaying(false);}else{await writeToEngine('PLAY');setIsPlaying(true);}}catch(_){}
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
          spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra}
          reverbWet={reverbWet} setReverbWet={setReverbWet}
          setIsManualOverride={setIsManualOverride} setSmartTaste={setSmartTaste}
          setBassLevel={setBassLevel} writeToEngine={writeToEngine}
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
                      currentView.startsWith('ARTIST_') ? 'ARTISTS' :
                      currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' : 
                      currentView;

  // MASSIVE HEADER RESOLVER
  const headerInfo = useMemo(() => {
    if (currentView === 'FAVORITES') return { type: 'FAVOURITES', title: 'Favourite Tracks', subtitle: `${displayedTracks.length} tracks`, isCircle: false, image: null, isMassive: true };
    if (currentView === 'TOPTRACKS') return { type: 'MOST PLAYED', title: 'Top Ranked Tracks', subtitle: `${displayedTracks.length} tracks by listen time`, isCircle: false, image: null, isMassive: true };
    if (activeArtistName) return { type: 'ARTIST', title: activeArtistName, subtitle: `${displayedTracks.length} tracks`, isCircle: true, image: null, isMassive: true };
    if (activePlaylistId) {
      const pl = customPlaylists.find(p=>p.id === activePlaylistId);
      return { type: 'PLAYLIST', title: pl?.name || 'Unknown', subtitle: `${displayedTracks.length} tracks`, isCircle: false, image: null, isMassive: true };
    }
    // For albums we use the old logic or we can use headerInfo but not massive
    if (activeAlbumName) return { type: 'ALBUM', title: activeAlbumName, subtitle: `${displayedTracks.length} tracks • ${displayedTracks[0]?.artist || 'Unknown'}`, isCircle: false, image: displayedTracks.find(t => t.thumb)?.thumb || (currentTrack?.album === activeAlbumName ? albumArt : null), isMassive: false };
    return null;
  }, [currentView, activeArtistName, activeAlbumName, activePlaylistId, displayedTracks, customPlaylists, albumArt, currentTrack]);

  return (
    <div className={`app-layout ${visMode === 'RADAR' ? 'radar-mode' : ''}`} data-platform={IS_ANDROID ? 'android' : 'desktop'} data-theme={isDarkMode?'dark':'light'} style={{'--theme-color':themeColor,'--theme-text':themeText,'--blob-1':blobColors[0],'--blob-2':blobColors[1],'--blob-3':blobColors[2],'--audio-level':audioLevel} as React.CSSProperties}>
      
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
          isLoading={isLoading}
          mobileSearchOpen={mobileSearchOpen} setMobileSearchOpen={setMobileSearchOpen}
          toggleTheme={toggleTheme}
          onOpenSettings={() => {}}
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
            {scanProgress}
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
          <div className="samsung-track-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
            
            {/* 1. HIGHEST PRIORITY: PLAYLIST GALLERY */}
            {currentView === 'PLAYLIST_GALLERY' ? (
              <PlaylistGalleryView 
                playlist={playlist} favoritesSet={favoritesSet} customPlaylists={customPlaylists} albumArt={albumArt}
                setCurrentView={setCurrentView} createPlaylist={createPlaylist} deletePlaylist={deletePlaylist}
              />
            ) : currentView === 'ARTISTS' ? (
              <ArtistGalleryView playlist={playlist} setCurrentView={setCurrentView} />
            ) : currentView === 'ALBUMS' ? (
              /* 2. THE NEW BENTO BOX ALBUM GRID */
              <AlbumGalleryView playlist={playlist} setCurrentView={setCurrentView}/>
              
            ) : displayedTracks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎵</div>
                <p className="empty-title">{searchQuery?'No results found':'No music yet'}</p>
                <p className="empty-hint">{searchQuery?'Try a different search term':IS_MOBILE?'Tap the + button to add your music folders':'Click the + button in the top right'}</p>
                {!searchQuery&&IS_MOBILE&&<button className="empty-add-btn" onClick={handleAddFolder}>+ Add Music Folder</button>}
              </div>

            ) : (
              <>
                {/* 1. THE UNIFIED MASSIVE HEADER */}
                {headerInfo && displayedTracks.length > 0 && (
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
                        <button className="play-all-btn" style={{ flex: IS_ANDROID ? 1 : undefined, justifyContent: 'center', background: 'var(--theme-color)', color: 'var(--theme-text)', boxShadow: '0 4px 20px rgba(255,50,50,0.4)', border: 'none', padding: '12px 24px', borderRadius: '30px', fontWeight: 700, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => playTrack(displayedTracks[0])}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play All
                        </button>
                        <button className="back-albums-btn" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '12px 24px', borderRadius: '30px', fontWeight: 600, fontSize: '15px', cursor: 'pointer' }} onClick={() => window.history.back()}>
                          ← Back
                        </button>                      
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. THE SELECTION & SORT BAR */}
                {!searchQuery && displayedTracks.length > 0 && (
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
                        {!IS_ANDROID && <button className="dsp-btn" style={{marginRight: 'auto'}} onClick={()=>setIsSelectionMode(true)}>☑ Select Multiple</button>}
                        {(!activePlaylistId && !activeAlbumName && currentView !== 'TOPTRACKS') && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                            {!IS_ANDROID && <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sort By:</span>}
                            <div onClick={(e) => { e.stopPropagation(); setIsSortDropdownOpen(!isSortDropdownOpen); }} style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', minWidth: IS_ANDROID ? 'auto' : '120px', justifyContent: 'space-between', transition: 'background 0.2s' }}>
                              <span>{sortMode === 'TITLE' ? 'Title (A-Z)' : sortMode === 'ARTIST' ? 'Artist (A-Z)' : sortMode === 'ALBUM' ? 'Album (A-Z)' : 'Year (Newest)'}</span>
                              <span style={{ fontSize: '10px', opacity: 0.6 }}>▼</span>
                            </div>
                            {isSortDropdownOpen && (
                              <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setIsSortDropdownOpen(false)} />
                                <div className="glass-options-menu fade-in" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 99, marginTop: '8px', padding: '6px', width: '160px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                                  {['TITLE', 'ARTIST', 'ALBUM', 'YEAR'].map(mode => (
                                    <div key={mode} style={{ padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', background: sortMode === mode ? 'rgba(255,255,255,0.15)' : 'transparent', transition: 'background 0.2s' }} onClick={() => { setSortMode(mode as any); setIsSortDropdownOpen(false); }}>
                                      {mode === 'TITLE' ? 'Title (A-Z)' : mode === 'ARTIST' ? 'Artist (A-Z)' : mode === 'ALBUM' ? 'Album (A-Z)' : 'Year (Newest)'}
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
                ) : activeAlbumName ? (
                  
                  /* ============================================================== */
                  /* THE FLAT LIST BOMB: Virtualization destroyed for Albums        */
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
                        {/* Track Number / Playing Indicator */}
                        <div style={{ width: '30px', textAlign: 'center', color: currentTrack?.path === track.path ? 'var(--theme-color)' : 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>
                          {currentTrack?.path === track.path ? '▶' : index + 1}
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

          {/* 2. Expanded Player: Fully painted in the background on boot. Zero layout math on click. */}
          <div className="expanded-player-content" style={{ 
            opacity: isExpanded ? 1 : 0, 
            pointerEvents: isExpanded ? 'auto' : 'none',
            visibility: isExpanded ? 'visible' : 'hidden', 
            position: 'absolute', /* <-- CRITICAL FIX: NEVER TOGGLE THIS TO RELATIVE */
            top: 0,
            left: 0,
            height: '100%',
            width: '100%',
            transition: 'opacity 0.3s ease',
            zIndex: 2
          }}>
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
                    {React.createElement(detectedProfile.icon as any, {size: 16})} {detectedProfile.label} {!isProfileActive && '(Raw)'}
                  </div>
                )}
                <button className={`ep-icon-btn ${showOptionsMenu?'active-glow':''}`} onClick={e=>{e.stopPropagation();setShowOptionsMenu(!showOptionsMenu);}}>⋮</button>
                {showOptionsMenu&&(
                  <>
                    <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:99}} onClick={e=>{e.stopPropagation();setShowOptionsMenu(false);}}/>
                    <div className="glass-options-menu fade-in" onClick={e=>e.stopPropagation()}>
                      <div className="glass-menu-header">Track Options</div>
                      <div className="glass-menu-section">
                        <div className="glass-label-row"><span>Subwoofer Bass</span><span style={{color:'var(--theme-color)',fontWeight:600}}>{Math.round(bassLevel*100)}%</span></div>
                        <input type="range" className="glass-slider" min="0" max="1.5" step="0.05" value={bassLevel} onChange={e=>{const v=parseFloat(e.target.value);setBassLevel(v);bassLevelRef.current=v;writeToEngine(`BASS ${v}`);}}/>
                      </div>
                      <div className="glass-menu-section" style={{marginTop:14}}>
                        <div className="glass-label-row" style={{marginBottom:10}}><span>Speaker Boost</span><span style={{color:speakerMode==='NONE'?'var(--text-secondary)':speakerMode==='LOW'?'#4fc3f7':speakerMode==='MED'?'#ff9800':'#ff3b30',fontWeight:600,fontSize:'0.8rem',transition:'color 0.2s'}}>{speakerMode==='NONE'?'Off':speakerMode==='LOW'?'30%':speakerMode==='MED'?'60%':'100%'}</span></div>
                        <div className="glass-boost-grid">
                          {(['NONE','LOW','MED','HIGH'] as const).map(mode=>(
                            <button key={mode} className={`glass-boost-btn ${speakerMode===mode?'active':''}`}
                              style={speakerMode===mode?{background:mode==='NONE'?'rgba(255,255,255,0.18)':mode==='LOW'?'rgba(79,195,247,0.25)':mode==='MED'?'rgba(255,152,0,0.25)':'rgba(255,59,48,0.28)',borderColor:mode==='NONE'?'rgba(255,255,255,0.35)':mode==='LOW'?'rgba(79,195,247,0.5)':mode==='MED'?'rgba(255,152,0,0.5)':'rgba(255,59,48,0.55)',color:mode==='NONE'?'#fff':mode==='LOW'?'#4fc3f7':mode==='MED'?'#ff9800':'#ff3b30'}:undefined}
                              onClick={()=>{setSpeakerMode(mode);writeToEngine(`LIMITER ${mode==='NONE'?0:mode==='LOW'?0.3:mode==='MED'?0.6:1.0}`);}}
                            >{mode==='NONE'?'None':mode==='LOW'?'Low':mode==='MED'?'Med':'High'}</button>
                          ))}
                        </div>
                      </div>
                      <div className="glass-menu-section" style={{marginTop:14}}>
                        <div className="glass-label-row" style={{marginBottom:10}}><span>Background Visualizer</span><span style={{color:'var(--text-secondary)',fontSize:'0.75rem'}}>{visMode==='ORBIT'?'Lava Lamps': (IS_ANDROID ? '🎱 8B Fast' : '📡 Spatial Radar')}</span></div>
                        <div className="glass-boost-grid">
                          <button className={`glass-boost-btn ${visMode==='ORBIT'?'active':''}`} style={visMode==='ORBIT'?{background:'rgba(255,255,255,0.18)',borderColor:'rgba(255,255,255,0.35)',color:'#fff'}:undefined} onClick={()=>setVisMode('ORBIT')}>🫧 Orbit</button>
                          <button className={`glass-boost-btn ${visMode==='RADAR'?'active':''}`} style={visMode==='RADAR'?{background:'rgba(200,34,42,0.25)',borderColor:'var(--theme-color)',color:'var(--theme-color)'}:undefined} onClick={()=>setVisMode('RADAR')}>{IS_ANDROID ? '🎱 8B' : '📡 Spatial'}</button>
                        </div>
                      </div>
                      <div className="glass-menu-section" style={{marginTop:14}}>
                        <div className="glass-label-row" style={{marginBottom:6}}><span>Audiophile EQ</span><span style={{fontSize:'0.72rem',fontWeight:600,color:isFIRMode?'#a5d6a7':'var(--text-secondary)',transition:'color 0.2s'}}>{isFIRMode?'✦ Linear Phase':'Standard IIR'}</span></div>
                        <p style={{fontSize:'0.7rem',color:'var(--text-secondary)',margin:'0 0 10px 0',lineHeight:1.4}}>Zero phase smearing on cymbals & hi-hats. Uses FIR convolution — sounds best on headphones.</p>
                        <div className="glass-boost-grid">
                          <button className={`glass-boost-btn ${!isFIRMode?'active':''}`} style={!isFIRMode?{background:'rgba(255,255,255,0.18)',borderColor:'rgba(255,255,255,0.35)',color:'#fff'}:undefined} onClick={()=>{setIsFIRMode(false);writeToEngine('FIRMODE 0');}}>Standard</button>
                          <button className={`glass-boost-btn ${isFIRMode?'active':''}`} style={isFIRMode?{background:'rgba(165,214,167,0.2)',borderColor:'#a5d6a7',color:'#a5d6a7'}:undefined} onClick={()=>{setIsFIRMode(true);writeToEngine('FIRMODE 1');}}>✦ Audiophile</button>
                        </div>
                        {/* NEW: HARDWARE OUTPUT TOGGLE */}
                      <div className="glass-menu-section" style={{marginTop:14}}>
                        <div className="glass-label-row" style={{marginBottom:10}}>
                          <span>Hardware Output</span>
                          <span style={{color:'var(--theme-color)',fontWeight:600,fontSize:'0.8rem'}}>
                            {isPhoneSpeaker ? (IS_ANDROID ? 'Phone Speaker' : 'Laptop Speaker') : 'Headphones'}
                          </span>
                        </div>
                        <div className="glass-boost-grid">
                          <button 
                            className={`glass-boost-btn ${!isPhoneSpeaker?'active':''}`}
                            style={!isPhoneSpeaker?{background:'rgba(255,255,255,0.18)',borderColor:'rgba(255,255,255,0.35)',color:'#fff'}:undefined}
                            onClick={()=>{
                              setIsPhoneSpeaker(false);
                              writeToEngine('ANDROID_SPEAKER 0');
                            }}
                          >
                            🎧 Headphones
                          </button>
                          
                          <button 
                            className={`glass-boost-btn ${isPhoneSpeaker?'active':''}`}
                            style={isPhoneSpeaker?{background:'rgba(255,59,48,0.28)',borderColor:'rgba(255,59,48,0.55)',color:'#ff3b30'}:undefined}
                            onClick={()=>{
                              setIsPhoneSpeaker(true);
                              writeToEngine('ANDROID_SPEAKER 1');
                            }}
                          >
                            📱 {IS_ANDROID ? 'Phone Speaker' : 'Laptop Speaker'}
                          </button>
                        </div>
                      </div>
                      </div>
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
                      <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:'16px'}}>
                        <p style={{margin:0, opacity:0.5, fontSize:'1.1rem'}}>No synced lyrics available.</p>
                        <button 
                          className="dsp-btn" 
                          style={{
                            padding:'10px 24px', 
                            borderRadius:'24px', 
                            background:'var(--theme-color)', 
                            color:'#fff', 
                            border:'none', 
                            fontWeight:600,
                            opacity: scanProgress ? 0.7 : 1,
                            pointerEvents: scanProgress ? 'none' : 'auto',
                            transition: 'all 0.2s',
                            maxWidth: '85%',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          onClick={async () => {
                            if (currentTrack) {
                              const lrc = await fetchLyricsOnline(currentTrack, setScanProgress);
                              if (lrc) finalizeLyrics(currentTrack, lrc);
                            }
                          }}
                        >
                          {scanProgress ? `⏳ ${scanProgress}` : '🔍 Fetch Lyrics Online'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {showStudio && (
                  <DSPStudio 
                    isRemastered={isRemastered} setIsRemastered={setIsRemastered} isCompressed={isCompressed} setIsCompressed={setIsCompressed}
                    selectedAcousticEnv={selectedAcousticEnv} setSelectedAcousticEnv={setSelectedAcousticEnv} isEnvDropdownOpen={isEnvDropdownOpen} setIsEnvDropdownOpen={setIsEnvDropdownOpen}
                    upscaleDrive={upscaleDrive} setUpscaleDrive={setUpscaleDrive} widenWidth={widenWidth} setWidenWidth={setWidenWidth}
                    spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra} reverbWet={reverbWet} setReverbWet={setReverbWet}
                    setIsManualOverride={setIsManualOverride} setSmartTaste={setSmartTaste} setBassLevel={setBassLevel} writeToEngine={writeToEngine}
                  />
                )}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;