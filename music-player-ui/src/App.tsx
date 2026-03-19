import { useEffect, useRef, useState } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile } from "@tauri-apps/plugin-fs";
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

interface DSPSettings {
  drive: number; widen: number; spatial: number;
  reverb: number; compress: boolean; remaster: boolean;
}
interface AudioProfile {
  id: string; label: string; icon: string; description: string;
  settings: DSPSettings;
}

const PROFILES: AudioProfile[] = [
  {
    id: 'CLASSICAL', label: 'Classical / Orchestral', icon: '🎻',
    description: 'High dynamic range · Natural wide field',
    settings: { drive:0.2, widen:1.25, spatial:0.08, reverb:0.10, compress:false, remaster:false }
  },
  {
    id: 'BOLLYWOOD', label: '90s Bollywood Classics', icon: '🎙️',
    description: 'Warm vintage analog · Vocals front & center',
    settings: { drive:0.4, widen:1.12, spatial:0.05, reverb:0.05, compress:true, remaster:true }
  },
  {
    id: 'VOCAL', label: 'Vocal / Acoustic', icon: '🎤',
    description: 'Center-heavy · Lead vocals protected',
    settings: { drive:0.4, widen:1.10, spatial:0.05, reverb:0.04, compress:true, remaster:false }
  },
  {
    id: 'ELECTRONIC', label: 'Electronic / EDM', icon: '⚡',
    description: 'Brickwall master · Exciter restores air',
    settings: { drive:1.4, widen:1.25, spatial:0.08, reverb:0.04, compress:true, remaster:false }
  },
  {
    id: 'HIPHOP', label: 'Hip-Hop / R&B', icon: '🎧',
    description: 'Punchy · Tight dynamics',
    settings: { drive:1.0, widen:1.15, spatial:0.06, reverb:0.03, compress:true, remaster:true }
  },
  {
    id: 'AMBIENT', label: 'Ambient / Chill', icon: '🌊',
    description: 'Low energy signal · Generous reverb space',
    settings: { drive:0.1, widen:1.0, spatial:0.20, reverb:0.18, compress:false, remaster:false }
  },
  {
    id: 'POP', label: 'Pop / Standard', icon: '🎵',
    description: 'Balanced mix · Universal profile',
    settings: { drive:0.7, widen:1.20, spatial:0.07, reverb:0.06, compress:true, remaster:false }
  },
];

function classifyAudio(sc: number, cf: number, zcr: number, rms: number): AudioProfile {
  if (cf > 18 && rms < 0.08)               return PROFILES[5]; // AMBIENT
  if (cf > 14 && sc > 0.70 && zcr < 0.08) return PROFILES[0]; // CLASSICAL
  if (sc > 0.88 && cf > 10 && zcr < 0.05) return PROFILES[1]; // BOLLYWOOD
  if (sc > 0.80 && cf > 10)               return PROFILES[2]; // VOCAL
  if (cf < 8   && zcr > 0.12)             return PROFILES[3]; // ELECTRONIC
  if (cf < 11  && rms > 0.18)             return PROFILES[4]; // HIPHOP
  return PROFILES[6];
}

function applyTaste(base: DSPSettings, taste: Taste): DSPSettings {
  const s = { ...base };
  if (taste === 'QUALITY') {
    s.drive   = Math.min(2.0, base.drive + 0.20);
    s.widen   = Math.min(1.5, 1.0 + (base.widen - 1.0) * 0.60);
    s.spatial = 0.0;
    s.reverb  = Math.min(base.reverb, 0.06);
  } else if (taste === 'IMMERSIVE') {
    s.drive   = Math.min(2.0, base.drive + 0.12);
    s.widen   = Math.min(1.5, base.widen + 0.15);
    s.spatial = Math.min(0.35, base.spatial + 0.08);
    s.reverb  = Math.min(0.25, base.reverb + 0.05);
  } else {
    s.drive    = Math.min(2.0, base.drive * 0.35);
    s.widen    = 1.0;
    s.spatial  = Math.min(0.40, base.spatial + 0.18);
    s.reverb   = Math.min(0.30, base.reverb + 0.12);
    s.compress = false;
  }
  return s;
}

const fac = new FastAverageColor();

const getPalette = (imgUrl: string): Promise<string[]> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(['#c8222a','#8a1520','#6a1018']);
      ctx.drawImage(img, 0, 0);
      const hex = (x: number, y: number) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return "#" + [d[0],d[1],d[2]].map(v => v.toString(16).padStart(2,'0')).join('');
      };
      resolve([
        hex(Math.floor(img.width*0.2), Math.floor(img.height*0.2)),
        hex(Math.floor(img.width*0.5), Math.floor(img.height*0.5)),
        hex(Math.floor(img.width*0.8), Math.floor(img.height*0.8)),
      ]);
    };
    img.onerror = () => resolve(['#c8222a','#8a1520','#6a1018']);
    img.src = imgUrl;
  });

const isHexDark = (hex: string): boolean => {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq < 128; 
};

const getMime = (path: string) => {
  if (path.endsWith('.wav'))  return 'audio/wav';
  if (path.endsWith('.flac')) return 'audio/flac';
  if (path.endsWith('.ogg'))  return 'audio/ogg';
  if (path.endsWith('.aac') || path.endsWith('.m4a')) return 'audio/aac';
  return 'audio/mpeg';
};

const isAudio = (name?: string) =>
  !!name && ['.mp3','.wav','.flac','.ogg','.aac','.m4a']
    .some(ext => name.toLowerCase().endsWith(ext));

const stripExt = (name: string) =>
  name.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i, '');

function App() {
  const [isPlaying, setIsPlaying]       = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [currentTime, setCurrentTime]   = useState(0);
  const [duration, setDuration]         = useState(0);
  const [audioLevel, setAudioLevel]     = useState(0);

  const [playlist, setPlaylist]         = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [favorites, setFavorites]       = useState<string[]>([]);
  const [currentView, setCurrentView]   = useState<NavView>('ALL');
  const [searchQuery, setSearchQuery]   = useState('');

  const [albumArt, setAlbumArt]         = useState<string | null>(null);
  const [trackTitle, setTrackTitle]     = useState('Ready');
  const [trackArtist, setTrackArtist]   = useState('DmeX Player');
  const [themeColor, setThemeColor]     = useState('#c8222a');
  const [themeText, setThemeText]       = useState('#ffffff');
  const [blobColors, setBlobColors]     = useState(['#c8222a','#8a1520','#6a1018']);

  const [lyrics, setLyrics]             = useState<LyricLine[]>([]);
  const [isExpanded, setIsExpanded]     = useState(false);
  const [showLyrics, setShowLyrics]     = useState(false);
  const [showStudio, setShowStudio]     = useState(false);

  const [isDarkMode, setIsDarkMode]     = useState(true);

  const [volume, setVolume]             = useState(1.0);
  const [isRemastered, setIsRemastered] = useState(false);
  const [isCompressed, setIsCompressed] = useState(false);
  const [upscaleDrive, setUpscaleDrive] = useState(0.0);
  const [widenWidth, setWidenWidth]     = useState(1.0);
  const [spatialExtra, setSpatialExtra] = useState(0.0);
  const [reverbWet, setReverbWet]       = useState(0.0);

  const [smartTaste, setSmartTaste]           = useState<Taste>('QUALITY');
  const [detectedProfile, setDetectedProfile] = useState<AudioProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing]         = useState(false);

  const smartTasteRef      = useRef<Taste>('QUALITY');
  const detectedProfileRef = useRef<AudioProfile | null>(null);
  const fpResolverRef      = useRef<((l: string) => void) | null>(null);
  const engineProcess      = useRef<any>(null);
  const dbProcess          = useRef<any>(null);
  const loadIdRef          = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const playlistRef        = useRef<Track[]>([]);
  
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);

  const displayedTracks = (() => {
    let base = playlist;
    if      (currentView === 'FAVORITES') base = playlist.filter(t => favorites.includes(t.path));
    else if (currentView === 'BOLLYWOOD') base = playlist.filter(t => t.profile === 'BOLLYWOOD');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
    }
    return base;
  })();

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = async (cmd: string) => {
    if (!engineProcess.current) return;
    try { await engineProcess.current.write(cmd); } catch (_) {}
  };

  useEffect(() => {
    let mounted = true;
    async function bootDatabase() {
      const store = await load("library.json", { autoSave: true });
      dbProcess.current = store;
      const saved = await store.get<Track[]>("user_playlist");
      if (saved?.length) setPlaylist(saved);
      const savedFavs = await store.get<string[]>("user_favorites");
      if (savedFavs) setFavorites(savedFavs);
      const savedDark = await store.get<boolean>("isDarkMode");
      if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
    }
    async function startEngine() {
      try {
        const command = Command.sidecar("bin/AudioEngine");
        command.on('close', () => {
          if (!mounted) return;
          engineProcess.current = null;
          setIsPlaying(false); setIsLoading(false);
          startEngine();
        });
        const child = await command.spawn();
        engineProcess.current = child;
        command.stdout.on('data', (line: string) => {
          const t = line.trim();
          if (t.startsWith("TIME ")) {
            const p = t.split(" ");
            setCurrentTime(parseFloat(p[1]) || 0);
            setDuration(parseFloat(p[2]) || 0);
            setAudioLevel(Math.min(1, (parseFloat(p[3]) || 0) * 2.5));
          } else if (t.startsWith("LEVEL ")) {
            setAudioLevel(Math.min(1, (parseFloat(t.split(" ")[1]) || 0) * 2.5));
          } else if (t.startsWith("FINGERPRINT ")) {
            fpResolverRef.current?.(t);
            fpResolverRef.current = null;
          }
        });
      } catch (_) {}
    }
    bootDatabase();
    startEngine();
    return () => { mounted = false; if (engineProcess.current) writeToEngine("QUIT\n"); };
  }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (engineProcess.current && isPlaying && !isLoading) await writeToEngine("GET_TIME\n");
    }, 500);
    return () => clearInterval(iv);
  }, [isPlaying, isLoading]);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (engineProcess.current && isPlaying && !isLoading) await writeToEngine("LEVEL\n");
    }, 150);
    return () => clearInterval(iv);
  }, [isPlaying, isLoading]);

  useEffect(() => {
    if (duration > 0 && currentTime >= duration - 0.5 && !isLoading) handleNext();
  }, [currentTime, duration, isLoading]);

  const toggleTheme = async () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    if (dbProcess.current) {
      await dbProcess.current.set("isDarkMode", next);
      await dbProcess.current.save();
    }
  };

  const applySmartSettings = async (profile: AudioProfile, taste: Taste) => {
    const s = applyTaste(profile.settings, taste);
    setUpscaleDrive(s.drive); setWidenWidth(s.widen);
    setSpatialExtra(s.spatial); setReverbWet(s.reverb);
    setIsCompressed(s.compress); setIsRemastered(s.remaster);
    await writeToEngine(
      `UPSCALE ${s.drive}\nWIDEN ${s.widen}\n3D ${s.spatial}\nREVERB ${s.reverb}\n` +
      `COMPRESS ${s.compress ? 1 : 0}\nREMASTER ${s.remaster ? 1 : 0}\n`
    );
  };

  const handleTasteChange = async (taste: Taste) => {
    setSmartTaste(taste);
    smartTasteRef.current = taste;
    if (detectedProfileRef.current) await applySmartSettings(detectedProfileRef.current, taste);
  };

  const adjustVolume = async (delta: number) => {
    const next = Math.max(0, Math.min(1, volume + delta));
    setVolume(next);
    await writeToEngine(`VOLUME ${next}\n`);
  };

  const activeLyricIndex = lyrics.findIndex((lyric, i) => {
    const next = lyrics[i + 1];
    return currentTime >= lyric.time && (!next || currentTime < next.time);
  });

  useEffect(() => {
    if (lyricsContainerRef.current && activeLyricIndex !== -1 && showLyrics) {
      const el = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLyricIndex, showLyrics]);

  const handleNext = () => {
    const { displayedTracks: list, currentTrack: track } = stateRefs.current;
    if (!list.length || !track) return;
    const i = list.findIndex(t => t.path === track.path);
    playTrack(list[(i + 1) >= list.length ? 0 : i + 1]);
  };

  const handlePrev = () => {
    const { displayedTracks: list, currentTrack: track } = stateRefs.current;
    if (!list.length || !track) return;
    const i = list.findIndex(t => t.path === track.path);
    playTrack(list[(i - 1) < 0 ? list.length - 1 : i - 1]);
  };

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setCurrentTime(v);
    if (!isLoading) await writeToEngine(`SEEK ${v}\n`);
  };

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || !dbProcess.current) return;
    const newFavs = favorites.includes(currentTrack.path)
      ? favorites.filter(p => p !== currentTrack.path)
      : [...favorites, currentTrack.path];
    setFavorites(newFavs);
    await dbProcess.current.set("user_favorites", newFavs);
    await dbProcess.current.save();
  };

  const parseLRC = (text: string): LyricLine[] => {
    const lines: LyricLine[] = [];
    const timeExp = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
    for (const line of text.split('\n')) {
      const m = timeExp.exec(line);
      if (m) {
        const txt = line.replace(/\[.*?\]/g, '').trim();
        if (txt) lines.push({ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: txt });
      }
    }
    return lines.sort((a, b) => a.time - b.time);
  };

  const handleBrowseFolder = async () => {
    try {
      const selectedFolder = await open({ directory: true, multiple: false });
      if (!selectedFolder || typeof selectedFolder !== 'string') return;
      setIsLoading(true);
      const entries = await readDir(selectedFolder);
      const rawFiles = entries.filter(e => isAudio(e.name));
      const existing = new Set(playlistRef.current.map(t => t.path));
      const newTracks: Track[] = [];

      for (const entry of rawFiles) {
        const fullPath = `${selectedFolder}\\${entry.name}`;
        if (existing.has(fullPath)) continue;

        let cleanName = stripExt(entry.name || "Unknown");
        cleanName = cleanName.replace(/9convert\.com\s*-\s*/i, '').replace(/\[PagalWorld\.com\]/i, '').trim();
        let t: Track = { name: cleanName, path: fullPath, artist: "Unknown Artist", album: "Single", year: "-", quality: "Standard", duration: 0 };

        try {
          const fileData = await readFile(fullPath);
          const meta = await mm.parseBuffer(fileData, { mimeType: getMime(fullPath), skipCovers: true });
          if (meta.common.title)    t.name     = meta.common.title;
          if (meta.common.artist)   t.artist   = meta.common.artist;
          if (meta.common.album)    t.album    = meta.common.album;
          if (meta.common.year)     t.year     = meta.common.year.toString();
          if (meta.format.bitrate)  t.quality  = `${Math.round(meta.format.bitrate / 1000)} kbps`;
          if (meta.format.duration) t.duration = meta.format.duration;
        } catch (_) {}

        try {
          const lrcPath = fullPath.substring(0, fullPath.lastIndexOf('.')) + '.lrc';
          const lrcText = await readTextFile(lrcPath);
          if (lrcText) t.lyrics = parseLRC(lrcText);
        } catch (_) {}

        newTracks.push(t);
      }

      const merged = [...playlistRef.current, ...newTracks].sort((a, b) => a.name.localeCompare(b.name));
      setPlaylist(merged);
      if (dbProcess.current) {
        await dbProcess.current.set("user_playlist", merged);
        await dbProcess.current.save();
      }
      setIsLoading(false);
    } catch (_) { setIsLoading(false); }
  };

  const handleClearLibrary = async () => {
    if (!confirm("Clear all tracks? Your files won't be deleted.")) return;
    setPlaylist([]); setFavorites([]);
    if (dbProcess.current) {
      await dbProcess.current.set("user_playlist", []);
      await dbProcess.current.set("user_favorites", []);
      await dbProcess.current.save();
    }
  };

  const playTrack = async (track: Track) => {
    if (!engineProcess.current) return;
    const id = ++loadIdRef.current;
    setCurrentTrack(track); setIsPlaying(false); setIsLoading(true); setCurrentTime(0);
    setTrackTitle(track.name); setTrackArtist(track.artist);
    setDetectedProfile(null); detectedProfileRef.current = null;
    setLyrics(track.lyrics?.length ? track.lyrics : []);
    setAlbumArt(prev => { if (prev) URL.revokeObjectURL(prev); return null; });

    try {
      const fileData = await readFile(track.path);
      if (id !== loadIdRef.current) return;

      const meta = await mm.parseBuffer(fileData, { mimeType: getMime(track.path) });
      if (id !== loadIdRef.current) return;

      setTrackTitle(meta.common.title || track.name);
      setTrackArtist(meta.common.artist || track.artist);

      try {
        const lrcText = await readTextFile(track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc');
        if (id === loadIdRef.current && lrcText) setLyrics(parseLRC(lrcText));
      } catch (_) {}

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
          // THE TEXT CONTRAST FIX: Evaluate hex darkness to ensure text is always readable
          if (id === loadIdRef.current) {
            setBlobColors(palette);
            if (facColor && !facColor.error) {
              setThemeColor(facColor.hex);
              setThemeText(facColor.isDark ? '#ffffff' : '#111111');
            } else {
              const fallback = palette[1] || '#c8222a';
              setThemeColor(fallback);
              setThemeText(isHexDark(fallback) ? '#ffffff' : '#111111');
            }
          }
        } catch (_) {}
      } else {
        if (id === loadIdRef.current) {
          setThemeColor('#c8222a');
          setThemeText('#ffffff');
          setBlobColors(['#c8222a', '#8a1520', '#6a1018']);
        }
      }

      if (id !== loadIdRef.current) return;

      await writeToEngine(`VOLUME ${volume}\n`);
      await writeToEngine(`REMASTER 0\nCOMPRESS 0\nUPSCALE 0\nWIDEN 1.0\n3D 0\nREVERB 0\n`);
      await writeToEngine(`LOAD ${track.path}\n`);
      if (id !== loadIdRef.current) return;

      setIsAnalyzing(true);
      try {
        const fpPromise = new Promise<string>(resolve => { fpResolverRef.current = resolve; });
        await writeToEngine('ANALYZE\n');
        const fpLine = await Promise.race([
          fpPromise,
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
        ]);
        if (id === loadIdRef.current) {
          const parts = fpLine.split(' ');
          const profile = classifyAudio(
            parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 10,
            parseFloat(parts[3]) || 0.1, parseFloat(parts[4]) || 0.1
          );
          setDetectedProfile(profile);
          detectedProfileRef.current = profile;
          await applySmartSettings(profile, smartTasteRef.current);

          if (profile.id !== track.profile) {
            const updated = { ...track, profile: profile.id };
            const newList = playlistRef.current.map(t => t.path === track.path ? updated : t);
            setPlaylist(newList);
            if (dbProcess.current) {
              await dbProcess.current.set("user_playlist", newList);
              await dbProcess.current.save();
            }
          }
        }
      } catch (_) {
        fpResolverRef.current = null;
      } finally { setIsAnalyzing(false); }

      if (id === loadIdRef.current) {
        await writeToEngine('PLAY\n');
        setIsPlaying(true); setIsLoading(false);
      }
    } catch (_) {
      if (id === loadIdRef.current) {
        await writeToEngine(`LOAD ${track.path}\nPLAY\n`);
        setIsPlaying(true); setIsLoading(false);
      }
    }
  };

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!engineProcess.current || !currentTrack || isLoading) return;
    if (isPlaying) await writeToEngine("PAUSE\n");
    else await writeToEngine("PLAY\n");
    setIsPlaying(!isPlaying);
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const isCurrentFavorite = currentTrack ? favorites.includes(currentTrack.path) : false;
  const bollywoodCount = playlist.filter(t => t.profile === 'BOLLYWOOD').length;

  const applyPreset = async (preset: 'STUDIO' | 'CINEMATIC' | 'RELAX') => {
    let pRem = false, pCmp = false, pDrv = 0.0, pWid = 1.0, p3D = 0.0, pRvb = 0.0;
    if      (preset === 'STUDIO')   { pCmp = true;  pDrv = 0.7; pWid = 1.10; p3D = 0.0;  pRvb = 0.0;  }
    else if (preset === 'CINEMATIC'){ pRem = true;  pCmp = true; pDrv = 1.2; pWid = 1.35; p3D = 0.25; pRvb = 0.16; }
    else                            { pDrv = 0.0; pWid = 1.0; p3D = 0.40; pRvb = 0.22; }
    setIsRemastered(pRem); setIsCompressed(pCmp);
    setUpscaleDrive(pDrv); setWidenWidth(pWid); setSpatialExtra(p3D); setReverbWet(pRvb);
    await writeToEngine(
      `REMASTER ${pRem?1:0}\nCOMPRESS ${pCmp?1:0}\n` +
      `UPSCALE ${pDrv}\nWIDEN ${pWid}\n3D ${p3D}\nREVERB ${pRvb}\n`
    );
  };

  const renderSmartPills = () => {
    const TASTES: { id: Taste; icon: string; label: string }[] = [
      { id: 'QUALITY',   icon: '✨', label: 'HD Clear'  },
      { id: 'IMMERSIVE', icon: '🌌', label: 'Immersive' },
      { id: 'CHILL',     icon: '🌙', label: 'Chill'     },
    ];
    return (
      <div className="player-smart-section">
        <div className="player-profile-line">
          {isAnalyzing ? (
            <span className="profile-analyzing"><span className="dot-pulse" /> Analyzing...</span>
          ) : detectedProfile ? (
            <span className="profile-chip">{detectedProfile.icon} {detectedProfile.label}</span>
          ) : (
            <span className="profile-chip muted">🎵 Auto Mode</span>
          )}
        </div>
        <div className="player-taste-pills">
          {TASTES.map(t => (
            <button
              key={t.id}
              className={`taste-pill ${smartTaste === t.id ? 'active' : ''}`}
              onClick={() => handleTasteChange(t.id)}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderManualDSP = () => (
    <div className="studio-dashboard fade-in">
      <div className="studio-header">
        <h2>Fine Tune DSP</h2>
        <p className="studio-subtitle">Manual override — resets on next track load</p>
      </div>
      <div className="manual-presets">
        <button className="preset-btn studio"  onClick={() => applyPreset('STUDIO')}>🎧 Studio</button>
        <button className="preset-btn cinema"  onClick={() => applyPreset('CINEMATIC')}>🍿 Cinematic</button>
        <button className="preset-btn relax"   onClick={() => applyPreset('RELAX')}>🌙 Relax</button>
      </div>
      <div className="dsp-grid">
        <div className="dsp-card toggle-card">
          <div className="dsp-toggle-group">
            <label>Old Song EQ</label>
            <button className={`dsp-btn ${isRemastered ? 'active' : ''}`}
              onClick={() => { const v = !isRemastered; setIsRemastered(v); writeToEngine(`REMASTER ${v?1:0}\n`); }}>
              {isRemastered ? 'ON' : 'BYPASS'}
            </button>
          </div>
          <div className="dsp-toggle-group">
            <label>Compressor</label>
            <button className={`dsp-btn ${isCompressed ? 'active' : ''}`}
              onClick={() => { const v = !isCompressed; setIsCompressed(v); writeToEngine(`COMPRESS ${v?1:0}\n`); }}>
              {isCompressed ? 'ON' : 'BYPASS'}
            </button>
          </div>
        </div>
        <div className="dsp-card">
          <div className="dsp-label-row">
            <label>Harmonic Exciter</label>
            <span className="val-green">{upscaleDrive.toFixed(1)}×</span>
          </div>
          <input type="range" className="dsp-slider exciter" min="0" max="2" step="0.1" value={upscaleDrive}
            onChange={e => { const v = parseFloat(e.target.value); setUpscaleDrive(v); writeToEngine(`UPSCALE ${v}\n`); }} />
        </div>
        <div className="dsp-card">
          <div className="dsp-label-row">
            <label>Stereo Width</label>
            <span className="val-blue">{Math.round((widenWidth-1)*100)}% extra</span>
          </div>
          <input type="range" className="dsp-slider widener" min="1" max="1.5" step="0.05" value={widenWidth}
            onChange={e => { const v = parseFloat(e.target.value); setWidenWidth(v); writeToEngine(`WIDEN ${v}\n`); }} />
        </div>
        <div className="dsp-card">
          <div className="dsp-label-row">
            <label>3D Depth (+ base)</label>
            <span className="val-purple">{spatialExtra > 0 ? `+${Math.round(spatialExtra*100)}%` : 'Base'}</span>
          </div>
          <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra}
            onChange={e => { const v = parseFloat(e.target.value); setSpatialExtra(v); writeToEngine(`3D ${v}\n`); }} />
        </div>
        <div className="dsp-card">
          <div className="dsp-label-row">
            <label>Reverb</label>
            <span className="val-orange">{Math.round(reverbWet*100)}%</span>
          </div>
          <input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet}
            onChange={e => { const v = parseFloat(e.target.value); setReverbWet(v); writeToEngine(`REVERB ${v}\n`); }} />
        </div>
      </div>
    </div>
  );

  const renderExpandedControls = () => {
    const isLong = trackTitle.length > 25;
    return (
      <div className="ep-controls-section">
        <div className="ep-track-header">
          <div className={`marquee-container ${isLong ? 'scrolling' : ''}`}>
            <div className={`ep-title-wrapper ${isLong ? 'marquee' : ''}`}>
              <h1 className="ep-title">{trackTitle}</h1>
              {isLong && <h1 className="ep-title">{trackTitle}</h1>}
            </div>
          </div>
          <h2 className="ep-artist">{trackArtist}</h2>
        </div>

        {renderSmartPills()}

        <div className="ep-volume-row">
          <button className="vol-btn" onClick={() => adjustVolume(-0.1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
          </button>
          <input type="range" className="ep-volume-slider" min="0" max="1" step="0.02" value={volume}
            onChange={e => { const v = parseFloat(e.target.value); setVolume(v); writeToEngine(`VOLUME ${v}\n`); }} />
          <button className="vol-btn" onClick={() => adjustVolume(0.1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
          <span className="vol-pct">{Math.round(volume * 100)}%</span>
        </div>

        <div className="ep-actions">
          {/* THE COLOR FIX: All UI controls now properly map to var(--theme-color) dynamically */}
          <button className="ep-icon-btn fav-btn" onClick={toggleFavorite}
            style={{ color: isCurrentFavorite ? 'var(--theme-color)' : undefined }}>
            {isCurrentFavorite ? '♥' : '♡'}
          </button>
          <button className="ep-icon-btn"
            onClick={e => { e.stopPropagation(); setShowLyrics(!showLyrics); setShowStudio(false); }}
            style={{ color: showLyrics ? 'var(--theme-color)' : undefined }}
            title="Lyrics">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button className={`ep-icon-btn ${showStudio ? 'active-glow' : ''}`}
            onClick={e => { e.stopPropagation(); setShowStudio(!showStudio); setShowLyrics(false); }}
            style={{ color: showStudio ? 'var(--theme-color)' : undefined }}
            title="Fine Tune DSP">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/>
              <path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>
            </svg>
          </button>
        </div>

        <div className="ep-progress-container">
          <input type="range" className="ep-progress-bar" min="0" max={duration || 1} value={currentTime} onChange={handleSeek} />
          <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>

        <div className="ep-main-controls">
          <button className="ep-ctrl-btn">🔀</button>
          <button className="ep-ctrl-btn" onClick={e => { e.stopPropagation(); handlePrev(); }}>⏮</button>
          <button className="ep-play-btn" onClick={handlePlayPause}>{isPlaying ? "⏸" : "▶"}</button>
          <button className="ep-ctrl-btn" onClick={e => { e.stopPropagation(); handleNext(); }}>⏭</button>
          <button className="ep-ctrl-btn">🔁</button>
        </div>
      </div>
    );
  };

  const isRightPaneActive = showLyrics || showStudio;

  return (
    <div
      className="app-layout"
      data-theme={isDarkMode ? 'dark' : 'light'}
      style={{
        '--theme-color': themeColor,
        '--theme-text': themeText, // Re-connected! Used heavily in CSS now.
        '--blob-1': blobColors[0],
        '--blob-2': blobColors[1],
        '--blob-3': blobColors[2],
        '--audio-level': audioLevel,
      } as React.CSSProperties}
    >
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-d">D</span><span className="logo-rest">meX</span>
        </div>

        <div className="search-box">
          <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" type="text" placeholder="Search tracks…"
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>}
        </div>

        <nav>
          <button className={currentView === 'ALL' ? 'active' : ''} onClick={() => setCurrentView('ALL')}>
            🎵 All Tracks <span className="nav-count">{playlist.length}</span>
          </button>
          <button className={currentView === 'FAVORITES' ? 'active' : ''} onClick={() => setCurrentView('FAVORITES')}>
            ❤️ Favorites <span className="nav-count">{favorites.length}</span>
          </button>
          <button className={currentView === 'BOLLYWOOD' ? 'active' : ''} onClick={() => setCurrentView('BOLLYWOOD')}>
            🎙️ Bollywood <span className="nav-count">{bollywoodCount}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="add-folder-btn" onClick={handleBrowseFolder} disabled={isLoading}>
            {isLoading ? '⏳ Scanning…' : '+ Add Folder'}
          </button>
          <button className="theme-toggle-btn" onClick={toggleTheme} title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            {isDarkMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button className="clear-btn" onClick={handleClearLibrary} title="Clear library">🗑</button>
        </div>
      </aside>

      <div className="app-container">
        <header className="app-header">
          <h1>
            {currentView === 'ALL' ? 'Library'
              : currentView === 'FAVORITES' ? 'Favorites'
              : '🎙️ Bollywood Classics'}
          </h1>
          {currentView === 'BOLLYWOOD' && bollywoodCount === 0 && (
            <p className="bollywood-hint">Play your tracks — Bollywood ones auto-appear here</p>
          )}
        </header>

        <main className="content-area">
          {displayedTracks.length === 0 ? (
            <p className="placeholder-text">
              {searchQuery ? 'No tracks match your search.'
                : currentView === 'FAVORITES' ? "No favorites yet — tap ♡ while playing."
                : currentView === 'BOLLYWOOD' ? "Play your songs once — Bollywood tracks auto-appear here."
                : "Click '+ Add Folder' to scan your music."}
            </p>
          ) : (
            <>
              <div className="track-list-header">
                <span>Title</span>
                <span className="hide-mobile">Album</span>
                <span className="hide-mobile">Year</span>
                <span className="hide-mobile">Quality</span>
                <span>⏱</span>
              </div>
              <ul className="track-list">
                {displayedTracks.map((track, index) => {
                  const isFav = favorites.includes(track.path);
                  const isActive = currentTrack?.path === track.path;
                  return (
                    <li key={index}
                      className={`track-item ${isActive ? 'active' : ''}`}
                      onClick={() => playTrack(track)}>
                      <div className="track-cell title-cell">
                        <div className="track-item-icon">
                          {isActive ? (isPlaying ? '▶' : '⏸') : '🎵'}
                        </div>
                        <div className="track-item-details">
                          <span className="track-item-name">
                            {isFav && <span className="fav-dot">♥ </span>}
                            {track.name}
                          </span>
                          <span className="track-item-artist">
                            {track.artist}
                            {track.profile && (
                              <span className="track-profile-icon">
                                {PROFILES.find(p => p.id === track.profile)?.icon}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="track-cell hide-mobile">{track.album}</div>
                      <div className="track-cell hide-mobile">{track.year}</div>
                      <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
                      <div className="track-cell time-cell">{track.duration ? formatTime(track.duration) : '--:--'}</div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </main>

        <footer className={`bottom-player ${isExpanded ? 'expanded' : ''}`}>
          {!isExpanded && (
            <div className="mini-player-content fade-in">
              <div className="progress-container mini">
                <input type="range" className="progress-bar" min="0" max={duration || 1} value={currentTime}
                  onChange={handleSeek} onClick={e => e.stopPropagation()} />
              </div>
              <div className="player-interface">
                <div className="track-info" onClick={() => setIsExpanded(true)} style={{ cursor: 'pointer' }}>
                  <div className="art-circle" style={{
                    backgroundImage: albumArt ? `url(${albumArt})` : 'none',
                    backgroundColor: 'rgba(255,255,255,0.15)'
                  }}>{!albumArt && <span>🎵</span>}</div>
                  <div>
                    <div className="track-title">{trackTitle}</div>
                    <div className="artist-subtitle">
                      {trackArtist}
                      {detectedProfile && <span className="mini-profile">{detectedProfile.icon}</span>}
                    </div>
                  </div>
                </div>
                <div className="controls">
                  <button className="control-btn" onClick={e => { e.stopPropagation(); handlePrev(); }}>⏮</button>
                  <button className="play-main" onClick={handlePlayPause}>{isPlaying ? "⏸" : "▶"}</button>
                  <button className="control-btn" onClick={e => { e.stopPropagation(); handleNext(); }}>⏭</button>
                </div>
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="expanded-player-content fade-in">
              <div className="ambient-background">
                <div className="blob blob-1" style={{ transform: `scale(${1 + audioLevel * 2.0})`, transition: 'transform 0.12s ease-out' }} />
                <div className="blob blob-2" style={{ transform: `scale(${1 + audioLevel * 1.3})`, transition: 'transform 0.18s ease-out' }} />
                <div className="blob blob-3" style={{ transform: `scale(${1 + audioLevel * 0.9})`, transition: 'transform 0.22s ease-out' }} />
              </div>

              <div className="ep-header" style={{ position: 'relative', zIndex: 10 }}>
                <button className="ep-icon-btn" onClick={e => { e.stopPropagation(); setIsExpanded(false); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {detectedProfile && (
                  <div className="ep-profile-badge">
                    {detectedProfile.icon} {detectedProfile.label}
                  </div>
                )}
                <button className="ep-icon-btn">⋮</button>
              </div>

              <div className={`ep-content ${isRightPaneActive ? 'lyrics-mode' : ''}`} style={{ position: 'relative', zIndex: 10 }}>
                <div className="ep-left">
                  <div className="ep-art" style={{
                    backgroundImage: albumArt ? `url(${albumArt})` : 'none',
                    backgroundColor: 'rgba(128,128,128,0.08)'
                  }}>{!albumArt && <span>🎵</span>}</div>
                  {isRightPaneActive && renderExpandedControls()}
                </div>

                <div className="ep-right">
                  {!isRightPaneActive && renderExpandedControls()}

                  {showLyrics && (
                    <div className="lyrics-display full" ref={lyricsContainerRef}>
                      {lyrics.length > 0
                        ? lyrics.map((line, i) => (
                            <p key={i} className={`lyric-line ${i === activeLyricIndex ? 'active' : ''}`}>{line.text}</p>
                          ))
                        : <p className="lyric-line active" style={{ opacity: 0.4 }}>No synchronized lyrics for this track.</p>
                      }
                    </div>
                  )}

                  {showStudio && renderManualDSP()}
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