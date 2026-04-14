import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import * as mm from "music-metadata";
import Marquee from "react-fast-marquee";
import { FastAverageColor } from "fast-average-color";
import "./App.css";

interface Track {
  name: string; path: string; artist: string; album: string;
  year: string; quality: string; duration: number;
  lyrics?: LyricLine[]; profile?: string;
  metadataLoaded?: boolean;
  genre?: string;               // <--- ADDED
  playCount?: number;           // <--- ADDED
  totalSecondsListened?: number; // <--- ADDED
  
}
interface LyricLine { time: number; text: string; }

type Taste   = 'QUALITY' | 'IMMERSIVE' | 'CHILL';
type NavView = 'ALL' | 'FAVORITES' | 'BOLLYWOOD' | 'TOPTRACKS';

interface DSPSettings { drive:number; widen:number; spatial:number; reverb:number; compress:boolean; remaster:boolean; }
interface AudioProfile { id:string; label:string; icon:string; description:string; settings:DSPSettings; }

const PROFILES: AudioProfile[] = [
  { id:'CLASSICAL', label:'Classical / Orchestral', icon:'🎻', description:'High dynamic range · Natural wide field',
    settings:{ drive:0.2, widen:1.25, spatial:0.08, reverb:0.10, compress:false, remaster:false } },
  { id:'BOLLYWOOD', label:'90s Bollywood Classics', icon:'🎙️', description:'Warm vintage analog · Vocals front & center',
    settings:{ drive:0.4, widen:1.12, spatial:0.05, reverb:0.05, compress:true, remaster:true } },
  { id:'VOCAL', label:'Vocal / Acoustic', icon:'🎤', description:'Center-heavy · Lead vocals protected',
    settings:{ drive:0.4, widen:1.10, spatial:0.05, reverb:0.04, compress:true, remaster:false } },
  { id:'ELECTRONIC', label:'Electronic / EDM', icon:'⚡', description:'Brickwall master · Exciter restores air',
    settings:{ drive:1.4, widen:1.25, spatial:0.08, reverb:0.04, compress:true, remaster:false } },
  { id:'HIPHOP', label:'Hip-Hop / R&B', icon:'🎧', description:'Punchy · Tight dynamics',
    settings:{ drive:1.0, widen:1.15, spatial:0.06, reverb:0.03, compress:true, remaster:true } },
  { id:'AMBIENT', label:'Ambient / Chill', icon:'🌊', description:'Low energy · Generous reverb space',
    settings:{ drive:0.1, widen:1.0, spatial:0.20, reverb:0.18, compress:false, remaster:false } },
  { id:'POP', label:'Pop / Standard', icon:'🎵', description:'Balanced mix · Universal profile',
    settings:{ drive:0.7, widen:1.20, spatial:0.07, reverb:0.06, compress:true, remaster:false } },
];

function classifyAudio(sc:number, cf:number, zcr:number, rms:number): AudioProfile {
  if (cf>18 && rms<0.08)              return PROFILES[5];
  if (cf>14 && sc>0.70 && zcr<0.08)   return PROFILES[0];
  if (sc>0.88 && cf>10 && zcr<0.05)   return PROFILES[1];
  if (sc>0.80 && cf>10)               return PROFILES[2];
  if (cf<8   && zcr>0.12)             return PROFILES[3];
  if (cf<11  && rms>0.18)             return PROFILES[4];
  return PROFILES[6];
}

function applyTaste(base:DSPSettings, taste:Taste): DSPSettings {
  const s = {...base};
  if (taste==='QUALITY') {
    s.drive=Math.min(2.0,base.drive+0.20); s.widen=Math.min(1.5,1.0+(base.widen-1.0)*0.60);
    s.spatial=0.0; s.reverb=Math.min(base.reverb,0.06);
  } else if (taste==='IMMERSIVE') {
    s.drive=Math.min(2.0,base.drive+0.12); s.widen=Math.min(1.5,base.widen+0.15);
    s.spatial=Math.min(0.35,base.spatial+0.08); s.reverb=Math.min(0.25,base.reverb+0.05);
  } else {
    s.drive=Math.min(2.0,base.drive*0.35); s.widen=1.0;
    s.spatial=Math.min(0.40,base.spatial+0.18); s.reverb=Math.min(0.30,base.reverb+0.12);
    s.compress=false;
  }
  return s;
}

const fac = new FastAverageColor();

const isHexDark = (hex:string) => {
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  return ((r*299)+(g*587)+(b*114))/1000 < 145;
};

const trackAccentColor = (name:string): string => {
  let h=0; for (const c of name) h=(h<<5)-h+c.charCodeAt(0);
  const pal=['#c8222a','#1565c0','#2e7d32','#e65100','#6a1b9a','#00838f','#c62828','#4527a0'];
  return pal[Math.abs(h)%pal.length];
};

const getPalette = (imgUrl:string): Promise<string[]> =>
  new Promise(resolve => {
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement("canvas"); c.width=img.width; c.height=img.height;
      const ctx=c.getContext("2d"); if(!ctx) return resolve(['#c8222a','#8a1520','#6a1018']);
      ctx.drawImage(img,0,0);
      const hex=(x:number,y:number)=>{const d=ctx.getImageData(x,y,1,1).data;return "#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');};
      resolve([hex(Math.floor(img.width*0.2),Math.floor(img.height*0.2)),hex(Math.floor(img.width*0.5),Math.floor(img.height*0.5)),hex(Math.floor(img.width*0.8),Math.floor(img.height*0.8))]);
    };
    img.onerror=()=>resolve(['#c8222a','#8a1520','#6a1018']);
    img.src=imgUrl;
  });

const getMime = (p:string) => p.endsWith('.wav')?'audio/wav':p.endsWith('.flac')?'audio/flac':p.endsWith('.ogg')?'audio/ogg':(p.endsWith('.aac')||p.endsWith('.m4a'))?'audio/aac':'audio/mpeg';
const stripExt = (n:string) => n.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i,'');
const parseLRC = (text:string): LyricLine[] => {
  const lines:LyricLine[]=[];
  const re=/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
  for (const line of text.split('\n')){const m=re.exec(line);if(m){const txt=line.replace(/\[.*?\]/g,'').trim();if(txt)lines.push({time:parseInt(m[1])*60+parseFloat(m[2]),text:txt});}}
  return lines.sort((a,b)=>a.time-b.time);
};

const TrackRow = memo(({ track, isActive, albumArt, isFav, onPlay, formatTime, style }: {
  track: Track; isActive: boolean; albumArt: string | null;
  isFav: boolean; onPlay: () => void; formatTime: (s:number)=>string;
  style?: React.CSSProperties;
}) => {
  const profileData = PROFILES.find(p => p.id === track.profile);
  return (
    <li
      className={`track-item ${isActive ? 'active' : ''}`}
      style={{ '--track-color': trackAccentColor(track.name), ...style } as React.CSSProperties}
      onClick={onPlay}
    >
      <div className="track-cell title-cell">
        <div className="track-item-icon">
          {isActive && albumArt
            ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
            : <span>{profileData?.icon ?? '🎵'}</span>
          }
        </div>
        <div className="track-item-details">
          <span className="track-item-name">
            {isFav && <span className="fav-dot">♥ </span>}
            {track.name}
          </span>
          <span className="track-item-artist">
            {track.artist}
            {track.profile && <span className="track-profile-icon">{profileData?.icon}</span>}
          </span>
        </div>
      </div>
      <div className="track-cell hide-mobile">{track.album}</div>
      <div className="track-cell hide-mobile">{track.year}</div>
      <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
      <div className="track-cell time-cell">{track.duration ? formatTime(track.duration) : '--:--'}</div>
    </li>
  );
});

const ITEM_HEIGHT = 72;
const OVERSCAN    = 8;

const VirtualList = memo(({ tracks, currentTrackPath, albumArt, favorites, onPlay, formatTime }: {
  tracks: Track[];
  currentTrackPath: string | undefined;
  albumArt: string | null;
  favorites: string[];
  onPlay: (track: Track) => void;
  formatTime: (s: number) => string;
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setViewHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const totalHeight = tracks.length * ITEM_HEIGHT;
  const startIdx    = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIdx      = Math.min(tracks.length, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + OVERSCAN);
  const visibleTracks = tracks.slice(startIdx, endIdx);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div ref={containerRef} className="virtual-scroll-container" onScroll={handleScroll}>
      <ul className="track-list" style={{ height: totalHeight, position: 'relative' }}>
        {visibleTracks.map((track, i) => {
          const realIdx = startIdx + i;
          return (
            <TrackRow
              key={track.path}
              track={track}
              isActive={currentTrackPath === track.path}
              albumArt={albumArt}
              isFav={favorites.includes(track.path)}
              onPlay={() => onPlay(track)}
              formatTime={formatTime}
              style={{ position: 'absolute', top: realIdx * ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT }}
            />
          );
        })}
      </ul>
    </div>
  );
});

const FolderModal = memo(({ onClose, onScan }: { onClose:()=>void; onScan:(path:string)=>void }) => {
  const commonFolders = [
    { label: '🎵 Music', path: '/storage/emulated/0/Music' },
    { label: '⬇️ Downloads', path: '/storage/emulated/0/Download' },
    { label: '📁 Downloads (alt)', path: '/storage/emulated/0/Downloads' },
    { label: '📱 Internal Storage', path: '/storage/emulated/0' },
    { label: '💾 SD Card', path: '/storage/sdcard1/Music' },
    { label: '🗂️ SD Card Root', path: '/storage/sdcard1' },
  ];
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" onClick={e => e.stopPropagation()}>
        <div className="folder-modal-header">
          <h2>Choose Music Folder</h2>
          <button className="folder-modal-close" onClick={onClose}>×</button>
        </div>
        <p className="folder-modal-hint">Tap a folder to scan it. All audio files inside will be added to your library.</p>
        <div className="folder-modal-list">
          {commonFolders.map(f => (
            <button key={f.path} className="folder-modal-item" onClick={() => { onScan(f.path); onClose(); }}>
              <span className="folder-modal-icon">{f.label.split(' ')[0]}</span>
              <div>
                <div className="folder-modal-name">{f.label.slice(f.label.indexOf(' ')+1)}</div>
                <div className="folder-modal-path">{f.path}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="folder-modal-footer">
          <button className="folder-modal-scan-all" onClick={() => { onScan('ALL'); onClose(); }}>
            📂 Scan All Common Folders
          </button>
        </div>
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
function App() {
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showFolderModal, setShowFolderModal]   = useState(false);

  const [albumArt, setAlbumArt]             = useState<string | null>(null);
  const [trackTitle, setTrackTitle]         = useState('Ready');
  const [trackArtist, setTrackArtist]       = useState('DmeX Player');
  const [themeColor, setThemeColor]         = useState('#c8222a');
  const [themeText, setThemeText]           = useState('#ffffff');
  const [blobColors, setBlobColors]         = useState(['#c8222a','#8a1520','#6a1018']);
  const [lyrics, setLyrics]                 = useState<LyricLine[]>([]);
  const [isExpanded, setIsExpanded]         = useState(false);
  const [showLyrics, setShowLyrics]         = useState(false);
  const [showStudio, setShowStudio]         = useState(false);
  const [showDSPPage, setShowDSPPage]       = useState(false);
  const [isDarkMode, setIsDarkMode]         = useState(true);
  const [volume, setVolume]                 = useState(1.0);
  const [isRemastered, setIsRemastered]     = useState(false);
  const [isCompressed, setIsCompressed]     = useState(false);
  const [upscaleDrive, setUpscaleDrive]     = useState(0.0);
  const [widenWidth, setWidenWidth]         = useState(1.0);
  const [spatialExtra, setSpatialExtra]     = useState(0.0);
  const [reverbWet, setReverbWet]           = useState(0.0);
  const [smartTaste, setSmartTaste]         = useState<Taste>('QUALITY');
  const [detectedProfile, setDetectedProfile] = useState<AudioProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing]       = useState(false);

  const [bulkScanActive, setBulkScanActive] = useState(false);
  const [bulkScanPaused, setBulkScanPaused] = useState(false);
  const [bulkScanDone, setBulkScanDone]     = useState(0);
  const [bulkScanTotal, setBulkScanTotal]   = useState(0);
  const [isBulkScanOpen, setIsBulkScanOpen] = useState(false);
  const [isLimiterOn, setIsLimiterOn]       = useState(false);
  const [limiterIntensity, setLimiterIntensity] = useState(0.5);
  

  // Shuffle & Repeat States
  const [isShuffle, setIsShuffle]     = useState(false);
  const [shuffledQueue, setShuffledQueue] = useState<string[]>([]);
  const [repeatMode, setRepeatMode]   = useState<'OFF'|'ALL'|'ONE'>('OFF');
  const [repeatDeg, setRepeatDeg]     = useState(0);
  const [repeatBusy, setRepeatBusy]   = useState(false);
const [bassLevel, setBassLevel]           = useState(0.0);
const bassLevelRef                        = useRef(0.0);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);

  const smartTasteRef      = useRef<Taste>('QUALITY');
  const detectedProfileRef = useRef<AudioProfile | null>(null);
  const dbProcess          = useRef<any>(null);
  const loadIdRef          = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playlistRef        = useRef<Track[]>([]);
  const enricherRunning    = useRef(false);
  const bulkScanRunning    = useRef(false);
  const bulkScanPausedRef  = useRef(false);
  const lastCountedTrackRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  

  // Shuffle & Repeat Refs for callbacks
  const isShuffleRef       = useRef(false);
  const repeatModeRef      = useRef<'OFF'|'ALL'|'ONE'>('OFF');
  const shuffledQueueRef   = useRef<string[]>([]);
  const playHistoryRef     = useRef<string[]>([]);

  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);


  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (showFolderModal) { setShowFolderModal(false); return; }
      if (isBulkScanOpen) { setIsBulkScanOpen(false); return; }
      if (showDSPPage) { setShowDSPPage(false); return; }
      if (showLyrics || showStudio) { setShowLyrics(false); setShowStudio(false); return; }
      if (isExpanded) { setIsExpanded(false); return; }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isExpanded, showFolderModal, isBulkScanOpen, showDSPPage, showLyrics, showStudio]);

  useEffect(() => {
    if (isExpanded || showFolderModal || isBulkScanOpen) {
      window.history.pushState({ modal: true }, '');
    }
  }, [isExpanded, showFolderModal, isBulkScanOpen]);

  const displayedTracks = (() => {
    let base = playlist;
    if (currentView === 'FAVORITES') {
      base = playlist.filter(t => favorites.includes(t.path));
    } else if (currentView === 'BOLLYWOOD') {
      base = playlist.filter(t => {
        const textToSearch = `${t.genre || ''} ${t.album || ''} ${t.path}`.toLowerCase();
        return textToSearch.includes('bollywood') || textToSearch.includes('hindi') || textToSearch.includes('indian');
      });
    } else if (currentView === 'TOPTRACKS') {
      base = [...playlist]
        .filter(t => (t.playCount || 0) > 0)
        .sort((a,b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, 50); // Show top 50
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(t => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q));
    }
    return base;
  })();

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = useCallback(async (cmd:string) => {
    try { await invoke('audio_command', { cmd: cmd.trim() }); } catch (_) {}
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const store = await load("library.json", { autoSave: true, defaults: {} });
        dbProcess.current = store;
        const saved = await store.get<Track[]>("user_playlist");
        if (saved?.length) {
          playlistRef.current = saved;
          setPlaylist(saved);
        }
        const savedFavs = await store.get<string[]>("user_favorites");
        if (savedFavs) setFavorites(savedFavs);
        const savedDark = await store.get<boolean>("isDarkMode");
        if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
      } catch (err) { console.error(err); }
    }
    boot();
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (!isPlaying || isLoading) return;
      try {
          const m: [number,number,number,boolean] = await invoke('audio_metrics');
          setCurrentTime(m[0]);
          if (m[1] > 0) setDuration(m[1]);
          setAudioLevel(Math.min(1, m[2] * 3.5));
          
          // CRITICAL: Auto-pause UI catch-up.
          // C++ engine is already paused, this simply flips the React play/pause button state.
          if (m[3]) {
            setIsPlaying(false);
          }
        } catch (_) {}
    }, 250);
    return () => clearInterval(iv);
  }, [isPlaying, isLoading]);


const handleNext = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    if (!playlistRef.current.length || !track) return;

    if (repeatModeRef.current === 'ONE') {
      playTrack(track); 
      return;
    }

    playHistoryRef.current.push(track.path); 

    if (isShuffleRef.current && shuffledQueueRef.current.length > 0) {
      const q = shuffledQueueRef.current;
      const idx = q.indexOf(track.path);
      let nextPath = q[0];
      
      if (idx !== -1 && idx + 1 < q.length) {
        nextPath = q[idx + 1];
      } else if (repeatModeRef.current !== 'ALL' && idx + 1 >= q.length) {
        return; 
      }
      
      const nextTrack = playlistRef.current.find(t => t.path === nextPath);
      if (nextTrack) playTrack(nextTrack);
      return;
    }

    // Normal sequential play
    let activeQueue = list;
    let i = activeQueue.findIndex(t => t.path === track.path);
    
    // FIX: If the playing track isn't in the UI tab you are looking at, 
    // fallback to the global playlist so you aren't forced into the wrong queue.
    if (i === -1) {
      activeQueue = playlistRef.current;
      i = activeQueue.findIndex(t => t.path === track.path);
    }

    if (i + 1 >= activeQueue.length) {
      if (repeatModeRef.current === 'ALL') playTrack(activeQueue[0]);
    } else {
      playTrack(activeQueue[i + 1]);
    }
  }, []);



  useEffect(() => {
    if (duration > 0 && currentTime >= duration - 0.5 && !isLoading) {
      const currentPath = stateRefs.current.currentTrack?.path;
      
      // Increment play count exactly once per track completion
      if (currentPath && lastCountedTrackRef.current !== currentPath) {
        lastCountedTrackRef.current = currentPath;
        
        setPlaylist(prev => {
          const updated = prev.map(t => 
            t.path === currentPath 
              ? { ...t, playCount: (t.playCount || 0) + 1, totalSecondsListened: (t.totalSecondsListened || 0) + Math.floor(duration) } 
              : t
          );
          if (dbProcess.current) {
            dbProcess.current.set("user_playlist", updated).then(() => dbProcess.current.save());
          }
          return updated;
        });
      }
      handleNext();
    }
  }, [currentTime, duration, isLoading, handleNext]);

  const activeLyricIndex = lyrics.findIndex((lyric, i) => {
    const next = lyrics[i+1];
    return currentTime >= lyric.time && (!next || currentTime < next.time);
  });

  useEffect(() => {
    if (lyricsContainerRef.current && activeLyricIndex !== -1 && showLyrics) {
      const el = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      el?.scrollIntoView({ behavior:'smooth', block:'center' });
    }
  }, [activeLyricIndex, showLyrics]);

  const toggleTheme = async () => {
    const next = !isDarkMode; setIsDarkMode(next);
    if (dbProcess.current) { await dbProcess.current.set("isDarkMode",next); await dbProcess.current.save(); }
  };

  const applySmartSettings = async (profile:AudioProfile, taste:Taste) => {
    const s = applyTaste(profile.settings, taste);
    setUpscaleDrive(s.drive); setWidenWidth(s.widen); setSpatialExtra(s.spatial);
    setReverbWet(s.reverb); setIsCompressed(s.compress); setIsRemastered(s.remaster);
    await writeToEngine(`UPSCALE ${s.drive}`); await writeToEngine(`WIDEN ${s.widen}`);
    await writeToEngine(`3D ${s.spatial}`);    await writeToEngine(`REVERB ${s.reverb}`);
    await writeToEngine(`COMPRESS ${s.compress?1:0}`); await writeToEngine(`REMASTER ${s.remaster?1:0}`);
  };

  const handleTasteChange = async (taste:Taste) => {
    setSmartTaste(taste); smartTasteRef.current = taste;
    if (detectedProfileRef.current) await applySmartSettings(detectedProfileRef.current, taste);
  };

  // =================================================================
  // ROUTING CONTROLS (SHUFFLE & REPEAT)
  // =================================================================
  const handleToggleShuffle = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = !isShuffle;
    setIsShuffle(next);
    if (next) {
      const { displayedTracks:list, currentTrack:track } = stateRefs.current;
      
      // FIX: Ensure we shuffle the correct list. If you are playing an "All Tracks"
      // song while looking at "Top Tracks", shuffle the entire library.
      let activeQueue = list;
      if (track && activeQueue.findIndex(t => t.path === track.path) === -1) {
        activeQueue = playlistRef.current;
      }

      let paths = activeQueue.map(t => t.path);
      for (let i = paths.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [paths[i], paths[j]] = [paths[j], paths[i]];
      }
      if (track) {
        paths = paths.filter(p => p !== track.path);
        paths.unshift(track.path);
      }
      setShuffledQueue(paths);
      shuffledQueueRef.current = paths;
    } else {
      setShuffledQueue([]);
      shuffledQueueRef.current = [];
    }
  }, [isShuffle]);



  const handleToggleRepeat = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (repeatBusy) return;
    setRepeatBusy(true);
    // Spin the icon one full turn, collapse the center element to invisible
    setRepeatDeg(d => d + 360);
    // After the rotation is halfway done, snap to next mode and reveal new center path
    setTimeout(() => {
      setRepeatMode(prev => {
        const next = prev === 'OFF' ? 'ALL' : prev === 'ALL' ? 'ONE' : 'OFF';
        repeatModeRef.current = next;
        return next;
      });
      setRepeatBusy(false);
    }, 390);
  }, [repeatBusy]);

    const handlePrev = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    if (!playlistRef.current.length || !track) return;

    if (playHistoryRef.current.length > 0) {
      const prevPath = playHistoryRef.current.pop();
      const prevTrack = playlistRef.current.find(t => t.path === prevPath);
      if (prevTrack) {
        playTrack(prevTrack);
        return;
      }
    }

    let activeQueue = list;
    let i = activeQueue.findIndex(t => t.path === track.path);
    
    // FIX: Maintain context on backwards skip as well
    if (i === -1) {
      activeQueue = playlistRef.current;
      i = activeQueue.findIndex(t => t.path === track.path);
    }

    playTrack(activeQueue[(i - 1) < 0 ? activeQueue.length - 1 : i - 1]);
  }, []);
  // =================================================================

  const handleSeek = async (e:React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value); setCurrentTime(v);
    await writeToEngine(`SEEK ${v}`);
  };

  const toggleFavorite = async (e:React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || !dbProcess.current) return;
    const newFavs = favorites.includes(currentTrack.path)
      ? favorites.filter(p=>p!==currentTrack.path) : [...favorites, currentTrack.path];
    setFavorites(newFavs);
    await dbProcess.current.set("user_favorites", newFavs);
    await dbProcess.current.save();
  };

  const scanAndAdd = async (folderPath: string) => {
    setIsLoading(true);
    setScanProgress('Scanning…');
    try {
      let filePaths: string[] = [];
      if (folderPath === 'ALL') filePaths = await invoke<string[]>('scan_mobile_audio');
      else filePaths = await invoke<string[]>('scan_directory', { path: folderPath });

      if (!filePaths?.length) {
        setScanProgress('No audio files found');
        setTimeout(() => setScanProgress(''), 2500);
        return;
      }

      const existing = new Set(playlistRef.current.map(t => t.path));
      const newTracks: Track[] = [];

      for (const fullPath of filePaths) {
        if (existing.has(fullPath)) continue;
        const fileName = fullPath.split(/[/\\]/).pop() || 'Unknown';
        let cleanName = stripExt(fileName)
          .replace(/9convert\.com\s*-\s*/i,'').replace(/\[PagalWorld\.com\]/i,'').replace(/\(Pagalworld\.mobi\)/i,'').trim();
        newTracks.push({
          name: cleanName, path: fullPath,
          artist: 'Unknown Artist', album: 'Unknown Album',
          year: '-', quality: '-', duration: 0
        });
      }

      setScanProgress(`Found ${newTracks.length} new tracks — loading metadata…`);
      const merged = [...playlistRef.current, ...newTracks].sort((a,b) => a.name.localeCompare(b.name));
      setPlaylist(merged);
      if (dbProcess.current) {
        await dbProcess.current.set("user_playlist", merged);
        await dbProcess.current.save();
      }
      setTimeout(() => enrichMetadataInBackground(merged), 400);
    } catch (e) {
      setScanProgress('Scan failed — check permissions');
      setTimeout(() => setScanProgress(''), 3000);
    } finally { setIsLoading(false); }
  };

  const handleAddFolder = () => {
    if (isMobile) setShowFolderModal(true);
    else open({ directory: true, multiple: false }).then(sel => { if (sel && typeof sel === 'string') scanAndAdd(sel); });
  };

  const handleClearLibrary = async () => {
    if (!confirm("Clear all tracks? Files won't be deleted.")) return;
    enricherRunning.current = false;
    setPlaylist([]); setFavorites([]); setScanProgress('');
    if (dbProcess.current) {
      await dbProcess.current.set("user_playlist",[]);
      await dbProcess.current.set("user_favorites",[]);
      await dbProcess.current.save();
    }
  };

  const enrichMetadataInBackground = useCallback(async (tracks: Track[]) => {
    if (enricherRunning.current) return;
    enricherRunning.current = true;

    const needsEnrich = tracks.filter(t => !t.metadataLoaded);
    if (!needsEnrich.length) { enricherRunning.current = false; return; }
    setScanProgress(`Loading metadata for ${needsEnrich.length} tracks…`);

    const BATCH = 30; const DELAY = 20;
    let enriched = 0; let batchesSinceLastSave = 0;

    for (let i = 0; i < needsEnrich.length; i += BATCH) {
      if (!enricherRunning.current) break;
      const batch = needsEnrich.slice(i, i + BATCH);

      const results = await Promise.all(batch.map(async (track) => {
        try {
          const raw = await invoke<number[] | string>('read_file_head', { path: track.path, maxBytes: 131072 });
          let uint8: Uint8Array;
          if (typeof raw === 'string') {
            const bin = atob(raw); uint8 = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) uint8[j] = bin.charCodeAt(j);
          } else uint8 = new Uint8Array(raw);

          const meta = await mm.parseBuffer(uint8, { mimeType: getMime(track.path) }, { skipCovers: true });
          return { 
            path: track.path, 
            name: meta.common.title || track.name, 
            artist: meta.common.artist || track.artist, 
            album: meta.common.album || track.album, 
            year: meta.common.year?.toString() || track.year, 
            quality: meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality, 
            duration: meta.format.duration || track.duration, 
            metadataLoaded: true,
            genre: meta.common.genre?.[0] || track.genre || '' // <--- EXTRACt GENRE HERE
          };
        } catch (_) { return { ...track, metadataLoaded: true }; }
      }));

      const updates = results as { path:string; name:string; artist:string; album:string; year:string; quality:string; duration:number; metadataLoaded:boolean }[];
      
      if (updates.length > 0) {
        const updateMap = new Map(updates.map(u => [u.path, u]));
        const nextPlaylist = playlistRef.current.map(t => {
          const u = updateMap.get(t.path);
          return u ? { ...t, ...u } : t;
        });

        playlistRef.current = nextPlaylist;
        setPlaylist(nextPlaylist);

        batchesSinceLastSave++;
        if (batchesSinceLastSave >= 5 && dbProcess.current) {
          batchesSinceLastSave = 0;
          await dbProcess.current.set("user_playlist", nextPlaylist);
          await dbProcess.current.save();
        }
      }

      enriched += batch.length;
      setScanProgress(`Loading metadata… ${Math.round((enriched / needsEnrich.length) * 100)}%`);
      await new Promise(r => setTimeout(r, DELAY));
    }

    if (dbProcess.current) {
      await dbProcess.current.set("user_playlist", playlistRef.current);
      await dbProcess.current.save();
    }
    setScanProgress(''); enricherRunning.current = false;
  }, []);

  useEffect(() => {
    const needsWork = playlist.some(t => !t.metadataLoaded);
    if (needsWork && !enricherRunning.current) setTimeout(() => enrichMetadataInBackground(playlistRef.current), 800);
  }, [playlist.length]);

  const startBulkCategoryScan = useCallback(async () => {
    if (bulkScanRunning.current) return;
    const unscanned = playlistRef.current.filter(t => !t.profile);
    if (!unscanned.length) { setBulkScanActive(false); return; }

    bulkScanRunning.current = true; bulkScanPausedRef.current = false;
    setBulkScanActive(true); setBulkScanPaused(false); setBulkScanDone(0); setBulkScanTotal(unscanned.length);

    let done = 0; let pendingSave: { path:string; profile:string }[] = [];

    for (const track of unscanned) {
      while (bulkScanPausedRef.current && bulkScanRunning.current) await new Promise(r => setTimeout(r, 200));
      if (!bulkScanRunning.current) break;

      try {
        await invoke('audio_command', { cmd: `LOAD ${track.path}` });
        await new Promise(r => setTimeout(r, 150));
        const fpLine: string = await invoke('analyze_current_track');
        if (fpLine.startsWith("FINGERPRINT ")) {
          const p = fpLine.split(' ');
          const prof = classifyAudio(parseFloat(p[1])||0, parseFloat(p[2])||10, parseFloat(p[3])||0.1, parseFloat(p[4])||0.1);
          setPlaylist(prev => prev.map(t => t.path===track.path ? {...t, profile:prof.id} : t));
          pendingSave.push({ path: track.path, profile: prof.id });
        }
      } catch (_) {}

      setBulkScanDone(++done);

      if (pendingSave.length >= 20 && dbProcess.current) {
        const m = new Map(pendingSave.map(x => [x.path, x.profile]));
        const snap = playlistRef.current.map(t => m.has(t.path) ? {...t, profile:m.get(t.path)!} : t);
        dbProcess.current.set("user_playlist", snap);
        dbProcess.current.save().catch(() => {});
        pendingSave = [];
      }
      await new Promise(r => setTimeout(r, 50));
    }

    if (pendingSave.length > 0 && dbProcess.current) {
      const m = new Map(pendingSave.map(x => [x.path, x.profile]));
      const snap = playlistRef.current.map(t => m.has(t.path) ? {...t, profile:m.get(t.path)!} : t);
      dbProcess.current.set("user_playlist", snap);
      dbProcess.current.save().catch(() => {});
    }
    bulkScanRunning.current = false; setBulkScanActive(false); setBulkScanPaused(false);
  }, []);

  const pauseBulkScan  = useCallback(() => { bulkScanPausedRef.current=true;  setBulkScanPaused(true);  }, []);
  const resumeBulkScan = useCallback(() => { bulkScanPausedRef.current=false; setBulkScanPaused(false); }, []);
  const stopBulkScan   = useCallback(() => { bulkScanRunning.current=false; bulkScanPausedRef.current=false; setBulkScanActive(false); setBulkScanPaused(false); }, []);

  useEffect(() => {
    if (duration > 0 && currentTime >= duration - 0.5 && !isLoading) {
      handleNext(); 
    }
  }, [currentTime, duration, isLoading, handleNext]);


  const playTrack = async (track: Track) => {
    // --- 5-SECOND SCORING ENGINE ---
    const oldTrack = stateRefs.current.currentTrack;
    const listened = currentTimeRef.current;

    if (oldTrack && listened > 0 && oldTrack.path !== track.path) {
      setPlaylist(prev => {
        const nextList = prev.map(t => 
          t.path === oldTrack.path 
            ? { 
                ...t, 
                playCount: listened >= 5 ? (t.playCount || 0) + 1 : (t.playCount || 0), 
                totalSecondsListened: (t.totalSecondsListened || 0) + Math.floor(listened) 
              } 
            : t
        );
        if (dbProcess.current) {
          dbProcess.current.set("user_playlist", nextList).then(() => dbProcess.current.save());
        }
        return nextList;
      });
    }
    
    currentTimeRef.current = 0; 
    // --------------------------------

    lastCountedTrackRef.current = null;
    const id = ++loadIdRef.current;
    setCurrentTrack(track); setIsPlaying(false); setCurrentTime(0);
    setTrackTitle(track.name); setTrackArtist(track.artist);
    setDetectedProfile(null); detectedProfileRef.current = null;
    setLyrics(track.lyrics?.length ? track.lyrics : []);
    setAlbumArt(prev => { if (prev) URL.revokeObjectURL(prev); return null; });

    try {
      await Promise.all([
        writeToEngine(`VOLUME ${volume}`), writeToEngine('REMASTER 0'), writeToEngine('COMPRESS 0'),
        writeToEngine('UPSCALE 0'), writeToEngine('WIDEN 1.0'), writeToEngine('3D 0'), writeToEngine('REVERB 0'),
        writeToEngine(`BASS ${bassLevelRef.current}`),
        writeToEngine(`LIMITER ${isLimiterOn ? limiterIntensity : 0}`),
      ]);
      if (id !== loadIdRef.current) return;
      await writeToEngine(`LOAD ${track.path}`);
      if (id !== loadIdRef.current) return;
      await writeToEngine('PLAY');
      setIsPlaying(true); 

      setTimeout(async () => {
        if (id !== loadIdRef.current) return;
        try {
          const fileData = await readFile(track.path);
          if (id !== loadIdRef.current) return;
          const meta = await mm.parseBuffer(fileData, { mimeType: getMime(track.path) });
          if (id !== loadIdRef.current) return;

          const title  = meta.common.title  || track.name;
          const artist = meta.common.artist || track.artist;
          setTrackTitle(title); setTrackArtist(artist);

          if (meta.common.picture?.length) {
            const pic = meta.common.picture[0];
            const blob = new Blob([pic.data], { type: pic.format });
            const imgUrl = URL.createObjectURL(blob);
            if (id !== loadIdRef.current) { URL.revokeObjectURL(imgUrl); return; }
            setAlbumArt(imgUrl);
            try {
              const [facColor, palette] = await Promise.all([ fac.getColorAsync(imgUrl, { algorithm: 'dominant' }).catch(() => null), getPalette(imgUrl) ]);
              if (id === loadIdRef.current) {
                setBlobColors(palette);
                const dom = (facColor && !facColor.error) ? facColor.hex : (palette[1] || '#c8222a');
                setThemeColor(dom); setThemeText(isHexDark(dom) ? '#ffffff' : '#111111');
              }
            } catch (_) {}
          }

          try {
            const lrcText = await readTextFile(track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc');
            if (id === loadIdRef.current && lrcText) setLyrics(parseLRC(lrcText));
          } catch (_) {}

          const hasNewData = title !== track.name || artist !== track.artist || (meta.format.duration && meta.format.duration !== track.duration);
          if (hasNewData) {
            const updatedTrack: Track = {
              ...track, name: title, artist, album: meta.common.album || track.album, year: meta.common.year?.toString() || track.year,
              quality: meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality, duration: meta.format.duration || track.duration,
            };
            const newList = playlistRef.current.map(t => t.path === track.path ? updatedTrack : t);
            setPlaylist(newList);
            if (dbProcess.current) { dbProcess.current.set("user_playlist", newList); dbProcess.current.save().catch(() => {}); }
          }
        } catch (_) {} 
      }, 300);

      const cachedProfile = track.profile ? PROFILES.find(p => p.id === track.profile) : null;
      if (cachedProfile) {
        setDetectedProfile(cachedProfile); detectedProfileRef.current = cachedProfile;
        await applySmartSettings(cachedProfile, smartTasteRef.current);
      } else {
        setTimeout(async () => {
          if (id !== loadIdRef.current) return;
          setIsAnalyzing(true);
          try {
            const fpLine: string = await invoke('analyze_current_track');
            if (id !== loadIdRef.current) return;
            if (fpLine.startsWith("FINGERPRINT ")) {
              const parts = fpLine.split(' ');
              const profile = classifyAudio(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 10, parseFloat(parts[3]) || 0.1, parseFloat(parts[4]) || 0.1);
              setDetectedProfile(profile); detectedProfileRef.current = profile;
              await applySmartSettings(profile, smartTasteRef.current);
              const upd = { ...track, profile: profile.id };
              const nl  = playlistRef.current.map(t => t.path === track.path ? upd : t);
              setPlaylist(nl);
              if (dbProcess.current) { dbProcess.current.set("user_playlist", nl); dbProcess.current.save().catch(() => {}); }
            }
          } catch (_) {} finally { setIsAnalyzing(false); }
        }, 2000);
      }
    } catch (_) {
      if (id === loadIdRef.current) {
        try { await writeToEngine(`LOAD ${track.path}`); await writeToEngine('PLAY'); setIsPlaying(true); } catch (_) {}
      }
    }
  };

  const handlePlayPause = async () => {
    try {
      if (isPlaying) { await writeToEngine('PAUSE'); setIsPlaying(false); }
      else           { await writeToEngine('PLAY');  setIsPlaying(true);  }
    } catch (_) {}
  };

  const formatTime = (s:number) => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  const isCurrentFavorite = currentTrack ? favorites.includes(currentTrack.path) : false;
  const bollywoodCount    = playlist.filter(t => t.profile==='BOLLYWOOD').length;

  const applyPreset = async (preset:'STUDIO'|'CINEMATIC'|'RELAX') => {
    let pRem=false,pCmp=false,pDrv=0.0,pWid=1.0,p3D=0.0,pRvb=0.0,pBas=0.0;
    if (preset==='STUDIO')   { pCmp=true; pDrv=0.7; pWid=1.10; pBas=0.3; } // Tight, punchy bass
    else if (preset==='CINEMATIC') { pRem=true; pCmp=true; pDrv=1.2; pWid=1.35; p3D=0.25; pRvb=0.16; pBas=0.8; } // Massive sub-bass
    else                           { p3D=0.40; pRvb=0.22; pBas=0.1; }
    
    setIsRemastered(pRem); setIsCompressed(pCmp); setUpscaleDrive(pDrv);
    setWidenWidth(pWid); setSpatialExtra(p3D); setReverbWet(pRvb); setBassLevel(pBas);
    
    await writeToEngine(`REMASTER ${pRem?1:0}`); await writeToEngine(`COMPRESS ${pCmp?1:0}`);
    await writeToEngine(`UPSCALE ${pDrv}`);      await writeToEngine(`WIDEN ${pWid}`);
    await writeToEngine(`3D ${p3D}`);            await writeToEngine(`REVERB ${pRvb}`);
    await writeToEngine(`BASS ${pBas}`);
  };

  const TASTES: {id:Taste;icon:string;label:string}[] = [ {id:'QUALITY',icon:'✨',label:'HD Clear'},{id:'IMMERSIVE',icon:'🌌',label:'Immersive'},{id:'CHILL',icon:'🌙',label:'Chill'} ];

  const renderSmartPills = () => (
    <div className="player-smart-section">
      <div className="player-profile-line">
        {isAnalyzing ? <span className="profile-analyzing"><span className="dot-pulse"/> Analyzing…</span>
          : detectedProfile ? <span className="profile-chip">{detectedProfile.icon} {detectedProfile.label}</span>
          : <span className="profile-chip muted">🎵 Auto Mode</span>}
      </div>
      <div className="player-taste-pills">
        {TASTES.map(t=>(
          <button key={t.id} className={`taste-pill ${smartTaste===t.id?'active':''}`} onClick={()=>handleTasteChange(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderManualDSP = () => (
    <div className="studio-dashboard fade-in">
      <div className="studio-header"><h2>Fine Tune DSP</h2><p className="studio-subtitle">Manual override — resets on next track load</p></div>
      <div className="manual-presets">
        <button className="preset-btn studio"  onClick={()=>applyPreset('STUDIO')}>🎧 Studio</button>
        <button className="preset-btn cinema"  onClick={()=>applyPreset('CINEMATIC')}>🍿 Cinematic</button>
        <button className="preset-btn relax"   onClick={()=>applyPreset('RELAX')}>🌙 Relax</button>
      </div>
      <div className="dsp-grid">
        <div className="dsp-card toggle-card">
          <div className="dsp-toggle-group"><label>Old Song EQ</label><button className={`dsp-btn ${isRemastered?'active':''}`} onClick={()=>{const v=!isRemastered;setIsRemastered(v);writeToEngine(`REMASTER ${v?1:0}`)}}>{isRemastered?'ON':'BYPASS'}</button></div>
          <div className="dsp-toggle-group"><label>Compressor</label><button className={`dsp-btn ${isCompressed?'active':''}`} onClick={()=>{const v=!isCompressed;setIsCompressed(v);writeToEngine(`COMPRESS ${v?1:0}`)}}>{isCompressed?'ON':'BYPASS'}</button></div>
          <div className="dsp-toggle-group" style={{flexDirection:'column', alignItems:'stretch', gap:6}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <label>Speaker Boost</label>
              <span style={{color: isLimiterOn ? '#ff3b30' : 'var(--text-secondary)', fontWeight:600, fontSize:'0.8rem', transition:'color 0.2s'}}>
                {isLimiterOn ? `${Math.round(limiterIntensity * 100)}%` : 'OFF'}
              </span>
            </div>
            <input
              type="range" className="dsp-slider" min="0" max="1" step="0.05"
              value={isLimiterOn ? limiterIntensity : 0}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (v < 0.05) {
                  setIsLimiterOn(false);
                  setLimiterIntensity(0);
                  writeToEngine('LIMITER 0');
                } else {
                  setIsLimiterOn(true);
                  setLimiterIntensity(v);
                  writeToEngine(`LIMITER ${v}`);
                }
              }}
            />
          </div>
        </div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Harmonic Exciter</label><span className="val-green">{upscaleDrive.toFixed(1)}×</span></div><input type="range" className="dsp-slider exciter" min="0" max="2" step="0.1" value={upscaleDrive} onChange={e=>{const v=parseFloat(e.target.value);setUpscaleDrive(v);writeToEngine(`UPSCALE ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{Math.round((widenWidth-1)*100)}% extra</span></div><input type="range" className="dsp-slider widener" min="1" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(`WIDEN ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?`+${Math.round(spatialExtra*100)}%`:'Base'}</span></div><input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(`3D ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Reverb</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div><input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(`REVERB ${v}`)}}/></div>
      </div>
    </div>
  );

  const renderExpandedControls = () => {
    const isLong = trackTitle.length > 25; const artistIsLong = trackArtist.length > 30;
    return (
      <div className="ep-controls-section">
        <div className="ep-track-header">
          {isLong ? (
            <div className="marquee-container scrolling"><Marquee speed={40} gradient={false} delay={1.5}><h1 className="ep-title" style={{ paddingRight: '60px' }}>{trackTitle}</h1></Marquee></div>
          ) : (<div className="marquee-container"><h1 className="ep-title">{trackTitle}</h1></div>)}
          {artistIsLong ? (
            <div className="ep-artist-marquee scrolling"><Marquee speed={35} gradient={false} delay={1.5}><h2 className="ep-artist" style={{ paddingRight: '50px' }}>{trackArtist}</h2></Marquee></div>
          ) : (<div className="ep-artist-marquee"><h2 className="ep-artist">{trackArtist}</h2></div>)}
        </div>
        {renderSmartPills()}
        <div className="ep-volume-row">
          <button className="vol-btn" onClick={async()=>{const v=Math.max(0,volume-0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg></button>
          <input type="range" className="ep-volume-slider" min="0" max="1" step="0.02" value={volume} onChange={async e=>{const v=parseFloat(e.target.value);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}/>
          <button className="vol-btn" onClick={async()=>{const v=Math.min(1,volume+0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>
          <span className="vol-pct">{Math.round(volume*100)}%</span>
        </div>
        <div className="ep-actions">
          <button className="ep-icon-btn" onClick={toggleFavorite} style={{color:isCurrentFavorite?'var(--theme-color)':undefined}}>{isCurrentFavorite?'♥':'♡'}</button>
          <button className="ep-icon-btn" onClick={e=>{e.stopPropagation();setShowLyrics(!showLyrics);setShowStudio(false);}} style={{color:showLyrics?'var(--theme-color)':undefined}} title="Lyrics"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
          <button className={`ep-icon-btn ${showStudio?'active-glow':''}`} onClick={e=>{e.stopPropagation();if(isMobile){setShowDSPPage(true);setShowStudio(false);setShowLyrics(false);}else{setShowStudio(!showStudio);setShowLyrics(false);}}} style={{color:showStudio?'#00e676':undefined}} title="Fine Tune DSP"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg></button>
        </div>
        <div className="ep-progress-container">
          <input type="range" className="ep-progress-bar" min="0" max={duration||1} value={currentTime} onChange={handleSeek}/>
          <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="ep-main-controls">
          {/* SHUFFLE BUTTON */}
          <button
            className="ep-ctrl-btn no-touch-effects"
            onClick={handleToggleShuffle}
          >
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {/* Top wire */}
              <path
                style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties}
                d={isShuffle ? "M 3 8 C 9 8 13 16 20 16" : "M 3 8 C 9 8 13 8 20 8"}
              />
              {/* Bottom wire */}
              <path
                style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties}
                d={isShuffle ? "M 3 16 C 9 16 13 8 20 8" : "M 3 16 C 9 16 13 16 20 16"}
              />
              {/* Top arrowhead */}
              <path
                style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties}
                d={isShuffle ? "M 17 13 L 20 16 L 17 19" : "M 17 5 L 20 8 L 17 11"}
              />
              {/* Bottom arrowhead */}
              <path
                style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties}
                d={isShuffle ? "M 17 5 L 20 8 L 17 11" : "M 17 13 L 20 16 L 17 19"}
              />
            </svg>
          </button>
          
          <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handlePrev();}}>
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          
          <button className="ep-play-btn no-touch-effects" onClick={handlePlayPause}>
            {isPlaying ?
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .656-.656c.163-.32.163-.74.163-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C8.861 3 8.441 3 7.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656zm9 0C14 4.139 14 4.559 14 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z"/></svg>
              :
              <svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)"/></svg>
            }
          </button>
          
          <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handleNext();}}>
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          
          {/* REPEAT BUTTON */}
          <button
            className="ep-ctrl-btn no-touch-effects"
            onClick={handleToggleRepeat}
          >
            <svg
              viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{
                transform: `rotate(${repeatDeg}deg)`,
                transition: 'transform 0.52s cubic-bezier(.4,0,.2,1)',
              }}
            >
              {/* Repeat loop arrows */}
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              {/* Center morphing path */}
              <path
                style={{
                  transition: 'd 0.38s cubic-bezier(.4,0,.2,1), stroke-width 0.3s',
                  strokeWidth: repeatMode === 'ONE' ? 2.2 : 1.8,
                } as React.CSSProperties}
                d={
                  repeatBusy         ? "M 12 12 L 12 12 L 12 12" :
                  repeatMode === 'OFF' ? "M 6 18 L 12 12 L 18 6"  :
                  repeatMode === 'ALL' ? "M 12 12 L 12 12 L 12 12" :
                                         "M 11 10 L 12 8 L 12 15"
                }
              />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  const renderMobileDSPPage = () => (
    <div className="mobile-dsp-page fade-in">
      <div className="mobile-dsp-header">
        <button className="mobile-dsp-back" onClick={()=>setShowDSPPage(false)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 className="mobile-dsp-title">Sound Quality & Effects</h1>
      </div>
      <div className="mobile-dsp-body">{renderManualDSP()}</div>
    </div>
  );

  const renderMobileHeader = () => (
    <div className="mobile-header">
      <div className="sidebar-logo"><span className="logo-d">D</span><span className="logo-rest">meX</span></div>
      <div className="mobile-header-actions">
        <button className="mobile-icon-btn" onClick={()=>setMobileSearchOpen(s=>!s)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <button className="mobile-icon-btn theme-toggle-btn" onClick={toggleTheme}>
          {isDarkMode
            ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          }
        </button>
        <button className="mobile-icon-btn add-folder-mobile" onClick={handleAddFolder} disabled={isLoading}>
          {isLoading ? '⏳' : '+'}
        </button>
      </div>
    </div>
  );

  const renderBulkScanBanner = () => {
    const unscannedCount = playlist.filter(t => !t.profile).length;
    if (!bulkScanActive && unscannedCount === 0) return null;

    const pct = bulkScanTotal > 0 ? Math.round((bulkScanDone / bulkScanTotal) * 100) : 0;

    return (
      <>
        <button className="bulk-scan-fab fade-in" onClick={() => setIsBulkScanOpen(true)}>
          <span className="fab-text">
            {bulkScanActive 
              ? (bulkScanPaused ? `Paused ${pct}%` : `Scanning ${pct}%`) 
              : `Optimize (${unscannedCount})`}
          </span>
        </button>

        {isBulkScanOpen && (
          <div className="folder-modal-overlay" onClick={() => setIsBulkScanOpen(false)}>
            <div className="folder-modal" onClick={e => e.stopPropagation()}>
              <div className="folder-modal-header">
                <h2> Audio Optimization</h2>
                <button className="folder-modal-close" onClick={() => setIsBulkScanOpen(false)}>×</button>
              </div>
              
              <div className="bulk-scan-modal-content">
                <p className="folder-modal-hint" style={{marginBottom: 20, padding: 0}}>
                  {bulkScanActive 
                    ? "Analyzing audio fingerprints in the background to instantly apply the perfect DSP profile when you play a song." 
                    : `${unscannedCount} tracks haven't been analyzed yet. Run a background scan to enable instant Smart DSP loading.`}
                </p>

                {bulkScanActive ? (
                  <div className="bulk-scan-active-view">
                    <div className="bulk-scan-info">
                      <span className="bulk-scan-label">{bulkScanPaused ? '⏸ Paused' : '⚡ Scanning'}</span>
                      <span className="bulk-scan-pct">{bulkScanDone} / {bulkScanTotal} ({pct}%)</span>
                    </div>
                    <div className="bulk-scan-bar" style={{ marginBottom: 20 }}>
                      <div className="bulk-scan-fill" style={{ width: `${pct}%`, background: 'var(--theme-color)' }} />
                    </div>
                    <div className="bulk-scan-actions" style={{ display: 'flex', gap: 10 }}>
                      {bulkScanPaused
                        ? <button className="folder-modal-scan-all" style={{flex: 1}} onClick={resumeBulkScan}>▶ Resume</button>
                        : <button className="folder-modal-scan-all" style={{flex: 1, background: 'var(--bg-raised)', color: 'var(--text-primary)'}} onClick={pauseBulkScan}>⏸ Pause</button>
                      }
                      <button className="folder-modal-scan-all" style={{flex: 1, background: '#e83040'}} onClick={stopBulkScan}>✕ Stop</button>
                    </div>
                  </div>
                ) : (
                  <button className="folder-modal-scan-all" onClick={() => { startBulkCategoryScan(); setIsBulkScanOpen(false); }}>
                     Start Background Scan
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderMobileTabs = () => (
    <div className="mobile-tabs">
      <button className={currentView==='ALL'?'active':''} onClick={()=>setCurrentView('ALL')}>🎵 Tracks <span className="tab-count">{playlist.length}</span></button>
      <button className={currentView==='FAVORITES'?'active':''} onClick={()=>setCurrentView('FAVORITES')}>❤️ Favorites <span className="tab-count">{favorites.length}</span></button>
      <button className={currentView==='BOLLYWOOD'?'active':''} onClick={()=>setCurrentView('BOLLYWOOD')}>🎙️ Bollywood</button>
      <button className={currentView==='TOPTRACKS'?'active':''} onClick={()=>setCurrentView('TOPTRACKS')}>🔥 Top Played</button>
    </div>
  );

  const isRightPaneActive = showLyrics || showStudio;

  return (
    <div className="app-layout" data-theme={isDarkMode?'dark':'light'} style={{
      '--theme-color': themeColor, '--theme-text': themeText,
      '--blob-1': blobColors[0], '--blob-2': blobColors[1], '--blob-3': blobColors[2],
      '--audio-level': audioLevel,
    } as React.CSSProperties}>

      {showFolderModal && <FolderModal onClose={()=>setShowFolderModal(false)} onScan={scanAndAdd}/>}

      <aside className="sidebar">
        <div className="sidebar-logo"><span className="logo-d">D</span><span className="logo-rest">meX</span></div>
        <div className="search-box">
          <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" type="text" placeholder="Search tracks…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
          {searchQuery && <button className="search-clear" onClick={()=>setSearchQuery('')}>×</button>}
        </div>
        <nav>
          <button className={currentView==='ALL'?'active':''} onClick={()=>setCurrentView('ALL')}>🎵 All Tracks <span className="nav-count">{playlist.length}</span></button>
          <button className={currentView==='FAVORITES'?'active':''} onClick={()=>setCurrentView('FAVORITES')}>❤️ Favorites <span className="nav-count">{favorites.length}</span></button>
          <button className={currentView==='BOLLYWOOD'?'active':''} onClick={()=>setCurrentView('BOLLYWOOD')}>🎙️ Bollywood <span className="nav-count">{playlist.filter(t => (t.genre||'').toLowerCase().includes('hindi') || (t.genre||'').toLowerCase().includes('bollywood')).length}</span></button>
          <button className={currentView==='TOPTRACKS'?'active':''} onClick={()=>setCurrentView('TOPTRACKS')}>🔥 Most Played</button>
        </nav>
        <div className="sidebar-footer">
          <button className="add-folder-btn" onClick={handleAddFolder} disabled={isLoading}>{isLoading?'⏳ Scanning…':'+ Add Folder'}</button>
          <button className="theme-toggle-btn" onClick={toggleTheme}>
            {isDarkMode?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
          </button>
          <button className="clear-btn" onClick={handleClearLibrary} title="Clear library">🗑</button>
        </div>
      </aside>

      <div className="app-container">
        {renderMobileHeader()}
        {mobileSearchOpen && (
          <div className="mobile-search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input autoFocus type="text" placeholder="Search tracks…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
            {searchQuery && <button onClick={()=>setSearchQuery('')}>×</button>}
          </div>
        )}
        {renderMobileTabs()}
        {scanProgress && <div className="scan-progress">{isLoading ? '⏳ ' : '✓ '}{scanProgress}</div>}
        {isMobile && renderBulkScanBanner()}

        <header className="app-header">
          <h1>{currentView==='ALL'?'Library':currentView==='FAVORITES'?'Favorites':'🎙️ Bollywood Classics'}</h1>
          {currentView==='BOLLYWOOD'&&bollywoodCount===0&&<p className="bollywood-hint">Play your tracks — Bollywood ones auto-appear here</p>}
        </header>

        <main className="content-area">
          {displayedTracks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🎵</div>
              <p className="empty-title">{searchQuery?'No results found':'No music yet'}</p>
              <p className="empty-hint">
                {searchQuery?'Try a different search term':isMobile?'Tap the + button to add your music folders':'Click "+ Add Folder" in the sidebar'}
              </p>
              {!searchQuery && isMobile && (
                <button className="empty-add-btn" onClick={handleAddFolder}>
                  + Add Music Folder
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="track-list-header">
                <span>Title</span><span className="hide-mobile">Album</span><span className="hide-mobile">Year</span><span className="hide-mobile">Quality</span><span>⏱</span>
              </div>
              <VirtualList
                tracks={displayedTracks}
                currentTrackPath={currentTrack?.path}
                albumArt={albumArt}
                favorites={favorites}
                onPlay={playTrack}
                formatTime={formatTime}
              />
            </>
          )}
        </main>

        <footer className={`bottom-player ${isExpanded?'expanded':''}`}>
          {!isExpanded && (
            <div className="mini-player-content fade-in">
              <div className="progress-container mini">
                <input type="range" className="progress-bar" min="0" max={duration||1} value={currentTime} onChange={handleSeek} onClick={e=>e.stopPropagation()}/>
              </div>
              <div className="player-interface">
                <div className="track-info" onClick={()=>setIsExpanded(true)}>
                  <div className="art-circle" style={{backgroundImage:albumArt?`url(${albumArt})`:'none',backgroundColor:albumArt?'transparent':'rgba(255,255,255,0.15)'}}>{!albumArt&&<span>🎵</span>}</div>
                  <div className="mini-text-block">
                    {trackTitle.length > 22 ? (
                      <div className="mini-marquee-clip scrolling">
                        <Marquee speed={35} gradient={false} delay={1}>
                          <span className="track-title" style={{ paddingRight: '48px' }}>{trackTitle}</span>
                        </Marquee>
                      </div>
                    ) : (
                      <div className="mini-marquee-clip"><span className="track-title">{trackTitle}</span></div>
                    )}
                    
                    {trackArtist.length > 26 ? (
                      <div className="mini-marquee-clip scrolling">
                        <Marquee speed={30} gradient={false} delay={1}>
                          <span className="artist-subtitle" style={{ paddingRight: '48px' }}>
                            {trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}
                          </span>
                        </Marquee>
                      </div>
                    ) : (
                      <div className="mini-marquee-clip">
                        <span className="artist-subtitle">
                          {trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="controls">
                  <div className="controls">
                    <button className="control-btn" onClick={e=>{e.stopPropagation();handlePrev();}}>
                      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button className="play-main" onClick={handlePlayPause}>
                      {isPlaying ?
                        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .656-.656c.163-.32.163-.74.163-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C8.861 3 8.441 3 7.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656zm9 0C14 4.139 14 4.559 14 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z"/></svg>
                        :
                        <svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)"/></svg>
                      }
                    </button>
                    <button className="control-btn" onClick={e=>{e.stopPropagation();handleNext();}}>
                      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="expanded-player-content fade-in">
              <div className="ambient-background">
                <div className="blob blob-1" style={{transform:`scale(${1+audioLevel*2.0})`,transition:'transform 0.12s ease-out'}}/>
                <div className="blob blob-2" style={{transform:`scale(${1+audioLevel*1.3})`,transition:'transform 0.18s ease-out'}}/>
                <div className="blob blob-3" style={{transform:`scale(${1+audioLevel*0.9})`,transition:'transform 0.22s ease-out'}}/>
              </div>
              {showDSPPage && renderMobileDSPPage()}
              <div className="mobile-album-gradient"/>
              <div className="mobile-album-gradient"/>
              
              {/* Hide the main header when DSP page is open to prevent overlap */}
              {!showDSPPage && (
                <div className="ep-header" style={{position:'relative',zIndex:50}}>
                  <button className="ep-icon-btn" onClick={e=>{e.stopPropagation();setIsExpanded(false);setShowOptionsMenu(false);}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  {detectedProfile&&<div className="ep-profile-badge">{detectedProfile.icon} {detectedProfile.label}</div>}
                  
                  <button className={`ep-icon-btn ${showOptionsMenu ? 'active-glow' : ''}`} onClick={e=>{e.stopPropagation();setShowOptionsMenu(!showOptionsMenu);}}>
                    ⋮
                  </button>

                  {showOptionsMenu && (
                    <>
                      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={(e) => { e.stopPropagation(); setShowOptionsMenu(false); }} />
                      <div className="glass-options-menu fade-in" onClick={e => e.stopPropagation()}>
                        <div className="glass-menu-header">Track Options</div>
                        <div className="glass-menu-section">
                          <div className="glass-label-row">
                            <span>Subwoofer Bass</span>
                            <span style={{ color: 'var(--theme-color)', fontWeight: 600 }}>{Math.round(bassLevel * 100)}%</span>
                          </div>
                          <input type="range" className="glass-slider" min="0" max="1.5" step="0.05" value={bassLevel} onChange={e=>{const v=parseFloat(e.target.value);setBassLevel(v);bassLevelRef.current=v;writeToEngine(`BASS ${v}`);}} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className={`ep-content ${isRightPaneActive?'lyrics-mode':''}`} style={{position:'relative',zIndex:10}}>
                <div className="ep-left">
                  <div className="ep-art" style={{backgroundImage:albumArt?`url(${albumArt})`:'none',backgroundColor:'rgba(128,128,128,0.08)'}}
                    onClick={()=>{if(window.innerWidth<=768&&lyrics.length>0){setShowLyrics(true);setShowStudio(false);}}}>
                    {!albumArt&&<span>🎵</span>}
                    {lyrics.length>0&&<div className="lyrics-art-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>Synced lyrics</div>}
                  </div>
                  {isRightPaneActive&&renderExpandedControls()}
                </div>
                <div className="ep-right">
                  {!isRightPaneActive&&renderExpandedControls()}
                  {showLyrics&&(
                    <div className="lyrics-display full" ref={lyricsContainerRef}>
                      {lyrics.length>0?lyrics.map((line,i)=><p key={i} className={`lyric-line ${i===activeLyricIndex?'active':''}`}>{line.text}</p>)
                        :<p className="lyric-line active" style={{opacity:0.4}}>No lyrics for this track.</p>}
                    </div>
                  )}
                  {showStudio&&renderManualDSP()}
                </div>
              </div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;