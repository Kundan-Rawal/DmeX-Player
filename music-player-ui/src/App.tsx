import { useEffect, useRef, useState } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import * as mm from "music-metadata";
import { FastAverageColor } from "fast-average-color";
import "./App.css";

interface Track { name: string; path: string; artist: string; album: string; year: string; quality: string; duration: number; lyrics?: LyricLine[]; }
interface LyricLine { time: number; text: string; }

const fac = new FastAverageColor();

// CRITICAL FIX: Removed crossOrigin to prevent Tauri Security crashes
const getCenterPixelColor = (imgUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject("Canvas context failed");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
      const hex = "#" + [data[0], data[1], data[2]].map(x => x.toString(16).padStart(2, '0')).join('');
      resolve(hex);
    };
    img.onerror = reject;
    img.src = imgUrl;
  });
};

// CRITICAL FIX: Restored the missing getPalette function!
const getPalette = (imgUrl: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(['#ffb3c6', '#ff80a0', '#ff4d79']);
      ctx.drawImage(img, 0, 0);
      
      const getHex = (x: number, y: number) => {
        const data = ctx.getImageData(x, y, 1, 1).data;
        return "#" + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      };
      
      const c1 = getHex(Math.floor(img.width * 0.2), Math.floor(img.height * 0.2));
      const c2 = getHex(Math.floor(img.width * 0.5), Math.floor(img.height * 0.5));
      const c3 = getHex(Math.floor(img.width * 0.8), Math.floor(img.height * 0.8));
      
      resolve([c1, c2, c3]);
    };
    img.onerror = () => resolve(['#ffb3c6', '#ff80a0', '#ff4d79']);
    img.src = imgUrl;
  });
};

const isHexDark = (hex: string): boolean => {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq < 128; 
};

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false); 
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<'ALL' | 'FAVORITES'>('ALL');
  
  const [albumArt, setAlbumArt] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState<string>("Ready");
  const [trackArtist, setTrackArtist] = useState<string>("Local Audio");
  
  const [themeColor, setThemeColor] = useState<string>('#ff4d79');
  const [themeText, setThemeText] = useState<string>('#ffffff');
  const [blobColors, setBlobColors] = useState<string[]>(['#ffb3c6', '#ff80a0', '#ff4d79']);
  
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [isRemastered, setIsRemastered] = useState(false);

  const engineProcess = useRef<any>(null);
  const dbProcess = useRef<any>(null); 
  const loadIdRef = useRef<number>(0); 
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const displayedTracks = currentView === 'FAVORITES' ? playlist.filter(t => favorites.includes(t.path)) : playlist;
  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = async (cmd: string) => {
    if (!engineProcess.current) return;
    try {
      await engineProcess.current.write(cmd);
    } catch (e) {}
  };

  useEffect(() => {
    let isMounted = true;

    async function bootDatabase() {
      const store = await load("library.json", { autoSave: true });
      dbProcess.current = store;
      const savedLibrary = await store.get<Track[]>("user_playlist");
      if (savedLibrary && savedLibrary.length > 0) setPlaylist(savedLibrary);
      const savedFavs = await store.get<string[]>("user_favorites");
      if (savedFavs) setFavorites(savedFavs);
    }

    async function startEngine() {
      try {
        const command = Command.sidecar("bin/AudioEngine");
        command.on('close', () => {
          if (!isMounted) return;
          engineProcess.current = null;
          setIsPlaying(false);
          setIsLoading(false);
          startEngine(); 
        });

        const child = await command.spawn();
        engineProcess.current = child;

        command.stdout.on('data', line => {
          if (line.startsWith("TIME")) {
            const parts = line.split(" ");
            setCurrentTime(parseFloat(parts[1]) || 0);
            setDuration(parseFloat(parts[2]) || 0);
          }
        });
      } catch (err) {}
    }

    bootDatabase();
    startEngine();

    return () => { 
      isMounted = false;
      if (engineProcess.current) writeToEngine("QUIT\n"); 
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (engineProcess.current && isPlaying && !isLoading) {
        await writeToEngine("GET_TIME\n");
      }
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, isLoading]);

  useEffect(() => {
    if (duration > 0 && currentTime >= duration - 0.5 && !isLoading) handleNext();
  }, [currentTime, duration, isLoading]);

  const activeLyricIndex = lyrics.findIndex((lyric, index) => {
    const nextLyric = lyrics[index + 1];
    return currentTime >= lyric.time && (!nextLyric || currentTime < nextLyric.time);
  });

  useEffect(() => {
    if (lyricsContainerRef.current && activeLyricIndex !== -1 && showLyrics) {
      const activeElement = lyricsContainerRef.current.children[activeLyricIndex] as HTMLElement;
      if (activeElement) activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLyricIndex, showLyrics]);

  const handleNext = () => {
    const { displayedTracks: currentList, currentTrack: track } = stateRefs.current;
    if (currentList.length === 0 || !track) return;
    const currentIndex = currentList.findIndex(t => t.path === track.path);
    const nextIndex = (currentIndex + 1) >= currentList.length ? 0 : currentIndex + 1;
    playTrack(currentList[nextIndex]);
  };

  const handlePrev = () => {
    const { displayedTracks: currentList, currentTrack: track } = stateRefs.current;
    if (currentList.length === 0 || !track) return;
    const currentIndex = currentList.findIndex(t => t.path === track.path);
    const prevIndex = (currentIndex - 1) < 0 ? currentList.length - 1 : currentIndex - 1;
    playTrack(currentList[prevIndex]);
  };

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (!isLoading) await writeToEngine(`SEEK ${newTime}\n`);
  };

  const toggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || !dbProcess.current) return;
    const newFavs = favorites.includes(currentTrack.path)
      ? favorites.filter(path => path !== currentTrack.path)
      : [...favorites, currentTrack.path];
    setFavorites(newFavs);
    await dbProcess.current.set("user_favorites", newFavs);
    await dbProcess.current.save();
  };

  const handleBrowseFolder = async () => {
    try {
      const selectedFolder = await open({ directory: true, multiple: false });
      if (selectedFolder && typeof selectedFolder === 'string') {
        setIsLoading(true); 
        const entries = await readDir(selectedFolder);
        const rawFiles = entries.filter(e => e.name?.endsWith('.mp3') || e.name?.endsWith('.wav'));
        const parsedTracks: Track[] = [];

        for (const entry of rawFiles) {
          const fullPath = `${selectedFolder}\\${entry.name}`;
          let cleanName = entry.name?.replace('.mp3', '').replace('.wav', '') || "Unknown";
          cleanName = cleanName.replace(/9convert\.com\s*-\s*/i, '').replace(/\[PagalWorld\.com\]/i, '').trim();
          
          let trackData: Track = {
            name: cleanName, path: fullPath, artist: "Unknown Artist", album: "Single", year: "-", quality: "Standard", duration: 0
          };

          try {
            const fileData = await readFile(fullPath);
            const mime = fullPath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
            const metadata = await mm.parseBuffer(fileData, { mimeType: mime, skipCovers: true });
            
            if (metadata.common.title) trackData.name = metadata.common.title;
            if (metadata.common.artist) trackData.artist = metadata.common.artist;
            if (metadata.common.album) trackData.album = metadata.common.album;
            if (metadata.common.year) trackData.year = metadata.common.year.toString();
            if (metadata.format.bitrate) trackData.quality = `${Math.round(metadata.format.bitrate / 1000)} kbps`;
            if (metadata.format.duration) trackData.duration = metadata.format.duration;
          } catch (e) {}

          // CACHING LYRICS DURING SCAN
          try {
            const lrcPath = fullPath.substring(0, fullPath.lastIndexOf('.')) + '.lrc';
            const lrcText = await readTextFile(lrcPath);
            if (lrcText) {
              const parsed: LyricLine[] = [];
              const lines = lrcText.split('\n');
              const timeExp = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
              for (const line of lines) {
                const match = timeExp.exec(line);
                if (match) {
                  const m = parseInt(match[1], 10);
                  const s = parseFloat(match[2]);
                  const text = line.replace(/\[.*?\]/g, '').trim();
                  if (text) parsed.push({ time: m * 60 + s, text });
                }
              }
              parsed.sort((a, b) => a.time - b.time);
              trackData.lyrics = parsed; 
            }
          } catch (e) {}

          parsedTracks.push(trackData);
        }
        parsedTracks.sort((a, b) => a.name.localeCompare(b.name));
        setPlaylist(parsedTracks);
        if (dbProcess.current) {
            await dbProcess.current.set("user_playlist", parsedTracks);
            await dbProcess.current.save(); 
        }
        setIsLoading(false);
      }
    } catch (error) { setIsLoading(false); }
  };

  const playTrack = async (track: Track) => {
    if (!engineProcess.current) return;
    const currentLoadId = ++loadIdRef.current;
    
    setCurrentTrack(track);
    setIsPlaying(false); setIsLoading(true); setCurrentTime(0);
    setTrackTitle(track.name || "Unknown Track");
    setTrackArtist(track.artist || "Unknown Artist");
    
    // THE FIX: We have completely removed the `setThemeColor('#ff4d79')` and `setBlobColors` resets from here.
    // The previous song's colors will remain beautifully on-screen while the new file is read from the hard drive.
    
    if (track.lyrics && track.lyrics.length > 0) {
      setLyrics(track.lyrics);
    } else {
      setLyrics([]);
    }
    
    setAlbumArt((prevArt) => { if (prevArt) URL.revokeObjectURL(prevArt); return null; });

    try {
      const fileData = await readFile(track.path);
      if (currentLoadId !== loadIdRef.current) return;

      const mime = track.path.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
      const metadata = await mm.parseBuffer(fileData, { mimeType: mime });
      if (currentLoadId !== loadIdRef.current) return;
      
      setTrackTitle(metadata.common.title || track.name || "Unknown Track");
      setTrackArtist(metadata.common.artist || track.artist || "Unknown Artist");

      // LIVE LYRICS FALLBACK (If not scanned previously)
      try {
        const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
        const lrcText = await readTextFile(lrcPath);

        if (currentLoadId === loadIdRef.current && lrcText) {
          const parsed: LyricLine[] = [];
          const lines = lrcText.split('\n');
          const timeExp = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
          
          for (const line of lines) {
            const match = timeExp.exec(line);
            if (match) {
              const m = parseInt(match[1], 10);
              const s = parseFloat(match[2]);
              const text = line.replace(/\[.*?\]/g, '').trim();
              if (text) parsed.push({ time: m * 60 + s, text });
            }
          }
          parsed.sort((a, b) => a.time - b.time);
          setLyrics(parsed);
        }
      } catch (lrcError) {}

      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const picture = metadata.common.picture[0];
        const blob = new Blob([picture.data], { type: picture.format });
        const imgUrl = URL.createObjectURL(blob);
        if (currentLoadId !== loadIdRef.current) { URL.revokeObjectURL(imgUrl); return; }
        setAlbumArt(imgUrl);
        
        try {
          const [facColor, palette] = await Promise.all([
            fac.getColorAsync(imgUrl, { algorithm: 'dominant' }).catch(() => null),
            getPalette(imgUrl)
          ]);
          
          if (currentLoadId === loadIdRef.current) {
             setBlobColors(palette);
             if (facColor) {
                setThemeColor(facColor.hex);
                setThemeText(facColor.isDark ? '#ffffff' : '#222222');
             } else {
                setThemeColor(palette[1]);
                setThemeText('#ffffff');
             }
          }
        } catch (e) {
            console.error("Color Extraction Failed", e);
        }
      } else {
        // THE FALLBACK: If the song genuinely has NO album art, THEN we fade back to the default pink.
        // This prevents a blank song from permanently stealing the previous song's colors.
        if (currentLoadId === loadIdRef.current) {
            setThemeColor('#ff4d79');
            setThemeText('#ffffff');
            setBlobColors(['#ffb3c6', '#ff80a0', '#ff4d79']);
        }
      }

      if (currentLoadId === loadIdRef.current) {
          await writeToEngine(`LOAD ${track.path}\nPLAY\n`);
          setIsPlaying(true); setIsLoading(false); 
      }
    } catch (error) {
      if (currentLoadId === loadIdRef.current) {
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

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isCurrentFavorite = currentTrack ? favorites.includes(currentTrack.path) : false;

  const toggleRemaster = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newState = !isRemastered;
    setIsRemastered(newState);
    if (!isLoading) {
      await writeToEngine(`ENHANCE ${newState ? 1 : 0}\n`);
    }
  };

  const renderExpandedControls = () => {
    const isLongTitle = trackTitle.length > 25;
    return (
      <div className="ep-controls-section">
        <div className="ep-track-header">
          <div className={`marquee-container ${isLongTitle ? 'scrolling' : ''}`}>
             <div className={`ep-title-wrapper ${isLongTitle ? 'marquee' : ''}`}>
               <h1 className="ep-title">{trackTitle}</h1>
               {isLongTitle && <h1 className="ep-title">{trackTitle}</h1>}
             </div>
          </div>
          <h2 className="ep-artist">{trackArtist}</h2>
        </div>

        <div className="ep-actions">
           <button className="ep-icon-btn" onClick={toggleFavorite} style={{ color: isCurrentFavorite ? '#ff4d79' : 'var(--theme-text)' }}>
             {isCurrentFavorite ? '♥' : '♡'}
           </button>
           <button className="ep-icon-btn" onClick={(e) => { e.stopPropagation(); setShowLyrics(!showLyrics); }} style={{ color: showLyrics ? '#ff4d79' : 'var(--theme-text)', opacity: showLyrics ? 1 : 0.6 }}>
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><path d="M21 8a2 2 0 0 1-2 2H7l-4 4V3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
           </button>

           <button 
             className={`ep-icon-btn ${isRemastered ? 'active-glow' : ''}`} 
             onClick={toggleRemaster} 
             style={{ color: isRemastered ? '#00e676' : 'var(--theme-text)', opacity: isRemastered ? 1 : 0.6 }}
             title="AI Remaster (Fix Hollow, Boost Bass, Denoise Hiss)"
           >
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <circle cx="12" cy="12" r="4"></circle>
             </svg>
           </button>
        </div>

        <div className="ep-progress-container">
          <input type="range" className="ep-progress-bar" min="0" max={duration || 1} value={currentTime} onChange={handleSeek} />
          <div className="ep-time-labels">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="ep-main-controls">
          <button className="ep-ctrl-btn">🔀</button>
          <button className="ep-ctrl-btn" onClick={(e) => { e.stopPropagation(); handlePrev(); }}>⏮</button>
          <button className="ep-play-btn" onClick={handlePlayPause}>{isPlaying ? "⏸" : "▶"}</button>
          <button className="ep-ctrl-btn" onClick={(e) => { e.stopPropagation(); handleNext(); }}>⏭</button>
          <button className="ep-ctrl-btn">🔁</button>
        </div>
      </div>
    );
  };

  return (
    <div className="app-layout" style={{ 
        '--theme-color': themeColor, 
        '--theme-text': themeText,
        '--blob-1': blobColors[0],
        '--blob-2': blobColors[1],
        '--blob-3': blobColors[2]
      } as React.CSSProperties}>
      
      <aside className="sidebar">
        <h2>DmeX</h2>
        <nav>
          <button className={currentView === 'ALL' ? 'active' : ''} onClick={() => setCurrentView('ALL')}>🎵 All Tracks</button>
          <button className={currentView === 'FAVORITES' ? 'active' : ''} onClick={() => setCurrentView('FAVORITES')}>❤️ Favorites</button>
        </nav>
      </aside>

      <div className="app-container">
        <header className="app-header">
          <h1>{currentView === 'ALL' ? 'Library' : 'My Favorites'}</h1>
          <button className="load-btn" onClick={handleBrowseFolder} disabled={isLoading}>{isLoading ? "Scanning..." : "📁 Resync Folder"}</button>
        </header>

        <main className="content-area">
          {displayedTracks.length === 0 ? (
            <p className="placeholder-text">{currentView === 'ALL' ? "Click 'Resync Folder' to scan your music directory." : "You haven't added any favorites yet."}</p>
          ) : (
            <>
              <div className="track-list-header">
                 <span>Title</span><span className="hide-mobile">Album</span><span className="hide-mobile">Year</span><span className="hide-mobile">Quality</span><span>⏱</span>
              </div>
              <ul className="track-list">
                {displayedTracks.map((track, index) => {
                  const isFav = favorites.includes(track.path);
                  return (
                    <li key={index} className={`track-item ${currentTrack?.path === track.path ? 'active' : ''}`} onClick={() => playTrack(track)}>
                      <div className="track-cell title-cell">
                        <div className="track-item-icon">🎵</div>
                        <div className="track-item-details">
                          <span className="track-item-name">{isFav && <span style={{color: 'var(--theme-color)', marginRight: '5px'}}>♥</span>}{track.name}</span>
                          <span className="track-item-artist">{track.artist}</span>
                        </div>
                      </div>
                      <div className="track-cell hide-mobile">{track.album}</div>
                      <div className="track-cell hide-mobile">{track.year}</div>
                      <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
                      <div className="track-cell time-cell">{track.duration ? formatTime(track.duration) : "--:--"}</div>
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
                <input type="range" className="progress-bar" min="0" max={duration || 1} value={currentTime} onChange={handleSeek} onClick={(e) => e.stopPropagation()} />
              </div>
              <div className="player-interface">
                <div className="track-info" onClick={() => setIsExpanded(true)} style={{ cursor: 'pointer' }}>
                  <div className="art-circle" style={{ backgroundImage: albumArt ? `url(${albumArt})` : 'none', backgroundColor: 'var(--theme-color)' }}>{!albumArt && <span>🎵</span>}</div>
                  <div><div className="track-title">{trackTitle}</div><div className="artist-subtitle">{trackArtist}</div></div>
                </div>
                <div className="controls">
                  <button className="control-btn" onClick={(e) => { e.stopPropagation(); handlePrev(); }}>⏮</button>
                  <button className="play-main" onClick={handlePlayPause}>{isPlaying ? "⏸" : "▶"}</button>
                  <button className="control-btn" onClick={(e) => { e.stopPropagation(); handleNext(); }}>⏭</button>
                </div>
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="expanded-player-content fade-in">
              
              <div className="ambient-background">
                <div className="blob blob-1"></div>
                <div className="blob blob-2"></div>
                <div className="blob blob-3"></div>
              </div>

              <div className="ep-header" style={{ position: 'relative', zIndex: 10 }}>
                <button className="ep-icon-btn" onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div className="ep-header-icons"><button className="ep-icon-btn">⋮</button></div>
              </div>

              <div className={`ep-content ${showLyrics ? 'lyrics-mode' : ''}`} style={{ position: 'relative', zIndex: 10 }}>
                <div className="ep-left">
                  <div className="ep-art" style={{ backgroundImage: albumArt ? `url(${albumArt})` : 'none', backgroundColor: 'rgba(255,255,255,0.1)' }}>{!albumArt && <span>🎵</span>}</div>
                  {showLyrics && renderExpandedControls()}
                </div>

                <div className="ep-right">
                  {!showLyrics && renderExpandedControls()}
                  {showLyrics && (
                    <div className="lyrics-display full" ref={lyricsContainerRef}>
                      {lyrics.length > 0 ? (
                        lyrics.map((line, index) => <p key={index} className={`lyric-line ${index === activeLyricIndex ? 'active' : ''}`}>{line.text}</p>)
                      ) : (
                        <p className="lyric-line active" style={{ opacity: 0.5 }}>No synchronized lyrics found for this track.</p>
                      )}
                    </div>
                  )}
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