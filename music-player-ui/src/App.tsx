import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import * as mm from "music-metadata";
import { FastAverageColor } from "fast-average-color";
import "./App.css";

interface Track {
  name: string; path: string; artist: string; album: string;
  year: string; quality: string; duration: number;
  lyrics?: LyricLine[]; profile?: string;
}
interface LyricLine { time: number; text: string; }

type Taste   = 'QUALITY' | 'IMMERSIVE' | 'CHILL';
type NavView = 'ALL' | 'FAVORITES' | 'BOLLYWOOD';

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
  if (cf>18 && rms<0.08)               return PROFILES[5];
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
//const isAudio = (n?:string) => !!n&&['.mp3','.wav','.flac','.ogg','.aac','.m4a'].some(e=>n.toLowerCase().endsWith(e));
const stripExt = (n:string) => n.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i,'');
const parseLRC = (text:string): LyricLine[] => {
  const lines:LyricLine[]=[];
  const re=/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
  for (const line of text.split('\n')){const m=re.exec(line);if(m){const txt=line.replace(/\[.*?\]/g,'').trim();if(txt)lines.push({time:parseInt(m[1])*60+parseFloat(m[2]),text:txt});}}
  return lines.sort((a,b)=>a.time-b.time);
};

// ─── Memoized single track row ─────────────────────────────────────────────
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

// ─── Virtual List — only renders visible rows + 8-row overscan buffer ────────
// This is the core fix for 1818-track sluggishness.
// Rendering all 1818 <li> elements creates ~127,000px of DOM height,
// and every scroll event triggers layout on all 1818 nodes.
// With virtualization, only ~15 rows exist in the DOM at any time.
const ITEM_HEIGHT = 72; // px — must match .track-item height in CSS
const OVERSCAN    = 8;  // extra rows above/below viewport to prevent flicker

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

  // Measure container height on mount and resize
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
    <div
      ref={containerRef}
      className="virtual-scroll-container"
      onScroll={handleScroll}
    >
      {/* Spacer that gives the scrollbar the correct total height */}
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

// ─── Folder picker modal (mobile) ──────────────────────────────────────────
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

  // Bulk category scanner state (mobile only)
  const [bulkScanActive, setBulkScanActive] = useState(false);
  const [bulkScanPaused, setBulkScanPaused] = useState(false);
  const [bulkScanDone, setBulkScanDone]     = useState(0);
  const [bulkScanTotal, setBulkScanTotal]   = useState(0);

  const smartTasteRef      = useRef<Taste>('QUALITY');
  const detectedProfileRef = useRef<AudioProfile | null>(null);
  const dbProcess          = useRef<any>(null);
  const loadIdRef          = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playlistRef        = useRef<Track[]>([]);
  const enricherRunning    = useRef(false);
  const bulkScanRunning    = useRef(false);  // controls the bulk scan loop
  const bulkScanPausedRef  = useRef(false);  // pause signal (ref so loop can read it)
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);

  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  // Derived track list
  const displayedTracks = (() => {
    let base = playlist;
    if      (currentView==='FAVORITES') base=playlist.filter(t=>favorites.includes(t.path));
    else if (currentView==='BOLLYWOOD') base=playlist.filter(t=>t.profile==='BOLLYWOOD');
    if (searchQuery.trim()) {
      const q=searchQuery.toLowerCase();
      base=base.filter(t=>t.name.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q)||t.album.toLowerCase().includes(q));
    }
    return base;
  })();

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = useCallback(async (cmd:string) => {
    try { await invoke('audio_command', { cmd: cmd.trim() }); } catch (_) {}
  }, []);

  // Boot: load DB only
  useEffect(() => {
    async function boot() {
      const store = await load("library.json", { autoSave: true, defaults: {} });
      dbProcess.current = store;
      const saved = await store.get<Track[]>("user_playlist");
      if (saved?.length) setPlaylist(saved);
      const savedFavs = await store.get<string[]>("user_favorites");
      if (savedFavs) setFavorites(savedFavs);
      const savedDark = await store.get<boolean>("isDarkMode");
      if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
    }
    boot();
  }, []);

  // Single polling timer — 250ms, reads time + level from native FFI
  // With MA_SOUND_FLAG_STREAM, duration starts as 0 and arrives ~100ms after LOAD.
  // Only update duration when non-zero so the progress bar doesn't collapse.
  useEffect(() => {
    const iv = setInterval(async () => {
      if (!isPlaying || isLoading) return;
      try {
        const m: [number,number,number] = await invoke('audio_metrics');
        setCurrentTime(m[0]);
        if (m[1] > 0) setDuration(m[1]);
        setAudioLevel(Math.min(1, m[2] * 3.5));
      } catch (_) {}
    }, 250);
    return () => clearInterval(iv);
  }, [isPlaying, isLoading]);

  // Auto-advance
  useEffect(() => {
    if (duration > 0 && currentTime >= duration - 0.5 && !isLoading) handleNext();
  }, [currentTime, duration, isLoading]);

  // Lyrics scroll
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

  const handleNext = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    if (!list.length || !track) return;
    const i = list.findIndex(t => t.path===track.path);
    playTrack(list[(i+1)>=list.length ? 0 : i+1]);
  }, []);

  const handlePrev = useCallback(() => {
    const { displayedTracks:list, currentTrack:track } = stateRefs.current;
    if (!list.length || !track) return;
    const i = list.findIndex(t => t.path===track.path);
    playTrack(list[(i-1)<0 ? list.length-1 : i-1]);
  }, []);

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

  // ── SCAN FOLDER — fast path: just file paths, NO metadata reading ─────────
  // Metadata (title, artist, album art) is parsed LAZILY when the user plays
  // a track. This makes scanning 500+ files take <1s instead of 2+ minutes.
  const scanAndAdd = async (folderPath: string) => {
    setIsLoading(true);
    setScanProgress('Scanning…');
    try {
      let filePaths: string[] = [];

      if (folderPath === 'ALL') {
        filePaths = await invoke<string[]>('scan_mobile_audio');
      } else {
        filePaths = await invoke<string[]>('scan_directory', { path: folderPath });
      }

      if (!filePaths?.length) {
        setScanProgress('No audio files found');
        setTimeout(() => setScanProgress(''), 2500);
        return;
      }

      const existing = new Set(playlistRef.current.map(t => t.path));
      const newTracks: Track[] = [];

      for (const fullPath of filePaths) {
        if (existing.has(fullPath)) continue;
        const fileName = fullPath.split('/').pop() || 'Unknown';
        let cleanName = stripExt(fileName)
          .replace(/9convert\.com\s*-\s*/i,'')
          .replace(/\[PagalWorld\.com\]/i,'')
          .replace(/\(Pagalworld\.mobi\)/i,'')
          .trim();
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
      // Start enriching immediately — don't wait for useEffect to fire
      setTimeout(() => enrichMetadataInBackground(merged), 400);
    } catch (e) {
      setScanProgress('Scan failed — check permissions');
      setTimeout(() => setScanProgress(''), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddFolder = () => {
    if (isMobile) {
      setShowFolderModal(true);
    } else {
      // Desktop: use native folder picker
      open({ directory: true, multiple: false }).then(sel => {
        if (sel && typeof sel === 'string') scanAndAdd(sel);
      });
    }
  };

  const handleClearLibrary = async () => {
    if (!confirm("Clear all tracks? Files won't be deleted.")) return;
    enricherRunning.current = false; // stop background enrichment
    setPlaylist([]); setFavorites([]); setScanProgress('');
    if (dbProcess.current) {
      await dbProcess.current.set("user_playlist",[]);
      await dbProcess.current.set("user_favorites",[]);
      await dbProcess.current.save();
    }
  };

  // ── BACKGROUND METADATA ENRICHER ─────────────────────────────────────────
  // Called after scanAndAdd. Reads only the first 128KB of each file
  // (enough for ID3v2 tags — title, artist, album, year, duration) using
  // the Rust read_file_head command. Processes 10 tracks at a time with
  // a 60ms yield between batches so the UI stays perfectly responsive.
  //
  // Why 128KB and not the full file?
  //   A typical MP3 ID3v2 header is 1–50KB. The remaining 8–12MB is audio
  //   frames. music-metadata reads the header first and stops when it has
  //   all text tags. By capping at 128KB we avoid loading audio data entirely,
  //   making each parse ~80x faster (8MB → 128KB read).
  const enrichMetadataInBackground = useCallback(async (tracks: Track[]) => {
    if (enricherRunning.current) return;
    enricherRunning.current = true;

    const needsEnrich = tracks.filter(t =>
      t.artist === 'Unknown Artist' || t.duration === 0
    );

    if (!needsEnrich.length) { enricherRunning.current = false; return; }

    setScanProgress(`Loading metadata for ${needsEnrich.length} tracks…`);

    // 30 tracks per batch — parallel reads saturate I/O without OOM
    // 20ms yield per batch — enough for React to paint 1 frame at 50fps
    const BATCH = 30;
    const DELAY = 20;
    let enriched = 0;
    // Only write to DB every 5 batches (150 tracks) to avoid excessive I/O
    let batchesSinceLastSave = 0;

    for (let i = 0; i < needsEnrich.length; i += BATCH) {
      if (!enricherRunning.current) break;

      const batch = needsEnrich.slice(i, i + BATCH);

      const results = await Promise.all(batch.map(async (track) => {
        try {
          // Read first 128KB — enough for all text ID3 tags in any format.
          // Rust returns Vec<u8> which Tauri serialises as a base64 string
          // when the return type is tagged with serde bytes, OR as number[]
          // when untagged. We handle both here.
          const raw = await invoke<number[] | string>('read_file_head', {
            path: track.path,
            maxBytes: 131072,
          });

          // Normalise to Uint8Array regardless of serialisation format
          let uint8: Uint8Array;
          if (typeof raw === 'string') {
            // base64 path (if Rust uses #[serde(with="serde_bytes")])
            const bin = atob(raw);
            uint8 = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) uint8[j] = bin.charCodeAt(j);
          } else {
            // number[] path (default Tauri Vec<u8> serialisation)
            uint8 = new Uint8Array(raw);
          }

          // FIXED: pass Uint8Array directly — mm.parseBuffer does NOT accept
          // ArrayBuffer (.buffer). Passing .buffer caused silent parse failures
          // which is why all tracks stayed "Unknown Artist".
const meta = await mm.parseBuffer(uint8, { mimeType: getMime(track.path) }, { skipCovers: true });
          const name     = meta.common.title  || track.name;
          const artist   = meta.common.artist || track.artist;
          const album    = meta.common.album  || track.album;
          const year     = meta.common.year?.toString() || track.year;
          const quality  = meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality;
          const duration = meta.format.duration || track.duration;

          const changed = name !== track.name || artist !== track.artist || duration !== track.duration;
          return changed ? { path: track.path, name, artist, album, year, quality, duration } : null;
        } catch (_) { return null; }
      }));

      const updates = results.filter(Boolean) as { path:string; name:string; artist:string; album:string; year:string; quality:string; duration:number }[];
      if (updates.length > 0) {
        const updateMap = new Map(updates.map(u => [u.path, u]));
        setPlaylist(prev => {
          const next = prev.map(t => {
            const u = updateMap.get(t.path);
            return u ? { ...t, ...u } : t;
          });
          batchesSinceLastSave++;
          // Write to DB every 5 batches (150 tracks) — reduces I/O pressure
          if (batchesSinceLastSave >= 5 && dbProcess.current) {
            batchesSinceLastSave = 0;
            dbProcess.current.set("user_playlist", next);
            dbProcess.current.save().catch(() => {});
          }
          return next;
        });
      }

      enriched += batch.length;
      const pct = Math.round((enriched / needsEnrich.length) * 100);
      setScanProgress(`Loading metadata… ${pct}%`);

      // Yield one frame so React can paint the updated rows
      await new Promise(r => setTimeout(r, DELAY));
    }

    // Final DB save with whatever is in the playlist now
    if (dbProcess.current) {
      dbProcess.current.set("user_playlist", playlistRef.current);
      dbProcess.current.save().catch(() => {});
    }

    setScanProgress('');
    enricherRunning.current = false;
  }, []);

  // Start enrichment whenever the playlist gains new "Unknown Artist" tracks
  useEffect(() => {
    const needsWork = playlist.some(t => t.artist === 'Unknown Artist' || t.duration === 0);
    if (needsWork && !enricherRunning.current) {
      // Small delay so the UI finishes rendering the new tracks first
      setTimeout(() => enrichMetadataInBackground(playlistRef.current), 800);
    }
  }, [playlist.length]); // only re-run when track COUNT changes, not on every metadata update

  // ── BULK CATEGORY SCANNER (mobile only) ─────────────────────────────────
  // Pre-scans every track's audio fingerprint so future plays are instant.
  // Runs 1 track at a time (sequential — the C++ analyzer uses the loaded
  // sound state, so we must LOAD → ANALYZE each track individually).
  // Can be paused/resumed. Completed profiles are persisted every 20 tracks.
  const startBulkCategoryScan = useCallback(async () => {
    if (bulkScanRunning.current) return;

    const unscanned = playlistRef.current.filter(t => !t.profile);
    if (!unscanned.length) { setBulkScanActive(false); return; }

    bulkScanRunning.current = true;
    bulkScanPausedRef.current = false;
    setBulkScanActive(true);
    setBulkScanPaused(false);
    setBulkScanDone(0);
    setBulkScanTotal(unscanned.length);

    let done = 0;
    let pendingSave: { path:string; profile:string }[] = [];

    for (const track of unscanned) {
      // Pause checkpoint — loop waits here until resumed or stopped
      while (bulkScanPausedRef.current && bulkScanRunning.current) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (!bulkScanRunning.current) break;

      try {
        // Load silently (streaming = no freeze)
        await invoke('audio_command', { cmd: `LOAD ${track.path}` });
        await new Promise(r => setTimeout(r, 150)); // let decoder init

        const fpLine: string = await invoke('analyze_current_track');
        if (fpLine.startsWith("FINGERPRINT ")) {
          const p = fpLine.split(' ');
          const prof = classifyAudio(parseFloat(p[1])||0, parseFloat(p[2])||10, parseFloat(p[3])||0.1, parseFloat(p[4])||0.1);
          setPlaylist(prev => prev.map(t => t.path===track.path ? {...t, profile:prof.id} : t));
          pendingSave.push({ path: track.path, profile: prof.id });
        }
      } catch (_) {}

      done++;
      setBulkScanDone(done);

      // Write to DB every 20 tracks
      if (pendingSave.length >= 20 && dbProcess.current) {
        const m = new Map(pendingSave.map(x => [x.path, x.profile]));
        const snap = playlistRef.current.map(t => m.has(t.path) ? {...t, profile:m.get(t.path)!} : t);
        dbProcess.current.set("user_playlist", snap);
        dbProcess.current.save().catch(() => {});
        pendingSave = [];
      }

      // 50ms yield between tracks — keeps UI fully interactive
      await new Promise(r => setTimeout(r, 50));
    }

    // Final DB save
    if (pendingSave.length > 0 && dbProcess.current) {
      const m = new Map(pendingSave.map(x => [x.path, x.profile]));
      const snap = playlistRef.current.map(t => m.has(t.path) ? {...t, profile:m.get(t.path)!} : t);
      dbProcess.current.set("user_playlist", snap);
      dbProcess.current.save().catch(() => {});
    }

    bulkScanRunning.current = false;
    setBulkScanActive(false);
    setBulkScanPaused(false);
  }, []);

  const pauseBulkScan  = useCallback(() => { bulkScanPausedRef.current=true;  setBulkScanPaused(true);  }, []);
  const resumeBulkScan = useCallback(() => { bulkScanPausedRef.current=false; setBulkScanPaused(false); }, []);
  const stopBulkScan   = useCallback(() => {
    bulkScanRunning.current=false; bulkScanPausedRef.current=false;
    setBulkScanActive(false); setBulkScanPaused(false);
  }, []);

  // CRITICAL PERFORMANCE RULES:
  // 1. ZERO file I/O before LOAD+PLAY — music starts in <50ms
  // 2. All 8 DSP resets sent as parallel Promise.all — not 8 sequential awaits
  // 3. readFile (reads full MP3 binary) deferred 300ms after playback starts
  // 4. setPlaylist only called when data actually changes, never inside the hot path
  const playTrack = async (track: Track) => {
    const id = ++loadIdRef.current;

    // Immediate UI update — no async work yet, no setIsLoading (avoids re-render of virtual list)
    setCurrentTrack(track);
    setIsPlaying(false);
    setCurrentTime(0);
    setTrackTitle(track.name);
    setTrackArtist(track.artist);
    setDetectedProfile(null);
    detectedProfileRef.current = null;
    setLyrics(track.lyrics?.length ? track.lyrics : []);
    setAlbumArt(prev => { if (prev) URL.revokeObjectURL(prev); return null; });

    try {
      // ── STEP 1: Batch ALL engine commands in parallel, then LOAD, then PLAY ──
      // Promise.all fires all 7 DSP resets simultaneously instead of 7 sequential
      // round-trips. On Android IPC this saves ~100ms.
      await Promise.all([
        writeToEngine(`VOLUME ${volume}`),
        writeToEngine('REMASTER 0'),
        writeToEngine('COMPRESS 0'),
        writeToEngine('UPSCALE 0'),
        writeToEngine('WIDEN 1.0'),
        writeToEngine('3D 0'),
        writeToEngine('REVERB 0'),
      ]);
      if (id !== loadIdRef.current) return;

      await writeToEngine(`LOAD ${track.path}`);
      if (id !== loadIdRef.current) return;

      await writeToEngine('PLAY');
      setIsPlaying(true); // ← music is playing HERE, all UI is responsive

      // ── STEP 2: Defer ALL file I/O — runs 300ms after music starts ──
      // readFile() reads the entire audio file binary into JS memory.
      // Calling it synchronously would freeze the UI for 200-500ms.
      // A 300ms delay gives the audio engine time to buffer and the
      // React reconciler time to paint the updated mini player.
      setTimeout(async () => {
        if (id !== loadIdRef.current) return;

        try {
          const fileData = await readFile(track.path);
          if (id !== loadIdRef.current) return;

          // skipCovers:false so we get album art, but skip expensive
          // duration calculation since engine has it
          const meta = await mm.parseBuffer(fileData, { mimeType: getMime(track.path) });
          if (id !== loadIdRef.current) return;

          const title  = meta.common.title  || track.name;
          const artist = meta.common.artist || track.artist;
          setTrackTitle(title);
          setTrackArtist(artist);

          // Album art — process immediately while title/artist are fresh
          if (meta.common.picture?.length) {
            const pic = meta.common.picture[0];
            const blob = new Blob([pic.data], { type: pic.format });
            const imgUrl = URL.createObjectURL(blob);
            if (id !== loadIdRef.current) { URL.revokeObjectURL(imgUrl); return; }
            setAlbumArt(imgUrl);
            try {
              const [facColor, palette] = await Promise.all([
                fac.getColorAsync(imgUrl, { algorithm: 'dominant' }).catch(() => null),
                getPalette(imgUrl)
              ]);
              if (id === loadIdRef.current) {
                setBlobColors(palette);
                const dom = (facColor && !facColor.error) ? facColor.hex : (palette[1] || '#c8222a');
                setThemeColor(dom);
                setThemeText(isHexDark(dom) ? '#ffffff' : '#111111');
              }
            } catch (_) {}
          }

          // Try .lrc file
          try {
            const lrcText = await readTextFile(track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc');
            if (id === loadIdRef.current && lrcText) setLyrics(parseLRC(lrcText));
          } catch (_) {}

          // Persist richer metadata to store — but only if something changed
          // Use a ref comparison on just name+artist to avoid stringify overhead
          const hasNewData = title !== track.name || artist !== track.artist
            || (meta.format.duration && meta.format.duration !== track.duration);
          if (hasNewData) {
            const updatedTrack: Track = {
              ...track, name: title, artist,
              album:    meta.common.album || track.album,
              year:     meta.common.year?.toString() || track.year,
              quality:  meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality,
              duration: meta.format.duration || track.duration,
            };
            const newList = playlistRef.current.map(t => t.path === track.path ? updatedTrack : t);
            setPlaylist(newList);
            // Debounce DB write — don't block on every track play
            if (dbProcess.current) {
              dbProcess.current.set("user_playlist", newList);
              // save() deliberately not awaited — fire and forget
              dbProcess.current.save().catch(() => {});
            }
          }
        } catch (_) {} // metadata failure is non-fatal — music is already playing
      }, 300);

      // ── STEP 3: Smart DSP analysis — only run if not already cached ──────────
      // If track.profile is set, analysis was done on a previous play.
      // Load the stored profile instantly — zero C++ processing needed.
      // If not set, run analyze_current_track 2s after play starts.
      const cachedProfile = track.profile ? PROFILES.find(p => p.id === track.profile) : null;

      if (cachedProfile) {
        // Instant: apply cached DSP settings, no analysis needed
        setDetectedProfile(cachedProfile);
        detectedProfileRef.current = cachedProfile;
        await applySmartSettings(cachedProfile, smartTasteRef.current);
      } else {
        // First play of this track — run full fingerprint analysis after 2s
        setTimeout(async () => {
          if (id !== loadIdRef.current) return;
          setIsAnalyzing(true);
          try {
            const fpLine: string = await invoke('analyze_current_track');
            if (id !== loadIdRef.current) return;
            if (fpLine.startsWith("FINGERPRINT ")) {
              const parts = fpLine.split(' ');
              const profile = classifyAudio(
                parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 10,
                parseFloat(parts[3]) || 0.1, parseFloat(parts[4]) || 0.1
              );
              setDetectedProfile(profile);
              detectedProfileRef.current = profile;
              await applySmartSettings(profile, smartTasteRef.current);

              // Persist the profile so next play is instant (cache hit)
              const upd = { ...track, profile: profile.id };
              const nl  = playlistRef.current.map(t => t.path === track.path ? upd : t);
              setPlaylist(nl);
              if (dbProcess.current) {
                dbProcess.current.set("user_playlist", nl);
                dbProcess.current.save().catch(() => {});
              }
            }
          } catch (_) {} finally { setIsAnalyzing(false); }
        }, 2000);
      }

    } catch (_) {
      // Hard fallback — at minimum get audio playing
      if (id === loadIdRef.current) {
        try {
          await writeToEngine(`LOAD ${track.path}`);
          await writeToEngine('PLAY');
          setIsPlaying(true);
        } catch (_) {}
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
    let pRem=false,pCmp=false,pDrv=0.0,pWid=1.0,p3D=0.0,pRvb=0.0;
    if (preset==='STUDIO')   { pCmp=true; pDrv=0.7; pWid=1.10; }
    else if (preset==='CINEMATIC') { pRem=true; pCmp=true; pDrv=1.2; pWid=1.35; p3D=0.25; pRvb=0.16; }
    else                           { p3D=0.40; pRvb=0.22; }
    setIsRemastered(pRem); setIsCompressed(pCmp); setUpscaleDrive(pDrv);
    setWidenWidth(pWid); setSpatialExtra(p3D); setReverbWet(pRvb);
    await writeToEngine(`REMASTER ${pRem?1:0}`); await writeToEngine(`COMPRESS ${pCmp?1:0}`);
    await writeToEngine(`UPSCALE ${pDrv}`);      await writeToEngine(`WIDEN ${pWid}`);
    await writeToEngine(`3D ${p3D}`);             await writeToEngine(`REVERB ${pRvb}`);
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const TASTES: {id:Taste;icon:string;label:string}[] = [
    {id:'QUALITY',icon:'✨',label:'HD Clear'},{id:'IMMERSIVE',icon:'🌌',label:'Immersive'},{id:'CHILL',icon:'🌙',label:'Chill'},
  ];

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
        </div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Harmonic Exciter</label><span className="val-green">{upscaleDrive.toFixed(1)}×</span></div><input type="range" className="dsp-slider exciter" min="0" max="2" step="0.1" value={upscaleDrive} onChange={e=>{const v=parseFloat(e.target.value);setUpscaleDrive(v);writeToEngine(`UPSCALE ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{Math.round((widenWidth-1)*100)}% extra</span></div><input type="range" className="dsp-slider widener" min="1" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(`WIDEN ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?`+${Math.round(spatialExtra*100)}%`:'Base'}</span></div><input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(`3D ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Reverb</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div><input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(`REVERB ${v}`)}}/></div>
      </div>
    </div>
  );

  const renderExpandedControls = () => {
    const isLong = trackTitle.length > 25;
    const artistIsLong = trackArtist.length > 30;
    return (
      <div className="ep-controls-section">
        <div className="ep-track-header">
          <div className={`marquee-container ${isLong?'scrolling':''}`}>
            <div className={`ep-title-wrapper ${isLong?'marquee':''}`}>
              <h1 className="ep-title">{trackTitle}</h1>
              {isLong && <h1 className="ep-title">{trackTitle}</h1>}
            </div>
          </div>
          <div className={`ep-artist-marquee ${artistIsLong?'scrolling':''}`}>
            <div className={`ep-artist-inner ${artistIsLong?'marquee':''}`}>
              <h2 className="ep-artist">{trackArtist}</h2>
              {artistIsLong && <h2 className="ep-artist">{trackArtist}</h2>}
            </div>
          </div>
        </div>
        {renderSmartPills()}
        <div className="ep-volume-row">
          <button className="vol-btn" onClick={async()=>{const v=Math.max(0,volume-0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
          </button>
          <input type="range" className="ep-volume-slider" min="0" max="1" step="0.02" value={volume} onChange={async e=>{const v=parseFloat(e.target.value);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}/>
          <button className="vol-btn" onClick={async()=>{const v=Math.min(1,volume+0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <span className="vol-pct">{Math.round(volume*100)}%</span>
        </div>
        <div className="ep-actions">
          <button className="ep-icon-btn" onClick={toggleFavorite} style={{color:isCurrentFavorite?'var(--theme-color)':undefined}}>{isCurrentFavorite?'♥':'♡'}</button>
          <button className="ep-icon-btn" onClick={e=>{e.stopPropagation();setShowLyrics(!showLyrics);setShowStudio(false);}} style={{color:showLyrics?'var(--theme-color)':undefined}} title="Lyrics">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button className={`ep-icon-btn ${showStudio?'active-glow':''}`} onClick={e=>{e.stopPropagation();if(isMobile){setShowDSPPage(true);setShowStudio(false);setShowLyrics(false);}else{setShowStudio(!showStudio);setShowLyrics(false);}}} style={{color:showStudio?'#00e676':undefined}} title="Fine Tune DSP">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
          </button>
        </div>
        <div className="ep-progress-container">
          <input type="range" className="ep-progress-bar" min="0" max={duration||1} value={currentTime} onChange={handleSeek}/>
          <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="ep-main-controls">
  <button className="ep-ctrl-btn">
    <svg viewBox="0 0 512 512" width="1.1em" height="1.1em" fill="currentColor">
      <path d="M418.976,324.763c-2.839-2.106-6.667-2.358-9.748-0.638c-3.081,1.733-4.861,5.103-4.573,8.628l2.454,28.148 c-11.937-1.733-22.768-4.429-32.732-7.954c-13.334-4.742-25.199-10.951-36.246-18.448c-16.535-11.24-31.24-25.524-45.056-42.059 c-5.295-6.318-10.446-12.972-15.524-19.868c-2.792,4.152-5.512,8.244-8.063,12.155c-9.723,14.74-20.145,30.169-31.625,45.32 c10.373,12.816,21.661,25.295,34.345,36.884c19.784,18.087,43.058,34.008,70.567,45.177c19.616,7.99,41.301,13.429,65.032,15.908 l-3.153,36.054c-0.288,3.513,1.492,6.894,4.573,8.616c3.081,1.733,6.908,1.48,9.748-0.626l89.388-66.44 c2.287-1.697,3.635-4.368,3.635-7.209c0-2.839-1.348-5.523-3.635-7.22L418.976,324.763z"/>
      <path d="M77.186,159.054c13.31,4.742,25.199,10.951,36.222,18.448c16.559,11.24,31.264,25.524,45.08,42.047 c5.295,6.33,10.445,12.985,15.524,19.88c2.792-4.164,5.488-8.244,8.063-12.155c9.7-14.74,20.121-30.156,31.626-45.32 c-10.373-12.816-21.661-25.295-34.345-36.885c-19.784-18.086-43.058-34.02-70.568-45.175 c-27.51-11.204-59.039-17.497-94.612-17.473H0v66.547h14.176C38.966,148.993,59.4,152.748,77.186,159.054z"/>
      <path d="M288.504,225.133c9.074-11.324,18.532-21.734,28.592-30.916c15.115-13.79,31.481-24.838,50.735-32.672 c11.746-4.754,24.67-8.365,39.279-10.47l-2.454,28.172c-0.288,3.526,1.492,6.896,4.573,8.628c3.081,1.72,6.908,1.468,9.748-0.638 l89.388-66.428c2.287-1.697,3.635-4.381,3.635-7.22c0-2.84-1.348-5.512-3.635-7.209l-89.388-66.44 c-2.839-2.106-6.667-2.359-9.748-0.626c-3.081,1.722-4.861,5.103-4.573,8.616l3.153,36.042 c-20.024,2.106-38.63,6.282-55.718,12.371c-18.942,6.727-36.03,15.681-51.385,26.127c-23.033,15.667-42.119,34.561-58.702,54.393 c-16.583,19.844-30.759,40.687-44.02,60.856c-11.408,17.328-22.816,34.044-34.923,49.147 c-9.074,11.324-18.532,21.722-28.593,30.916c-15.115,13.79-31.481,24.826-50.735,32.672c-19.279,7.81-41.662,12.552-69.558,12.575 H0v66.548h14.176c31.626,0.024,60.05-4.934,85.298-13.922c18.917-6.727,36.03-15.681,51.361-26.127 c23.057-15.668,42.119-34.562,58.702-54.393c16.607-19.844,30.783-40.687,44.045-60.856 C264.965,256.939,276.398,240.235,288.504,225.133z"/>
    </svg>
  </button>
  <button className="ep-ctrl-btn" onClick={e=>{e.stopPropagation();handlePrev();}}>
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
  </button>
  <button className="ep-play-btn" onClick={handlePlayPause}>
    {isPlaying ?
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .656-.656c.163-.32.163-.74.163-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C8.861 3 8.441 3 7.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656zm9 0C14 4.139 14 4.559 14 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z"/></svg>
      :
      <svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)"/></svg>
    }
  </button>
  <button className="ep-ctrl-btn" onClick={e=>{e.stopPropagation();handleNext();}}>
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
  </button>
  <button className="ep-ctrl-btn">
    <svg viewBox="0 0 256 256" width="1.1em" height="1.1em" fill="currentColor">
      <g fillRule="evenodd">
        <path d="M109.533 197.602a1.887 1.887 0 0 1-.034 2.76l-7.583 7.066a4.095 4.095 0 0 1-5.714-.152l-32.918-34.095c-1.537-1.592-1.54-4.162-.002-5.746l33.1-34.092c1.536-1.581 4.11-1.658 5.74-.18l7.655 6.94c.82.743.833 1.952.02 2.708l-21.11 19.659s53.036.129 71.708.064c18.672-.064 33.437-16.973 33.437-34.7 0-7.214-5.578-17.64-5.578-17.64-.498-.99-.273-2.444.483-3.229l8.61-8.94c.764-.794 1.772-.632 2.242.364 0 0 9.212 18.651 9.212 28.562 0 28.035-21.765 50.882-48.533 50.882-26.769 0-70.921.201-70.921.201l20.186 19.568z"/>
        <path d="M144.398 58.435a1.887 1.887 0 0 1 .034-2.76l7.583-7.066a4.095 4.095 0 0 1 5.714.152l32.918 34.095c1.537 1.592 1.54 4.162.002 5.746l-33.1 34.092c-1.536 1.581-4.11 1.658-5.74.18l-7.656-6.94c-.819-.743-.832-1.952-.02-2.708l21.111-19.659s-53.036-.129-71.708-.064c-18.672.064-33.437 16.973-33.437 34.7 0 7.214 5.578 17.64 5.578 17.64.498.99.273 2.444-.483 3.229l-8.61 8.94c-.764.794-1.772.632-2.242-.364 0 0-9.212-18.65-9.212-28.562 0-28.035 21.765-50.882 48.533-50.882 26.769 0 70.921-.201 70.921-.201l-20.186-19.568z"/>
        <path d="M127.992 104.543l6.53.146c1.105.025 2.013.945 2.027 2.037l.398 30.313a1.97 1.97 0 0 0 2.032 1.94l4.104-.103a1.951 1.951 0 0 1 2.01 1.958l.01 4.838a2.015 2.015 0 0 1-1.99 2.024l-21.14.147a1.982 1.982 0 0 1-1.994-1.983l-.002-4.71c0-1.103.897-1.997 1.996-1.997h4.254a2.018 2.018 0 0 0 2.016-1.994l.169-16.966-6.047 5.912-6.118-7.501 11.745-14.061z" stroke="currentColor"/>
      </g>
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

  /** Bulk category scan progress banner — shown when scan is running/paused */
  const renderBulkScanBanner = () => {
    const unscannedCount = playlist.filter(t => !t.profile).length;
    if (!bulkScanActive && unscannedCount === 0) return null; // all done, hide it

    const pct = bulkScanTotal > 0 ? Math.round((bulkScanDone / bulkScanTotal) * 100) : 0;

    return (
      <div className="bulk-scan-banner">
        {bulkScanActive ? (
          <>
            <div className="bulk-scan-info">
              <span className="bulk-scan-label">
                {bulkScanPaused ? '⏸ Paused' : '🎵 Scanning'} — {bulkScanDone}/{bulkScanTotal} tracks
              </span>
              <span className="bulk-scan-pct">{pct}%</span>
            </div>
            <div className="bulk-scan-bar">
              <div className="bulk-scan-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="bulk-scan-actions">
              {bulkScanPaused
                ? <button className="bulk-btn resume" onClick={resumeBulkScan}>▶ Resume</button>
                : <button className="bulk-btn pause"  onClick={pauseBulkScan}>⏸ Pause</button>
              }
              <button className="bulk-btn stop" onClick={stopBulkScan}>✕ Stop</button>
            </div>
          </>
        ) : (
          // Not active — show a "Scan Profiles" prompt if unscanned tracks exist
          unscannedCount > 0 && (
            <button className="bulk-scan-start-btn" onClick={startBulkCategoryScan}>
              <span>🎯</span>
              <div>
                <div className="bulk-start-title">Pre-scan Audio Profiles</div>
                <div className="bulk-start-hint">{unscannedCount} tracks not yet categorised — tap to scan in background</div>
              </div>
            </button>
          )
        )}
      </div>
    );
  };

  const renderMobileTabs = () => (
    <div className="mobile-tabs">
      <button className={currentView==='ALL'?'active':''} onClick={()=>setCurrentView('ALL')}>🎵 Tracks <span className="tab-count">{playlist.length}</span></button>
      <button className={currentView==='FAVORITES'?'active':''} onClick={()=>setCurrentView('FAVORITES')}>❤️ Favorites <span className="tab-count">{favorites.length}</span></button>
      <button className={currentView==='BOLLYWOOD'?'active':''} onClick={()=>setCurrentView('BOLLYWOOD')}>🎙️ Bollywood <span className="tab-count">{bollywoodCount}</span></button>
    </div>
  );

  const isRightPaneActive = showLyrics || showStudio;

  return (
    <div className="app-layout" data-theme={isDarkMode?'dark':'light'} style={{
      '--theme-color': themeColor, '--theme-text': themeText,
      '--blob-1': blobColors[0], '--blob-2': blobColors[1], '--blob-3': blobColors[2],
      '--audio-level': audioLevel,
    } as React.CSSProperties}>

      {/* Folder picker modal (mobile) */}
      {showFolderModal && <FolderModal onClose={()=>setShowFolderModal(false)} onScan={scanAndAdd}/>}

      {/* Desktop sidebar */}
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
          <button className={currentView==='BOLLYWOOD'?'active':''} onClick={()=>setCurrentView('BOLLYWOOD')}>🎙️ Bollywood <span className="nav-count">{bollywoodCount}</span></button>
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
                    {(()=>{const tl=trackTitle.length>22;return(<div className={`mini-marquee-clip ${tl?'scrolling':''}`}><div className={`mini-marquee-inner ${tl?'running':''}`}><span className="track-title">{trackTitle}</span>{tl&&<span className="track-title">{trackTitle}</span>}</div></div>);})()}
                    {(()=>{const al=trackArtist.length>26;return(<div className={`mini-marquee-clip ${al?'scrolling':''}`}><div className={`mini-marquee-inner ${al?'running':''}`}><span className="artist-subtitle">{trackArtist}{detectedProfile&&<span className="mini-profile"> {detectedProfile.icon}</span>}</span>{al&&<span className="artist-subtitle">{trackArtist}{detectedProfile&&<span className="mini-profile"> {detectedProfile.icon}</span>}</span>}</div></div>);})()}
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
              <div className="ep-header" style={{position:'relative',zIndex:10}}>
                <button className="ep-icon-btn" onClick={e=>{e.stopPropagation();setIsExpanded(false);}}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {detectedProfile&&<div className="ep-profile-badge">{detectedProfile.icon} {detectedProfile.label}</div>}
                <button className="ep-icon-btn">⋮</button>
              </div>
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