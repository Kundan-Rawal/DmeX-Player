import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { load } from "@tauri-apps/plugin-store";
import * as mm from "music-metadata";
import Marquee from "react-fast-marquee";
import { FastAverageColor } from "fast-average-color";
import "./App.css";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { resolveResource } from '@tauri-apps/api/path';

interface Track {
  id?: string; name: string; path: string; artist: string; album: string;
  year?: string; quality?: string; duration: number;
  lyrics?: LyricLine[]; profile?: string;
  metadataLoaded?: boolean; genre?: string;               
  isFavorite?: boolean;         // <--- NEW
  playCount?: number;           // <--- NEW 
  totalSecondsListened?: number; // <--- NEW
  thumb?: string;
}

interface CustomPlaylist {
  id: string;
  name: string;
  trackPaths: string[];
}

interface LyricLine { time: number; text: string; }

type Taste   = 'ORIGINAL' |'QUALITY' | 'IMMERSIVE' | 'CHILL';
type NavView = 'ALL' | 'FAVORITES' | 'BOLLYWOOD' | 'TOPTRACKS' | string;

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

const generateThumbnail = async (pic: mm.IPicture): Promise<string | null> => {
  return new Promise((resolve) => {
    const blob = new Blob([pic.data], { type: pic.format });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else {
        resolve(null);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
};

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
const FIR_GAINS: Record<string, [number, number, number]> = {
  CLASSICAL:   [1.20, 0.82, 1.50],
  BOLLYWOOD:   [1.55, 0.72, 1.20],
  VOCAL:       [1.10, 0.68, 1.45],
  ELECTRONIC:  [1.70, 0.75, 1.55],
  HIPHOP:      [1.65, 0.78, 1.25],
  AMBIENT:     [1.00, 0.90, 1.60],
  POP:         [1.40, 0.80, 1.40],
  DEFAULT:     [1.50, 0.79, 1.33],
};

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

// FIX: Added activePlaylistId and onRemoveFromPlaylist props
const TrackRow = memo(({ track, isActive, albumArt, isFav, onPlay, formatTime, onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, isSelectionMode, isSelected, onToggleSelect, style }: {
  track: Track; isActive: boolean; albumArt: string | null;
  isFav: boolean; onPlay: () => void; formatTime: (s:number)=>string;
  onAddToPlaylist: () => void;
  onRemoveFromPlaylist: () => void;
  activePlaylistId: string | null;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (path: string) => void;
  style?: React.CSSProperties;
}) => {
  const profileData = PROFILES.find(p => p.id === track.profile);
  return (
    <li
      className={`track-item ${isActive ? 'active' : ''} ${isSelected ? 'selected-row' : ''}`}
      style={{ '--track-color': trackAccentColor(track.name), ...style } as React.CSSProperties}
      onClick={() => {
        if (isSelectionMode) onToggleSelect(track.path);
        else onPlay();
      }}
    >
      <div className="track-cell title-cell">
        {isSelectionMode && (
          <input 
            type="checkbox" 
            checked={isSelected} 
            readOnly 
            style={{ marginRight: '10px', transform: 'scale(1.2)', accentColor: 'var(--theme-color)' }} 
          />
        )}
        <div className="track-item-icon">
          {isActive && albumArt
            ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
            : track.thumb 
              ? <div className="track-thumb-art" style={{ backgroundImage:`url(${track.thumb})` }} />
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
      <div className="track-cell time-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
        
        {/* FIX: Show Remove (X) button if inside a playlist, otherwise show Add (+) */}
        {activePlaylistId ? (
          <button 
            className="ep-icon-btn no-touch-effects" 
            style={{ width: '28px', height: '28px', fontSize: '15px', background: 'transparent', border: 'none', opacity: 0.8, color: '#ff4444' }} 
            onClick={(e) => { e.stopPropagation(); onRemoveFromPlaylist(); }}
            title="Remove from Playlist"
          >✕</button>
        ) : (
          <button 
            className="ep-icon-btn no-touch-effects" 
            style={{ width: '28px', height: '28px', fontSize: '14px', background: 'transparent', border: 'none', opacity: 0.6 }} 
            onClick={(e) => { e.stopPropagation(); onAddToPlaylist(); }}
            title="Add to Playlist"
          >+</button>
        )}
        
        {track.duration ? formatTime(track.duration) : '--:--'}
      </div>
    </li>
  );
});

const ITEM_HEIGHT = 72;
const OVERSCAN    = 8;

const VirtualList = memo(({ tracks, currentTrackPath, albumArt, favorites, onPlay, formatTime, onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, isSelectionMode, selectedTracks, onToggleSelect }: {
  tracks: Track[];
  currentTrackPath: string | undefined;
  albumArt: string | null;
  favorites: string[];
  onPlay: (track: Track) => void;
  formatTime: (s: number) => string;
  onAddToPlaylist: (track: Track) => void;
  onRemoveFromPlaylist: (track: Track) => void;
  activePlaylistId: string | null;
  isSelectionMode: boolean;
  selectedTracks: Set<string>;
  onToggleSelect: (path: string) => void;
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
              key={track.path + realIdx} // Use realIdx in key to prevent react re-render bugs on dupes in playlist
              track={track}
              isActive={currentTrackPath === track.path}
              albumArt={albumArt}
              isFav={favorites.includes(track.path)}
              onPlay={() => onPlay(track)}
              formatTime={formatTime}
              onAddToPlaylist={() => onAddToPlaylist(track)}
              onRemoveFromPlaylist={() => onRemoveFromPlaylist(track)}
              activePlaylistId={activePlaylistId}
              isSelectionMode={isSelectionMode}
              isSelected={selectedTracks.has(track.path)}
              onToggleSelect={onToggleSelect}
              style={{ position: 'absolute', top: realIdx * ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT }}
            />
          );
        })}
      </ul>
    </div>
  );
});

// ── Drag-to-reorder playlist view ─────────────────────────────────────────
// Used instead of VirtualList when a custom playlist is active.
// Playlists are small (typically <200 tracks) so absolute-positioned
// virtual scrolling is unnecessary and would break HTML5 drag-and-drop.
// ── Drag-to-reorder playlist view ─────────────────────────────────────────
// ── Drag-to-reorder playlist view ─────────────────────────────────────────
const DraggablePlaylistView = memo(({ 
  tracks, currentTrackPath, albumArt, onPlay, formatTime, onRemove, onReorder,
  isSelectionMode, selectedTracks, onToggleSelect
}: {
  tracks: Track[]; currentTrackPath: string | undefined; albumArt: string | null;
  onPlay: (t: Track) => void; formatTime: (s: number) => string;
  onRemove: (t: Track) => void; onReorder: (from: Track, to: Track) => void;
  isSelectionMode: boolean; selectedTracks: Set<string>; onToggleSelect: (path: string) => void;
}) => {
  const dragState = useRef<{
    active: boolean;
    fromTrack: Track | null;
    startY: number;
    startScrollTop: number;
    ghost: HTMLDivElement | null;
  }>({ active: false, fromTrack: null, startY: 0, startScrollTop: 0, ghost: null });
  
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollInterval = useRef<number | null>(null);

  // Clean up ghost on unmount
  useEffect(() => {
    return () => {
      if (dragState.current.ghost) dragState.current.ghost.remove();
    };
  }, []);

  const startDrag = (e: React.PointerEvent, track: Track) => {
    if (isSelectionMode) return;
    const handle = (e.target as HTMLElement).closest('.drag-handle');
    if (!handle) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = track.name;
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.opacity = '0.85';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    ghost.style.background = 'var(--bg-raised)';
    ghost.style.borderRadius = '8px';
    ghost.style.padding = '12px';
    ghost.style.boxShadow = '0 8px 20px rgba(0,0,0,0.3)';
    document.body.appendChild(ghost);

    dragState.current = {
      active: true,
      fromTrack: track,
      startY: e.clientY,
      startScrollTop: containerRef.current?.scrollTop || 0,
      ghost,
    };

    // Add global listeners
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragState.current.active) return;
    const deltaY = e.clientY - dragState.current.startY;
    const ghost = dragState.current.ghost;
    if (ghost) {
      ghost.style.transform = `translateY(${deltaY}px)`;
    }

    // Find element under cursor
    const elemUnderCursor = document.elementsFromPoint(e.clientX, e.clientY)[0];
    const targetLi = elemUnderCursor.closest('.track-item');
    
    if (targetLi) {
      const targetPath = targetLi.getAttribute('data-path');
      // Now we correctly compare string to string
      if (targetPath && targetPath !== dragState.current.fromTrack?.path) {
        setDragOverPath(targetPath);
      } else {
        setDragOverPath(null);
      }
    } else {
      setDragOverPath(null);
    }

    // Auto-scroll when near edges
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const scrollSpeed = 15;
      if (e.clientY < rect.top + 80) {
        if (!scrollInterval.current) {
          scrollInterval.current = window.setInterval(() => {
            container.scrollTop -= scrollSpeed;
          }, 16);
        }
      } else if (e.clientY > rect.bottom - 80) {
        if (!scrollInterval.current) {
          scrollInterval.current = window.setInterval(() => {
            container.scrollTop += scrollSpeed;
          }, 16);
        }
      } else {
        if (scrollInterval.current) {
          clearInterval(scrollInterval.current);
          scrollInterval.current = null;
        }
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragState.current.active) return;
    const fromTrack = dragState.current.fromTrack;
    const targetLi = document.elementsFromPoint(e.clientX, e.clientY)[0]?.closest('.track-item');
    const toPath = targetLi?.getAttribute('data-path');
    const toTrack = tracks.find(t => t.path === toPath);

    if (fromTrack && toTrack && fromTrack !== toTrack) {
      onReorder(fromTrack, toTrack);
    }

    // Cleanup
    if (dragState.current.ghost) dragState.current.ghost.remove();
    if (scrollInterval.current) clearInterval(scrollInterval.current);
    dragState.current = { active: false, fromTrack: null, startY: 0, startScrollTop: 0, ghost: null };
    setDragOverPath(null);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  return (
    <div ref={containerRef} className="virtual-scroll-container" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' }}>
      <ul className="track-list" style={{ height: 'auto', position: 'relative' }}>
        {tracks.map((track, index) => {
          const profileData = PROFILES.find(p => p.id === track.profile);
          const isActive = currentTrackPath === track.path;
          const isDragOver = dragOverPath === track.path;
          const isSelected = selectedTracks.has(track.path);

          return (
            <li
              key={track.path + index}
              data-path={track.path}
              className={`track-item ${isActive ? 'active' : ''} ${isDragOver ? 'playlist-drag-over' : ''} ${isSelected ? 'selected-row' : ''}`}
              style={{ '--track-color': trackAccentColor(track.name), position: 'relative', height: ITEM_HEIGHT, userSelect: 'none' } as React.CSSProperties}
              onClick={() => {
                if (isSelectionMode) onToggleSelect(track.path);
                else onPlay(track);
              }}
            >
              <div className="track-cell title-cell">
                {isSelectionMode ? (
                  <input 
                    type="checkbox" 
                    checked={isSelected} 
                    readOnly 
                    style={{ marginRight: '10px', transform: 'scale(1.2)', accentColor: 'var(--theme-color)' }} 
                  />
                ) : (
                  <span 
                    className="drag-handle" 
                    style={{ cursor: 'grab', paddingRight: '12px', paddingLeft: '4px', touchAction: 'none' }}
                    onPointerDown={(e) => startDrag(e, track)}
                  >⠿</span>
                )}

                <div className="track-item-icon">
                  {isActive && albumArt
                    ? <div className="track-thumb-art" style={{ backgroundImage: `url(${albumArt})` }} />
                    : track.thumb
                      ? <div className="track-thumb-art" style={{ backgroundImage: `url(${track.thumb})` }} />
                      : <span>{profileData?.icon ?? '🎵'}</span>}
                </div>
                <div className="track-item-details">
                  <span className="track-item-name">{track.name}</span>
                  <span className="track-item-artist">
                    {track.artist}
                    {track.profile && <span className="track-profile-icon">{profileData?.icon}</span>}
                  </span>
                </div>
              </div>
              <div className="track-cell hide-mobile">{track.album}</div>
              <div className="track-cell hide-mobile">{track.year}</div>
              <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
              <div className="track-cell time-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
                {!isSelectionMode && (
                  <button
                    className="ep-icon-btn no-touch-effects"
                    style={{ width: 28, height: 28, fontSize: 15, background: 'transparent', border: 'none', opacity: 0.7, color: '#ff5555' }}
                    onClick={e => { e.stopPropagation(); onRemove(track); }}
                    title="Remove from playlist"
                  >✕</button>
                )}
                {track.duration ? formatTime(track.duration) : '--:--'}
              </div>
            </li>
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

const PlaylistPopup = memo(({
  playlists, onClose, onCreate, onAdd, newPlaylistName, setNewPlaylistName
}: {
  playlists: CustomPlaylist[]; onClose: () => void;
  onCreate: (e: React.FormEvent) => void; onAdd: (id: string) => void;
  newPlaylistName: string; setNewPlaylistName: (v: string) => void;
}) => {
  // ── Click-through guard ──────────────────────────────────────────────────
  // The same pointer event that opened this popup (mousedown on the + button)
  // can fire on the overlay backdrop milliseconds after mount, closing it
  // instantly. We block backdrop closes for 220ms after mount.
  const canClose = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { canClose.current = true; }, 220);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="playlist-popup-overlay"
      onPointerDown={() => { if (canClose.current) onClose(); }}
    >
      <div
        className="playlist-popup-glass"
        onPointerDown={e => e.stopPropagation()}
      >
        {/* Header — same style as glass-options-menu header */}
        <div className="glass-menu-header">Add to Playlist</div>

        {/* Existing playlists */}
        <div className="playlist-popup-list">
          {playlists.length === 0 ? (
            <p className="playlist-popup-empty">No playlists yet — create one below.</p>
          ) : (
            playlists.map(pl => (
              <button
                key={pl.id}
                className="playlist-popup-item"
                onPointerDown={e => e.stopPropagation()}
                onClick={() => onAdd(pl.id)}
              >
                <span className="playlist-popup-item-icon">📑</span>
                <div className="playlist-popup-item-info">
                  <span className="playlist-popup-item-name">{pl.name}</span>
                  <span className="playlist-popup-item-count">{pl.trackPaths.length} tracks</span>
                </div>
                <span className="playlist-popup-item-add">＋</span>
              </button>
            ))
          )}
        </div>

        {/* Divider */}
        <div className="playlist-popup-divider" />

        {/* Create new playlist */}
        <form onSubmit={onCreate} className="playlist-popup-form">
          <input
            autoFocus
            className="playlist-popup-input"
            placeholder="New playlist name…"
            value={newPlaylistName}
            onChange={e => setNewPlaylistName(e.target.value)}
            onPointerDown={e => e.stopPropagation()}
          />
          <button
            type="submit"
            className="playlist-popup-create-btn"
            onPointerDown={e => e.stopPropagation()}
          >
            Create
          </button>
        </form>
      </div>
    </div>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const appWindow = getCurrentWindow();
  
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
  const themeColorRef                       = useRef('#c8222a');
  useEffect(() => { themeColorRef.current = themeColor; }, [themeColor]);
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
const [smartTaste, setSmartTaste]         = useState<Taste>('ORIGINAL');
  const [detectedProfile, setDetectedProfile] = useState<AudioProfile | null>(null);
  const [isAnalyzing, setIsAnalyzing]       = useState(false);

  const [bulkScanActive, setBulkScanActive] = useState(false);
  const [bulkScanPaused, setBulkScanPaused] = useState(false);
  const [bulkScanDone, setBulkScanDone]     = useState(0);
  const [bulkScanTotal, setBulkScanTotal]   = useState(0);
  const [isBulkScanOpen, setIsBulkScanOpen] = useState(false);
  const [,setIsLimiterOn]       = useState(false);
  const [speakerMode, setSpeakerMode]       = useState<'NONE'|'LOW'|'MED'|'HIGH'>('NONE');
  
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
  
  const isShuffleRef       = useRef(false);
  const repeatModeRef      = useRef<'OFF'|'ALL'|'ONE'>('OFF');
  const shuffledQueueRef   = useRef<string[]>([]);
  const playHistoryRef     = useRef<string[]>([]);
  const [selectedAcousticEnv, setSelectedAcousticEnv] = useState('NONE');
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [isFIRMode, setIsFIRMode] = useState(false);
  const [visMode, setVisMode] = useState<'ORBIT' | 'RADAR'>('ORBIT');

  // Multi-band spatial imager refs — all DOM manipulation happens in the
  // rAF loop via these refs, zero React re-renders.
const bassRef    = useRef<HTMLDivElement>(null); 
const isSeekingRef = useRef(false);
  const midLRef    = useRef<HTMLDivElement>(null); 
  const midRRef    = useRef<HTMLDivElement>(null); 
  const trebLRef   = useRef<HTMLDivElement>(null); 
  const trebRRef   = useRef<HTMLDivElement>(null); 
  const otherLRef  = useRef<HTMLDivElement>(null); // NEW: 3D left 
  const otherRRef  = useRef<HTMLDivElement>(null); // NEW: 3D right
  const spatialData = useRef({ bLvl:0, bPan:0, mLvl:0, mPan:0, mPhs:1, tLvl:0, tPan:0, tPhs:1 });
  const audioLevelRef = useRef(0);
  const lastReactUpdate = useRef(0);
  const cornerTLRef = useRef<HTMLDivElement>(null); // Top Left
  const cornerBRRef = useRef<HTMLDivElement>(null); // Bottom Right
  const cornerTRRef = useRef<HTMLDivElement>(null); // Top Right
  const cornerBLRef = useRef<HTMLDivElement>(null); // Bottom Left
  const blob5Ref = useRef<HTMLDivElement>(null);
  const blob6Ref = useRef<HTMLDivElement>(null);
  const blob7Ref = useRef<HTMLDivElement>(null);
  const blob8Ref = useRef<HTMLDivElement>(null);
// const smartTasteRef      = useRef<Taste>('ORIGINAL');
  const ripple1Ref = useRef<HTMLDivElement>(null);
  const ripple2Ref = useRef<HTMLDivElement>(null);
  const ripple3Ref = useRef<HTMLDivElement>(null);

  // const lastMidLevel = useRef(0);
  const isDarkModeRef                       = useRef(isDarkMode);
  useEffect(() => { isDarkModeRef.current = isDarkMode; }, [isDarkMode]);
  // Tracks the physical expansion of the shockwaves
  const rippleState = useRef([
    { active: false, scale: 0, opacity: 0 },
    { active: false, scale: 0, opacity: 0 },
    { active: false, scale: 0, opacity: 0 }
  ]);
  const lastRippleTime = useRef(0);
  // ⬇️ TWEAK THESE VALUES HERE ⬇️
  const DUST_COUNT = 500;           // Cranked up for PC Pixie Dust storm!
  
  // Adaptive Bass State
  const rippleThreshold = useRef(0.55);
  const lastBassLevel = useRef(0);

  // NEW: Adaptive Treble State
  const dustThreshold = useRef(0.05);
  const lastTrebleLevel = useRef(0);

  // Treble Dust Particle Pool
  // UPGRADED: Hardware Accelerated Canvas Pool
  
  const dustCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // NEW: Blob Brownian Motion State (X, Y velocities and positions)
  // NEW: Liquid Time-Phase State for buttery smooth Lava Lamps
  const blobState = useRef([
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00015, sy: 0.00011 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00012, sy: 0.00016 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00017, sy: 0.00013 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00014, sy: 0.00018 },
    // NEW BLOBS (Unique sine wave speeds so they move independently)
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00011, sy: 0.00014 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00016, sy: 0.00012 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00013, sy: 0.00017 },
    { px: Math.random() * 10, py: Math.random() * 10, sx: 0.00018, sy: 0.00015 }
  ]);
  
  const dustState = useRef([...Array(DUST_COUNT)].map(() => ({ 
    active: false, x: 0, y: 0, vx: 0, vy: 0, scale: 0, opacity: 0, isLeft: true 
  })));

  useEffect(() => {
    const resize = () => {
      if (dustCanvasRef.current) {
        dustCanvasRef.current.width = window.innerWidth;
        dustCanvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  

  // Spatial Beacon Pool (Formerly 3D Artifacts)
  const artifactRefs = useRef<(HTMLDivElement | null)[]>([]);
  const artifactState = useRef([...Array(6)].map(() => ({
    active: false, x: 0, y: 0, scale: 0, opacity: 0
  })));

  
  const REVERB_ENVIRONMENTS = [
    { id: 'NONE', label: 'Off', path: '' },
    { id: 'FOREST', label: 'Open Forest', path: 'resources/impulses/forest.wav' },
    { id: 'EMT140', label: 'EMT-140', path: 'resources/impulses/emt140.wav' },
    { id: 'byronglacieralaska', label: 'Byron Glacier Alaska', path: 'resources/impulses/byronglacieralaska.wav' },
    { id: 'yogastudio', label: 'Yoga Studio', path: 'resources/impulses/yogastudio.wav' },
  ];

  

  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { isShuffleRef.current = isShuffle; }, [isShuffle]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    const handlePopState = () => {
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

  const activePlaylistId = currentView.startsWith('PLAYLIST_') ? currentView.replace('PLAYLIST_', '') : null;

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
        .slice(0, 50);
    } else if (activePlaylistId) {
      const targetPlaylist = customPlaylists.find(p => p.id === activePlaylistId);
      if (targetPlaylist) {
        // FIX: Map the array directly so tracks render in the exact chronological order you added them
        base = targetPlaylist.trackPaths
          .map(path => playlist.find(t => t.path === path))
          .filter((t): t is Track => t !== undefined);
      }
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

        // Fetch tracks AND metrics from SQLite
        const saved = await invoke<Track[]>('fetch_library');
        if (saved?.length) {
          playlistRef.current = saved;
          setPlaylist(saved);
          setFavorites(saved.filter(t => t.isFavorite).map(t => t.path)); // Hydrate favorites
        }
        
        // Fetch Playlists from SQLite
        const savedPlaylists = await invoke<CustomPlaylist[]>('get_playlists');
        if (savedPlaylists) setCustomPlaylists(savedPlaylists);

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
          const m: number[] = await invoke('audio_metrics');
          
          // 1. INSTANT UPDATE: Update the Spatial Refs every 32ms for real-time visualization
          const lvl = Math.min(1, m[10] * 3.5);
          audioLevelRef.current = lvl;
          spatialData.current = {
            bLvl: m[2], bPan: m[3],
            mLvl: m[4], mPan: m[5], mPhs: m[6],
            tLvl: m[7], tPan: m[8], tPhs: m[9],
          };

          // 2. THROTTLED UPDATE: Only let React update the UI clock every 250ms to prevent lag
          const now = Date.now();
          if (now - lastReactUpdate.current > 250) {
            if (!isSeekingRef.current) setCurrentTime(m[0]); // <--- ONLY update if not dragging!
            if (m[1] > 0) setDuration(m[1]);
            setAudioLevel(lvl);
            lastReactUpdate.current = now;
          }

          if (m[11] === 1.0) setIsPlaying(false);
        } catch (_) {}
    }, 32); // <--- CRITICAL FIX: Changed from 250ms to 32ms for real-time reactivity!
    return () => clearInterval(iv);
  }, [isPlaying, isLoading]);


  // 60fps hardware-accelerated multi-band spatial imager.
  // Reads only refs — never stale, never triggers a React render.
  const visModeRef = useRef<'ORBIT' | 'RADAR'>('ORBIT');
  useEffect(() => { visModeRef.current = visMode; }, [visMode]);

useEffect(() => {
    const rBx = { v: 0 }, rBs = { v: 0 };
    const rMx = { v: 0 }, rMw = { v: 0 }, rMs = { v: 0 };
    const rTx = { v: 0 }, rTw = { v: 0 }, rTs = { v: 0 };
    const rOx = { v: 0 }, rOw = { v: 0 }, rOs = { v: 0 };

    // ── GAME DEV TRICK: OFFSCREEN SPRITE BLITTING ──
    // We create a tiny hidden canvas to hold our perfect neon star.
    const glowSpriteDark = document.createElement('canvas');
    glowSpriteDark.width = 64; glowSpriteDark.height = 64;
    
    const glowSpriteLight = document.createElement('canvas');
    glowSpriteLight.width = 64; glowSpriteLight.height = 64;
    
    let lastSpriteColor = '';

  

    let rafId: number;
    const tick = () => {
      if (visModeRef.current === 'RADAR') {
        const d = spatialData.current;
        const lerp = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k;
        
        const K_fast = 0.15;  
        const K_slow = 0.035; 
        const now = Date.now();

        // ── DYNAMIC SPRITE GENERATOR (Runs ONLY when the song color changes) ──
        // Costs 0% GPU because the heavy shadowBlur math only happens once per track!
        if (themeColorRef.current !== lastSpriteColor) {
          lastSpriteColor = themeColorRef.current;
          
          // 1. Paint the Dark Mode Sprite (Blinding White Core + Neon Glow)
          const dCtx = glowSpriteDark.getContext('2d');
          if (dCtx) {
            dCtx.clearRect(0, 0, 64, 64);
            dCtx.shadowBlur = 16; 
            dCtx.shadowColor = lastSpriteColor; 
            dCtx.fillStyle = '#ffffff'; 
            dCtx.beginPath(); dCtx.arc(32, 32, 5, 0, Math.PI * 2); dCtx.fill();
            dCtx.shadowBlur = 0;
          }

          // 2. Paint the Light Mode Sprite (Solid Theme Color Core + Faint Drop Shadow)
          const lCtx = glowSpriteLight.getContext('2d');
          if (lCtx) {
            lCtx.clearRect(0, 0, 64, 64);
            lCtx.shadowBlur = 12; 
            lCtx.shadowColor = 'rgba(0,0,0,0.2)'; 
            lCtx.fillStyle = lastSpriteColor; 
            lCtx.beginPath(); lCtx.arc(32, 32, 5, 0, Math.PI * 2); lCtx.fill();
            lCtx.shadowBlur = 0;
          }
        }

        // ── AMBIENT CORNER LAVA LAMPS (8 Free-Roaming Blobs) ──
        // ── AMBIENT CORNER LAVA LAMPS (8 Free-Roaming Blobs - Constrained to Screen) ──
        const lvl = audioLevelRef.current;
        const cRefs = [cornerTLRef, cornerBRRef, cornerTRRef, cornerBLRef, blob5Ref, blob6Ref, blob7Ref, blob8Ref];
        
        blobState.current.forEach((b, i) => {
          // CRITICAL FIX: Drastically reduced the amplitude multipliers.
          // Max wander distance is now 15 + 8 = 23vw (down from 50vw).
          // They will float beautifully but stay firmly on the monitor.
          const x = Math.sin(now * b.sx + b.px) * 15 + Math.sin(now * (b.sx * 0.8) + b.py) * 8;
          const y = Math.cos(now * b.sy + b.py) * 15 + Math.cos(now * (b.sy * 0.7) + b.px) * 8;

          if (cRefs[i].current) {
            cRefs[i].current!.style.transform = `translate(${x}vw, ${y}vh) scale(${1.0 + lvl * 0.15})`;
          }
        });

        // ── BASS CORE ──
        rBx.v = lerp(rBx.v, d.bPan * 3, K_fast); 
        rBs.v = lerp(rBs.v, d.bLvl, K_fast);      
        if (bassRef.current) bassRef.current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${1.0 + rBs.v * 0.8})`;

        // ── LINEAR BASS RIPPLES ──
        rippleThreshold.current = Math.max(0.12, rippleThreshold.current - 0.001); 
        const isSpike = d.bLvl > rippleThreshold.current && (d.bLvl - lastBassLevel.current) > 0.035;
        
        if (isSpike && now - lastRippleTime.current > 350) {
          const availableRipple = rippleState.current.find(r => !r.active);
          if (availableRipple) {
            availableRipple.active = true;
            availableRipple.scale = 0.5;   
            availableRipple.opacity = 1.0; 
            lastRippleTime.current = now;
            rippleThreshold.current = Math.min(0.8, d.bLvl + 0.15); 
          }
        }
        lastBassLevel.current = d.bLvl;

        const rRefs = [ripple1Ref, ripple2Ref, ripple3Ref];
        rippleState.current.forEach((rip, idx) => {
          if (rip.active) {
            rip.scale += 0.06; 
            rip.opacity -= 0.006; 
            
            if (rip.opacity <= 0) {
              rip.active = false;
              rip.opacity = 0;
            }
            if (rRefs[idx].current) {
              rRefs[idx].current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${rip.scale})`;
              rRefs[idx].current.style.opacity = `${rip.opacity}`;
            }
          }
        });

        // ── MIDS ──
        rMx.v = lerp(rMx.v, d.mPan * 12, K_slow); 
        rMw.v = lerp(rMw.v, Math.max(0, (1.0 - d.mPhs)) * 8 + 6, K_slow); 
        rMs.v = lerp(rMs.v, d.mLvl, K_slow);
        if (midLRef.current) midLRef.current.style.transform = `translate(calc(-50% + ${rMx.v - rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;
        if (midRRef.current) midRRef.current.style.transform = `translate(calc(-50% + ${rMx.v + rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;

        // ── TREBLE ──
        rTx.v = lerp(rTx.v, d.tPan * 25, K_slow);
        rTw.v = lerp(rTw.v, Math.max(0, (1.0 - d.tPhs)) * 14 + 15, K_slow); 
        rTs.v = lerp(rTs.v, d.tLvl, K_slow);
        if (trebLRef.current) trebLRef.current.style.transform = `translate(calc(-50% + ${rTx.v - rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;
        if (trebRRef.current) trebRRef.current.style.transform = `translate(calc(-50% + ${rTx.v + rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;

        // ── EXTREME 3D EDGES ──
        const isWide3D = d.tPhs < -0.1 ? Math.abs(d.tPhs) : 0;
        rOx.v = lerp(rOx.v, d.tPan * 35, K_slow);
        rOw.v = lerp(rOw.v, isWide3D * 15 + 32, K_slow); 
        rOs.v = lerp(rOs.v, isWide3D * d.tLvl, K_slow);
        if (otherLRef.current) {
          otherLRef.current.style.transform = `translate(calc(-50% + ${rOx.v - rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`;
          otherLRef.current.style.opacity = `${isWide3D * 0.8}`;
        }
        if (otherRRef.current) {
          otherRRef.current.style.transform = `translate(calc(-50% + ${rOx.v + rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`;
          otherRRef.current.style.opacity = `${isWide3D * 0.8}`;
        }
        
        // ── HARDWARE ACCELERATED CANVAS DUST ──
        dustThreshold.current = Math.max(0.04, dustThreshold.current - 0.003);
        const isTrebleSpike = d.tLvl > dustThreshold.current && (d.tLvl - lastTrebleLevel.current) > 0.008;
        
        if (isTrebleSpike) {
          for(let i=0; i<18; i++) {
            const p = dustState.current.find(p => !p.active);
            if (p) {
              p.active = true;
              p.isLeft = Math.random() > 0.5;
              
              p.y = (Math.random() - 0.5) * 60; 
              const yNorm = p.y / 35;           
              const arcBulge = 11 * Math.sqrt(Math.max(0, 1 - yNorm * yNorm)); 

              if (p.isLeft) {
                p.x = (rTx.v - rTw.v) - arcBulge; 
                p.vx = -(Math.random() * 0.6 + 0.2);
              } else {
                p.x = (rTx.v + rTw.v) + arcBulge; 
                p.vx = (Math.random() * 0.6 + 0.2);
              }
              
              p.vy = (Math.random() - 0.5) * 0.4 - 0.15; 
              p.scale = Math.random() * 0.5 + 0.3;
              p.opacity = 1.0; 
            }
          }
          dustThreshold.current = Math.min(0.5, d.tLvl + 0.08);
        }
        lastTrebleLevel.current = d.tLvl;

        const canvas = dustCanvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const displayWidth = canvas.clientWidth;
          const displayHeight = canvas.clientHeight;
          
          if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;
          }

          const ctx = canvas.getContext('2d', { alpha: true });
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const vw = canvas.width / 100;
            const vh = canvas.height / 100;

            // Use the correct blend mode based on theme
            ctx.globalCompositeOperation = isDarkModeRef.current ? 'screen' : 'source-over'; 
            
            // Select the pre-rendered image we want to stamp
            const activeSprite = isDarkModeRef.current ? glowSpriteDark : glowSpriteLight;

            dustState.current.forEach((p) => {
              if (p.active) {
                p.vx += (Math.random() - 0.5) * 0.08; 
                p.vy -= 0.015; 
                p.vx *= 0.96; 
                p.vy *= 0.96;
                p.x += p.vx; 
                p.y += p.vy;
                p.opacity -= 0.008; 
                
                if (p.opacity <= 0) {
                  p.active = false;
                } else {
                  ctx.globalAlpha = p.opacity;
                  
                  // CRITICAL FIX: Direct GPU Image Stamping. No live shadowBlur calculations!
                  // We scale the 64x64 pre-rendered sprite to match the physical particle size.
                  const drawSize = (p.scale * dpr) * 70; 
                  ctx.drawImage(activeSprite, (cx + p.x * vw) - drawSize/2, (cy + p.y * vh) - drawSize/2, drawSize, drawSize);
                }
              }
            });
          }
        }

        // ── ELEGANT 3D ARTIFACTS ──
        const threshold = 0.05; 
        
        if (d.tPhs < threshold && Math.random() > 0.6) {
          const art = artifactState.current.find(a => !a.active);
          if (art) {
            art.active = true;
            art.x = (Math.random() - 0.5) * 80; 
            art.y = (Math.random() - 0.5) * 80; 
            art.scale = 0; 
            art.opacity = 1.0; 
          }
        }

        artifactState.current.forEach((art, i) => {
          if (art.active) {
            art.scale += 0.025; 
            // CRITICAL FIX 3: Drastically reduced expansion multiplier. 
            // They stay tight and compact instead of swelling into massive circles.
            const actualScale = 0.5 + Math.sin(art.scale) * 0.6; 
            art.opacity = Math.max(0, 1.0 - (art.scale / 3.14)); 
            
            if (art.scale >= 3.14) {
              art.active = false;
              art.opacity = 0;
            }
            const el = artifactRefs.current[i];
            if (el) {
              el.style.transform = `translate(calc(-50% + ${art.x}vw), calc(-50% + ${art.y}vh)) scale(${actualScale})`;
              el.style.opacity = `${art.opacity}`;
            }
          }
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
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

    let activeQueue = list;
    let i = activeQueue.findIndex(t => t.path === track.path);
    
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
      
      if (currentPath && lastCountedTrackRef.current !== currentPath) {
        lastCountedTrackRef.current = currentPath;
        const listened = Math.floor(duration);
        
        setPlaylist(prev => prev.map(t => t.path === currentPath 
          ? { ...t, playCount: (t.playCount || 0) + 1, totalSecondsListened: (t.totalSecondsListened || 0) + listened } : t));
        
        // Save to SQLite instantly
        invoke('update_play_stats', { path: currentPath, seconds: listened }).catch(console.error);
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
    const [fb, fm, fh] = FIR_GAINS[profile.id] ?? FIR_GAINS.DEFAULT;
await writeToEngine(`FIRGAIN ${fb.toFixed(3)} ${fm.toFixed(3)} ${fh.toFixed(3)}`);
  };
  

  const handleTasteChange = async (taste: Taste) => {
    // CRITICAL FIX: If clicking the currently active pill, toggle it OFF (return to ORIGINAL)
    const newTaste = (smartTaste === taste) ? 'ORIGINAL' : taste;
    
    setSmartTaste(newTaste); 
    smartTasteRef.current = newTaste;
    
    if (isManualOverride) {
      setIsManualOverride(false);
      setSelectedAcousticEnv('NONE'); 
      await writeToEngine(`LOAD_IR `); 
      await writeToEngine(`CONVOLUTION 0.0`); 
    }

    if (detectedProfileRef.current) {
      await applySmartSettings(detectedProfileRef.current, newTaste);
    } else if (newTaste === 'ORIGINAL') {
      // Failsafe: Ensure engine zeros out even if a profile hasn't loaded yet
      setUpscaleDrive(0); setWidenWidth(1.0); setSpatialExtra(0);
      setReverbWet(0); setIsCompressed(false); setIsRemastered(false);
      await writeToEngine(`UPSCALE 0`); await writeToEngine(`WIDEN 1.0`);
      await writeToEngine(`3D 0`);      await writeToEngine(`REVERB 0`);
      await writeToEngine(`COMPRESS 0`); await writeToEngine(`REMASTER 0`);
    }
  };
  const handleToggleShuffle = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = !isShuffle;
    setIsShuffle(next);
    if (next) {
      const { displayedTracks:list, currentTrack:track } = stateRefs.current;
      
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
    setRepeatDeg(d => d + 360);
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
    
    if (i === -1) {
      activeQueue = playlistRef.current;
      i = activeQueue.findIndex(t => t.path === track.path);
    }

    playTrack(activeQueue[(i - 1) < 0 ? activeQueue.length - 1 : i - 1]);
  }, []);

  const handleSeekDrag = (e:React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(parseFloat(e.target.value)); // Updates UI instantly while dragging
  };

  const handleSeekCommit = async (e:React.MouseEvent | React.TouchEvent) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    await writeToEngine(`SEEK ${v}`); // Send to C++ only on release
    isSeekingRef.current = false;
  };

  const toggleFavorite = async (e:React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack) return;
    const isAdding = !favorites.includes(currentTrack.path);
    
    // Update UI instantly
    const newFavs = isAdding ? [...favorites, currentTrack.path] : favorites.filter(p=>p!==currentTrack.path);
    setFavorites(newFavs);
    setPlaylist(prev => prev.map(t => t.path === currentTrack.path ? { ...t, isFavorite: isAdding } : t));
    
    // Save to SQLite
    try { await invoke('toggle_favorite', { path: currentTrack.path, isFavorite: isAdding }); } catch(_) {}
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
      
      // ── SQLITE INTEGRATION: Save new tracks to DB ──
      for (const t of newTracks) {
        try {
          await invoke('add_to_library', { track: t });
        } catch (e) { console.error(e); }
      }

      setTimeout(() => enrichMetadataInBackground(merged), 400);
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
    let enriched = 0; 

    for (let i = 0; i < needsEnrich.length; i += BATCH) {
      if (!enricherRunning.current) break;
      const batch = needsEnrich.slice(i, i + BATCH);

      const results = await Promise.all(batch.map(async (track) => {
        try {
          const raw = await invoke<number[] | string>('read_file_head', { path: track.path, maxBytes: 2097152 });          let uint8: Uint8Array;
          if (typeof raw === 'string') {
            const bin = atob(raw); uint8 = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) uint8[j] = bin.charCodeAt(j);
          } else uint8 = new Uint8Array(raw);

          const meta = await mm.parseBuffer(uint8, { mimeType: getMime(track.path) });

          let thumbBase64 = track.thumb;
          if (!thumbBase64 && meta.common.picture?.length) {
            thumbBase64 = await generateThumbnail(meta.common.picture[0]) || undefined;
          }

          return { 
            path: track.path, 
            name: meta.common.title || track.name, 
            artist: meta.common.artist || track.artist, 
            album: meta.common.album || track.album, 
            year: meta.common.year?.toString() || track.year, 
            quality: meta.format.bitrate ? `${Math.round(meta.format.bitrate / 1000)} kbps` : track.quality, 
            duration: meta.format.duration || track.duration, 
            metadataLoaded: true,
            genre: meta.common.genre?.[0] || track.genre || '',
            thumb: thumbBase64 
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

        // ── SQLITE INTEGRATION: Update enriched tracks in DB ──
        for (const u of updates) {
          try {
            await invoke('add_to_library', { track: u });
          } catch (e) {}
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

      // Inside the loop:
      if (pendingSave.length >= 20) {
        for (const save of pendingSave) {
          invoke('update_profile', { path: save.path, profile: save.profile }).catch(()=>{});
        }
        pendingSave = [];
      }
    } // End of loop

    // After the loop:
    if (pendingSave.length > 0) {
      for (const save of pendingSave) {
        invoke('update_profile', { path: save.path, profile: save.profile }).catch(()=>{});
      }
    }
    bulkScanRunning.current = false; setBulkScanActive(false); setBulkScanPaused(false);
  }, []);

  const pauseBulkScan  = useCallback(() => { bulkScanPausedRef.current=true;  setBulkScanPaused(true);  }, []);
  const resumeBulkScan = useCallback(() => { bulkScanPausedRef.current=false; setBulkScanPaused(false); }, []);
  const stopBulkScan   = useCallback(() => { bulkScanRunning.current=false; bulkScanPausedRef.current=false; setBulkScanActive(false); setBulkScanPaused(false); }, []);

  const playTrack = async (track: Track) => {
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
        writeToEngine(`LIMITER ${speakerMode === 'NONE' ? 0 : speakerMode === 'LOW' ? 0.3 : speakerMode === 'MED' ? 0.6 : 1.0}`),
        writeToEngine(`FIRGAIN ${FIR_GAINS.DEFAULT[0].toFixed(3)} ${FIR_GAINS.DEFAULT[1].toFixed(3)} ${FIR_GAINS.DEFAULT[2].toFixed(3)}`),
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
            // ── SQLITE INTEGRATION: Save updated metadata ──
            invoke('add_to_library', { track: updatedTrack }).catch(console.error);
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

  const createPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    
    const newPlaylist: CustomPlaylist = {
      id: Date.now().toString(),
      name: newPlaylistName.trim(),
      trackPaths: playlistModalTracks.length > 0 ? [...playlistModalTracks] : []
    };
    
    const updatedPlaylists = [...customPlaylists, newPlaylist];
    setCustomPlaylists(updatedPlaylists);
    setNewPlaylistName('');
    setPlaylistModalTracks([]); 
    setIsSelectionMode(false);  
    setSelectedTracks(new Set()); 
    
    if (dbProcess.current) {
      await dbProcess.current.set("user_playlists", updatedPlaylists);
      await dbProcess.current.save();
    }
  };

  const addToPlaylist = async (playlistId: string) => {
    const updatedPlaylists = customPlaylists.map(pl => {
      if (pl.id === playlistId) {
        const newUniqueTracks = playlistModalTracks.filter(path => !pl.trackPaths.includes(path));
        return { ...pl, trackPaths: [...pl.trackPaths, ...newUniqueTracks] };
      }
      return pl;
    });

    setCustomPlaylists(updatedPlaylists);
    setPlaylistModalTracks([]); 
    setIsSelectionMode(false);  
    setSelectedTracks(new Set());

    if (dbProcess.current) {
      await dbProcess.current.set("user_playlists", updatedPlaylists);
      await dbProcess.current.save();
    }
  };

  // FIX: Added explicit remove function
  const removeFromPlaylist = async (playlistId: string, trackPathsToRemove: string[]) => {
    const updatedPlaylists = customPlaylists.map(pl => {
      if (pl.id === playlistId) {
        return { ...pl, trackPaths: pl.trackPaths.filter(p => !trackPathsToRemove.includes(p)) };
      }
      return pl;
    });

    setCustomPlaylists(updatedPlaylists);
    setIsSelectionMode(false);
    setSelectedTracks(new Set());

    // ── SQLITE INTEGRATION: Save removal instantly ──
    const plToSave = updatedPlaylists.find(p => p.id === playlistId);
    if (plToSave) {
      invoke('save_playlist', { playlist: plToSave }).catch(console.error);
    }
  };

  // Reorder a track within a playlist by path — path-based so it works
  // correctly even when a search query is active and displayedTracks is a subset.
  const reorderPlaylist = useCallback(async (playlistId: string, fromTrack: Track, toTrack: Track) => {
    setCustomPlaylists(prev => {
      const pl = prev.find(p => p.id === playlistId);
      if (!pl) return prev;
      const fromIdx = pl.trackPaths.indexOf(fromTrack.path);
      const toIdx   = pl.trackPaths.indexOf(toTrack.path);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const newPaths = [...pl.trackPaths];
      const [moved] = newPaths.splice(fromIdx, 1);
      newPaths.splice(toIdx, 0, moved);
      const updated = prev.map(p => p.id === playlistId ? { ...p, trackPaths: newPaths } : p);
      
      // ── SQLITE INTEGRATION: Save new order natively ──
      const plToSave = updated.find(p => p.id === playlistId);
      if (plToSave) invoke('save_playlist', { playlist: plToSave }).catch(console.error);
      
      return updated;
    });
  }, []);

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
    if (preset==='STUDIO')   { pCmp=true; pDrv=0.7; pWid=1.10; pBas=0.3; }
    else if (preset==='CINEMATIC') { pRem=true; pCmp=true; pDrv=1.2; pWid=1.35; p3D=0.25; pRvb=0.16; pBas=0.8; }
    else                           { p3D=0.40; pRvb=0.22; pBas=0.1; }
    
    setIsRemastered(pRem); setIsCompressed(pCmp); setUpscaleDrive(pDrv);
    setWidenWidth(pWid); setSpatialExtra(p3D); setReverbWet(pRvb); setBassLevel(pBas);
    
    await writeToEngine(`REMASTER ${pRem?1:0}`); await writeToEngine(`COMPRESS ${pCmp?1:0}`);
    await writeToEngine(`UPSCALE ${pDrv}`);      await writeToEngine(`WIDEN ${pWid}`);
    await writeToEngine(`3D ${p3D}`);            await writeToEngine(`REVERB ${pRvb}`);
    await writeToEngine(`BASS ${pBas}`);
  };

const TASTES: {id:Taste;icon:string;label:string}[] = [ 
    {id:'QUALITY',icon:'✨',label:'HD Clear'},
    {id:'IMMERSIVE',icon:'🌌',label:'Immersive'},
    {id:'CHILL',icon:'🌙',label:'Chill'} 
  ];


  const renderSmartPills = () => (
    <div className="player-smart-section">
      <div className="player-profile-line">
        {isAnalyzing ? <span className="profile-analyzing"><span className="dot-pulse"/> Analyzing…</span>
          : isManualOverride ? <span className="profile-chip" style={{ color: '#ffa726', background: 'rgba(255, 167, 38, 0.15)' }}>⚙️ Manual Override Active</span>
          : detectedProfile ? <span className="profile-chip">Identified: {detectedProfile.icon} {detectedProfile.label}</span>
          : <span className="profile-chip muted">🎵 Standard Audio</span>}
      </div>
      
      <div className="player-taste-pills" style={{ opacity: isManualOverride ? 0.4 : 1, transition: 'opacity 0.2s ease' }}>
        {TASTES.map(t=>(
          <button 
            key={t.id} 
            className={`taste-pill ${!isManualOverride && smartTaste===t.id ? 'active' : ''}`} 
            onClick={()=>handleTasteChange(t.id)}
          >
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
        
        {/* NEW: CONVOLUTION REVERB DROPDOWN */}
        <div className="dsp-card">
          <div className="dsp-label-row">
            <label>Acoustic Environment (Convolution)</label>
          </div>
          <select 
            className="search-input" 
            style={{ marginTop: '8px', cursor: 'pointer', background: 'var(--bg-search)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            value={selectedAcousticEnv}
            onChange={async (e) => {
              const val = e.target.value;
              setSelectedAcousticEnv(val);
              const env = REVERB_ENVIRONMENTS.find(r => r.id === val);
              
              if (env && env.path) {
                try {
                  const fullPath = await resolveResource(env.path);
                  writeToEngine(`LOAD_IR ${fullPath}`);
                  // 0.35 wet: The transparent filter design (80Hz HP + 16kHz LP) means
                  // this value gives a full, rich plate sound without washing out vocals.
                  // Unlike the original 0.4 (which attenuated dry), here dry=1.0 always,
                  // so the reverb is purely additive and 0.35 sounds balanced.
                  writeToEngine(`CONVOLUTION 0.35`);
                  setIsManualOverride(true); // <--- NEW: Lock the smart pills
                  setSmartTaste('QUALITY' as Taste); // Reset the visual pill state
                } catch (err) {
                  console.error("Failed to load IR resource:", err);
                }
              } else {
                writeToEngine(`LOAD_IR `); 
                writeToEngine(`CONVOLUTION 0.0`);
                setIsManualOverride(false); // <--- NEW: Unlock the smart pills
              }
            }}
          >
            {REVERB_ENVIRONMENTS.map(env => (
              <option key={env.id} value={env.id}>{env.label}</option>
            ))}
          </select>
        </div>

<div className="dsp-card">
          <div className="dsp-label-row">
            <label>Tube Exciter (Air)</label>
            <span style={{ color: '#00e676', fontWeight: 600 }}>{Math.round(upscaleDrive * 50)}%</span>
          </div>
          <input 
            type="range" 
            className="dsp-slider" 
            min="0" 
            max="2.0" 
            step="0.05" 
            value={upscaleDrive} 
            onChange={e => {
              const v = parseFloat(e.target.value);
              setUpscaleDrive(v);
              writeToEngine(`UPSCALE ${v}`);
            }}
          />
        </div>      <div className="dsp-card"><div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{Math.round((widenWidth-1)*100)}% extra</span></div><input type="range" className="dsp-slider widener" min="1" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(`WIDEN ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?`+${Math.round(spatialExtra*100)}%`:'Base'}</span></div><input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(`3D ${v}`)}}/></div>
        <div className="dsp-card"><div className="dsp-label-row"><label>Digital Reverb (Algorithmic)</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div><input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(`REVERB ${v}`)}}/></div>
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
<input 
  type="range" 
  className="ep-progress-bar" 
  min="0" 
  max={duration||1} 
  value={currentTime} 
  onPointerDown={() => isSeekingRef.current = true}
  onChange={handleSeekDrag} 
  onPointerUp={handleSeekCommit}
/>          <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="ep-main-controls">
          <button
            className="ep-ctrl-btn no-touch-effects"
            onClick={handleToggleShuffle}
          >
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={isShuffle ? "M 3 8 C 9 8 13 16 20 16" : "M 3 8 C 9 8 13 8 20 8"} />
              <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={isShuffle ? "M 3 16 C 9 16 13 8 20 8" : "M 3 16 C 9 16 13 16 20 16"} />
              <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={isShuffle ? "M 17 13 L 20 16 L 17 19" : "M 17 5 L 20 8 L 17 11"} />
              <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={isShuffle ? "M 17 5 L 20 8 L 17 11" : "M 17 13 L 20 16 L 17 19"} />
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
          
          <button
            className="ep-ctrl-btn no-touch-effects"
            onClick={handleToggleRepeat}
          >
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: `rotate(${repeatDeg}deg)`, transition: 'transform 0.52s cubic-bezier(.4,0,.2,1)' }}>
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              <path style={{ transition: 'd 0.38s cubic-bezier(.4,0,.2,1), stroke-width 0.3s', strokeWidth: repeatMode === 'ONE' ? 2.2 : 1.8 } as React.CSSProperties}
                d={ repeatBusy ? "M 12 12 L 12 12 L 12 12" : repeatMode === 'OFF' ? "M 6 18 L 12 12 L 18 6" : repeatMode === 'ALL' ? "M 12 12 L 12 12 L 12 12" : "M 11 10 L 12 8 L 12 15" }
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
      
      {/* FIX: Replaced massive modal with sleek popup context menu */}
      {playlistModalTracks.length > 0 && (
        <PlaylistPopup 
          playlists={customPlaylists}
          newPlaylistName={newPlaylistName}
          setNewPlaylistName={setNewPlaylistName}
          onClose={() => setPlaylistModalTracks([])} 
          onCreate={createPlaylist}
          onAdd={(id) => addToPlaylist(id)} 
        />
      )}

      <aside className="sidebar" data-tauri-drag-region="true">
        <div className="sidebar-logo" data-tauri-drag-region="true">
          <span className="logo-d">D</span><span className="logo-rest">meX</span>
        </div>
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

        {customPlaylists.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', paddingLeft: '14px' }}>My Playlists</div>
            <nav>
              {customPlaylists.map(pl => (
                <button 
                  key={pl.id} 
                  className={currentView === `PLAYLIST_${pl.id}` ? 'active' : ''} 
                  onClick={() => setCurrentView(`PLAYLIST_${pl.id}` as NavView)}
                >
                  📑 {pl.name} <span className="nav-count">{pl.trackPaths.length}</span>
                </button>
              ))}
            </nav>
          </div>
        )}

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

        <header className="app-header" data-tauri-drag-region="true">
          <div data-tauri-drag-region="true">
            <h1 data-tauri-drag-region="true">
              {currentView==='ALL'?'Library':currentView==='FAVORITES'?'Favorites':'🎙️ Bollywood Classics'}
            </h1>
            {currentView==='BOLLYWOOD'&&bollywoodCount===0&&<p className="bollywood-hint" data-tauri-drag-region="true">Play your tracks — Bollywood ones auto-appear here</p>}
          </div>

          {!isMobile && (
            <div className="window-controls">
              <button className="win-btn min" onClick={() => appWindow.minimize()} title="Minimize">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="12" x2="20" y2="12"/></svg>
              </button>
              <button className="win-btn max" onClick={() => appWindow.toggleMaximize()} title="Maximize">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg>
              </button>
              <button className="win-btn close" onClick={() => appWindow.close()} title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          )}
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
              {/* FIX: Multi-Select Action Bar now includes Remove button if inside a playlist */}
              {!searchQuery && displayedTracks.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  {isSelectionMode ? (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <button className="dsp-btn" onClick={() => { setIsSelectionMode(false); setSelectedTracks(new Set()); }}>Cancel</button>
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>{selectedTracks.size} selected</span>
                      {selectedTracks.size > 0 && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="add-folder-btn" style={{ padding: '0 16px', height: '34px' }} onClick={() => setPlaylistModalTracks(Array.from(selectedTracks))}>
                            + Add
                          </button>
                          {activePlaylistId && (
                            <button className="add-folder-btn" style={{ padding: '0 16px', height: '34px', background: '#e81123', color: '#fff' }} onClick={() => removeFromPlaylist(activePlaylistId, Array.from(selectedTracks))}>
                              🗑 Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button className="dsp-btn" onClick={() => setIsSelectionMode(true)}>
                      ☑ Select Multiple
                    </button>
                  )}
                </div>
              )}
              
              <div className="track-list-header">
                <span>Title</span><span className="hide-mobile">Album</span><span className="hide-mobile">Year</span><span className="hide-mobile">Quality</span><span>⏱</span>
              </div>
              {activePlaylistId ? (
                /* Playlist view: drag-to-reorder, always shows remove (✕) button */
                <DraggablePlaylistView
                  tracks={displayedTracks}
                  currentTrackPath={currentTrack?.path}
                  albumArt={albumArt}
                  onPlay={playTrack}
                  formatTime={formatTime}
                  onRemove={track => removeFromPlaylist(activePlaylistId, [track.path])}
                  onReorder={(from, to) => reorderPlaylist(activePlaylistId, from, to)}
                  // ── NEW PROPS REQUIRED FOR BULK ACTIONS ──
                  isSelectionMode={isSelectionMode}
                  selectedTracks={selectedTracks}
                  onToggleSelect={(path) => {
                    setSelectedTracks(prev => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    });
                  }}
                />
              ) : (
                /* All-tracks / Favorites / etc. — uses VirtualList for 2000+ track performance */
                <VirtualList
                  tracks={displayedTracks}
                  currentTrackPath={currentTrack?.path}
                  albumArt={albumArt}
                  favorites={favorites}
                  onPlay={playTrack}
                  formatTime={formatTime}
                  onAddToPlaylist={(track) => setPlaylistModalTracks([track.path])}
                  onRemoveFromPlaylist={(track) => activePlaylistId && removeFromPlaylist(activePlaylistId, [track.path])}
                  activePlaylistId={activePlaylistId}
                  isSelectionMode={isSelectionMode}
                  selectedTracks={selectedTracks}
                  onToggleSelect={(path) => {
                    setSelectedTracks(prev => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    });
                  }}
                />
              )}
            </>
          )}
        </main>

        <footer className={`bottom-player ${isExpanded?'expanded':''}`}>
          {!isExpanded && (
            <div className="mini-player-content fade-in">
              <div className="progress-container mini">
<input 
  type="range" 
  className="progress-bar" 
  min="0" 
  max={duration||1} 
  value={currentTime} 
  onPointerDown={() => isSeekingRef.current = true}
  onChange={handleSeekDrag} 
  onPointerUp={handleSeekCommit}
  onClick={e=>e.stopPropagation()}
/>              </div>
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
                {visMode === 'ORBIT' ? (
                  <>
                    <div className="blob blob-1" style={{transform:`scale(${1+audioLevel*2.0})`,transition:'transform 0.12s ease-out'}}/>
                    <div className="blob blob-2" style={{transform:`scale(${1+audioLevel*1.3})`,transition:'transform 0.18s ease-out'}}/>
                    <div className="blob blob-3" style={{transform:`scale(${1+audioLevel*0.9})`,transition:'transform 0.22s ease-out'}}/>
                  </>
                ) : (
                  <div style={{ position: 'absolute', inset: 0, '--ring-core': isDarkMode ? 'rgba(255, 255, 255, 0.9)' : 'var(--theme-color)' } as React.CSSProperties}>
                    
                    {/* ── AMBIENT LAVA LAMPS (High Contrast Light Mode via Multiply Blend) ── */}
                    {/* The Original 4 */}
                    <div ref={cornerTLRef} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 1.0 : 0.85, zIndex: 0, top: '5%', left: '5%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={cornerBRRef} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 1.0 : 0.85, zIndex: 0, bottom: '5%', right: '5%', width: '45vw', height: '45vw', background: 'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={cornerTRRef} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 1.0 : 0.85, zIndex: 0, top: '5%', right: '5%', width: '35vw', height: '35vw', background: 'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={cornerBLRef} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 1.0 : 0.85, zIndex: 0, bottom: '5%', left: '5%', width: '40vw', height: '45vw', background: 'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)', willChange: 'transform' }} />
                    
                    {/* The 4 New Additions */}
                    <div ref={blob5Ref} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 0.8 : 0.65, zIndex: 0, top: '20%', left: '30%', width: '35vw', height: '35vw', background: 'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={blob6Ref} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 0.8 : 0.65, zIndex: 0, bottom: '20%', right: '30%', width: '40vw', height: '40vw', background: 'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={blob7Ref} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 0.8 : 0.65, zIndex: 0, top: '35%', right: '15%', width: '38vw', height: '38vw', background: 'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)', willChange: 'transform' }} />
                    <div ref={blob8Ref} style={{ position: 'absolute', mixBlendMode: isDarkMode ? 'normal' : 'multiply', opacity: isDarkMode ? 0.8 : 0.65, zIndex: 0, bottom: '35%', left: '15%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)', willChange: 'transform' }} />
                    {/* CRITICAL FIX 4: Dimmed the Light Mode white overlay from 0.6 down to 0.4 so it stops bleaching the screen */}
                    <div style={{ position: 'absolute', inset: 0, background: isDarkMode ? 'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)' : 'radial-gradient(circle at center, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.4) 100%)', zIndex: 1 }} />

                    {/* ── HOLOGRAPHIC IMAGER ── */}
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 2 }}>
                      
                      {/* BASS RIPPLES */}
                      <div ref={ripple1Ref} style={{ position: 'absolute', top: '50%', left: '50%', width: '15vw', height: '15vw', borderRadius: '50%', border: '3px solid var(--ring-core)', boxShadow: '0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)', opacity: 0, willChange: 'transform, opacity' }} />
                      <div ref={ripple2Ref} style={{ position: 'absolute', top: '50%', left: '50%', width: '15vw', height: '15vw', borderRadius: '50%', border: '3px solid var(--ring-core)', boxShadow: '0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)', opacity: 0, willChange: 'transform, opacity' }} />
                      <div ref={ripple3Ref} style={{ position: 'absolute', top: '50%', left: '50%', width: '15vw', height: '15vw', borderRadius: '50%', border: '3px solid var(--ring-core)', boxShadow: '0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)', opacity: 0, willChange: 'transform, opacity' }} />
                      
                      <canvas ref={dustCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3, pointerEvents: 'none' }} />

                      {/* BASS CORE */}
                      <div ref={bassRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '2.5vw', height: '2.5vw', borderRadius: '50%', background: 'var(--ring-core)', boxShadow: '0 0 30px 8px var(--theme-color)', willChange: 'transform' }} />                      
                      
                      {/* MIDS */}
                      <div ref={midLRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '12vw', height: '45vh', borderRadius: '50%', borderLeft: '4px solid var(--ring-core)', filter: 'drop-shadow(-4px 0 8px var(--blob-1)) drop-shadow(-4px 0 16px var(--theme-color))', willChange: 'transform' }} />
                      <div ref={midRRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '12vw', height: '45vh', borderRadius: '50%', borderRight: '4px solid var(--ring-core)', filter: 'drop-shadow(4px 0 8px var(--blob-1)) drop-shadow(4px 0 16px var(--theme-color))', willChange: 'transform' }} />
                      
                      {/* TREBLE */}
                      <div ref={trebLRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '22vw', height: '70vh', borderRadius: '50%', borderLeft: '3px solid var(--ring-core)', filter: 'drop-shadow(-6px 0 10px var(--blob-2)) drop-shadow(-6px 0 20px var(--theme-color))', willChange: 'transform' }} />
                      <div ref={trebRRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '22vw', height: '70vh', borderRadius: '50%', borderRight: '3px solid var(--ring-core)', filter: 'drop-shadow(6px 0 10px var(--blob-2)) drop-shadow(6px 0 20px var(--theme-color))', willChange: 'transform' }} />

                      {/* EXTREME 3D BOUNDARIES */}
                      <div ref={otherLRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '35vw', height: '95vh', borderRadius: '50%', borderLeft: '2px solid var(--ring-core)', filter: 'drop-shadow(-10px 0 15px var(--blob-3))', willChange: 'transform, opacity' }} />
                      <div ref={otherRRef} style={{ position: 'absolute', top: '50%', left: '50%', width: '35vw', height: '95vh', borderRadius: '50%', borderRight: '2px solid var(--ring-core)', filter: 'drop-shadow(10px 0 15px var(--blob-3))', willChange: 'transform, opacity' }} />

                     {/* CRITICAL FIX 5: ELEGANT 3D ARTIFACTS - Added curly braces to ref to satisfy TypeScript */}
                      {[...Array(6)].map((_, i) => (
                        <div key={`art${i}`} ref={(el) => { artifactRefs.current[i] = el; }} style={{
                          position: 'absolute', top: '50%', left: '50%', width: '2vw', height: '2vw', borderRadius: '50%', 
                          background: 'var(--blob-3)', 
                          filter: 'blur(3px)',
                          opacity: 0, willChange: 'transform, opacity' 
                        }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {showDSPPage && renderMobileDSPPage()}
              <div className="mobile-album-gradient"/>
              <div className="mobile-album-gradient"/>
              
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
                        <div className="glass-menu-section" style={{marginTop: 14}}>
                          <div className="glass-label-row" style={{marginBottom: 10}}>
                            <span>Speaker Boost</span>
                            <span style={{
                              color: speakerMode === 'NONE' ? 'var(--text-secondary)' :
                                     speakerMode === 'LOW'  ? '#4fc3f7' :
                                     speakerMode === 'MED'  ? '#ff9800' : '#ff3b30',
                              fontWeight: 600, fontSize: '0.8rem', transition: 'color 0.2s'
                            }}>
                              {speakerMode === 'NONE' ? 'Off' : speakerMode === 'LOW' ? '30%' : speakerMode === 'MED' ? '60%' : '100%'}
                            </span>
                          </div>
                          <div className="glass-boost-grid">
                            {(['NONE','LOW','MED','HIGH'] as const).map(mode => (
                              <button
                                key={mode}
                                className={`glass-boost-btn ${speakerMode === mode ? 'active' : ''}`}
                                style={speakerMode === mode ? {
                                  background: mode === 'NONE' ? 'rgba(255,255,255,0.18)' :
                                              mode === 'LOW'  ? 'rgba(79,195,247,0.25)' :
                                              mode === 'MED'  ? 'rgba(255,152,0,0.25)' :
                                                                'rgba(255,59,48,0.28)',
                                  borderColor: mode === 'NONE' ? 'rgba(255,255,255,0.35)' :
                                               mode === 'LOW'  ? 'rgba(79,195,247,0.5)' :
                                               mode === 'MED'  ? 'rgba(255,152,0,0.5)' :
                                                                 'rgba(255,59,48,0.55)',
                                  color: mode === 'NONE' ? '#fff' :
                                         mode === 'LOW'  ? '#4fc3f7' :
                                         mode === 'MED'  ? '#ff9800' : '#ff3b30',
                                } : undefined}
                                onClick={() => {
                                  setSpeakerMode(mode);
                                  setIsLimiterOn(mode !== 'NONE');
                                  const val = mode === 'NONE' ? 0 : mode === 'LOW' ? 0.3 : mode === 'MED' ? 0.6 : 1.0;
                                  writeToEngine(`LIMITER ${val}`);
                                }}
                              >
                                {mode === 'NONE' ? 'None' : mode === 'LOW' ? 'Low' : mode === 'MED' ? 'Med' : 'High'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Background Visualizer toggle */}
                        <div className="glass-menu-section" style={{marginTop: 14}}>
                          <div className="glass-label-row" style={{marginBottom: 10}}>
                            <span>Background Visualizer</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                              {visMode === 'ORBIT' ? 'Lava Lamps' : '📡 Spatial Radar'}
                            </span>
                          </div>
                          <div className="glass-boost-grid">
                            <button
                              className={`glass-boost-btn ${visMode === 'ORBIT' ? 'active' : ''}`}
                              style={visMode === 'ORBIT' ? { background: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' } : undefined}
                              onClick={() => setVisMode('ORBIT')}
                            >
                              🫧 Orbit
                            </button>
                            <button
                              className={`glass-boost-btn ${visMode === 'RADAR' ? 'active' : ''}`}
                              style={visMode === 'RADAR' ? { background: `rgba(200,34,42,0.25)`, borderColor: 'var(--theme-color)', color: 'var(--theme-color)' } : undefined}
                              onClick={() => setVisMode('RADAR')}
                            >
                              📡 Spatial
                            </button>
                          </div>
                        </div>

                        {/* Audiophile FIR EQ toggle
                            Optional linear-phase FIR EQ that replaces the standard
                            IIR biquad remaster chain. Eliminates phase smearing on
                            cymbals and hi-hats for trained ears. Off by default. */}
                        <div className="glass-menu-section" style={{marginTop: 14}}>
                          <div className="glass-label-row" style={{marginBottom: 6}}>
                            <span>Audiophile EQ</span>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: isFIRMode ? '#a5d6a7' : 'var(--text-secondary)',
                              transition: 'color 0.2s',
                            }}>
                              {isFIRMode ? '✦ Linear Phase' : 'Standard IIR'}
                            </span>
                          </div>
                          <p style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            margin: '0 0 10px 0',
                            lineHeight: 1.4,
                          }}>
                            Zero phase smearing on cymbals & hi-hats.
                            Uses FIR convolution — sounds best on headphones.
                          </p>
                          <div className="glass-boost-grid">
                            <button
                              className={`glass-boost-btn ${!isFIRMode ? 'active' : ''}`}
                              style={!isFIRMode ? { background: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' } : undefined}
                              onClick={() => {
                                setIsFIRMode(false);
                                writeToEngine('FIRMODE 0');
                              }}
                            >
                              Standard
                            </button>
                            <button
                              className={`glass-boost-btn ${isFIRMode ? 'active' : ''}`}
                              style={isFIRMode ? {
                                background: 'rgba(165,214,167,0.2)',
                                borderColor: '#a5d6a7',
                                color: '#a5d6a7',
                              } : undefined}
                              onClick={() => {
                                setIsFIRMode(true);
                                writeToEngine('FIRMODE 1');
                                // If remaster isn't on, FIR still works standalone
                                // (it has its own preset gains)
                              }}
                            >
                              ✦ Audiophile
                            </button>
                          </div>
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