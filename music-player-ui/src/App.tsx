import React, { useEffect, useRef, useState, useCallback, memo, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import * as mm from "music-metadata";
import Marquee from "react-fast-marquee";
import { FastAverageColor } from "fast-average-color";
import "./App.css";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { resolveResource } from '@tauri-apps/api/path';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION — evaluated once at module load, never inside a component.
// IS_ANDROID gates every Android-specific optimisation in this file.
// ─────────────────────────────────────────────────────────────────────────────
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_MOBILE  = /Android|iPhone|iPad/i.test(navigator.userAgent);

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

interface Track {
  id?: string; name: string; path: string; artist: string; album: string;
  year?: string; quality?: string; duration: number;
  lyrics?: LyricLine[]; profile?: string;
  metadataLoaded?: boolean; genre?: string;
  isFavorite?: boolean;
  playCount?: number;
  totalSecondsListened?: number;
  thumb?: string;
}

interface CustomPlaylist { id: string; name: string; trackPaths: string[]; }
interface LyricLine { time: number; text: string; }
type Taste   = 'ORIGINAL' | 'QUALITY' | 'IMMERSIVE' | 'CHILL' | 'BYPASS';
type NavView = 'ALL' | 'FAVORITES' | 'BOLLYWOOD' | 'TOPTRACKS' | string;
interface DSPSettings { drive:number; widen:number; spatial:number; reverb:number; compress:boolean; remaster:boolean; }
interface AudioProfile { id:string; label:string; icon:string; description:string; settings:DSPSettings; }

const PROFILES: AudioProfile[] = [
  { id:'CLASSICAL', label:'Classical / Orchestral', icon:'🎻', description:'High dynamic range · Natural wide field',
    settings:{ drive:0.2, widen:1.25, spatial:0.08, reverb:0.10, compress:false, remaster:false } },
  { id:'BOLLYWOOD', label:'90s Bollywood Classics', icon:'🎙️', description:'Warm vintage analog · Vocals front & center',
    settings:{ drive:0.4, widen:1.12, spatial:0.05, reverb:0.05, compress:true, remaster:false } }, // AUTO-REMASTER DISABLED
  { id:'VOCAL', label:'Vocal / Acoustic', icon:'🎤', description:'Center-heavy · Lead vocals protected',
    settings:{ drive:0.4, widen:1.10, spatial:0.05, reverb:0.04, compress:true, remaster:false } },
  { id:'ELECTRONIC', label:'Electronic / EDM', icon:'⚡', description:'Brickwall master · Exciter restores air',
    settings:{ drive:1.4, widen:1.25, spatial:0.08, reverb:0.04, compress:true, remaster:false } },
  { id:'HIPHOP', label:'Hip-Hop / R&B', icon:'🎧', description:'Punchy · Tight dynamics',
    settings:{ drive:1.0, widen:1.15, spatial:0.06, reverb:0.03, compress:true, remaster:false } }, // AUTO-REMASTER DISABLED
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
      
      // CRITICAL FIX: Changed 'c' to 'canvas'
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      
      if (ctx) {
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } else resolve(null);
      
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
};

function classifyAudio(sc:number, cf:number, zcr:number, rms:number): AudioProfile {
  if (cf>18 && rms<0.08)             return PROFILES[5];
  if (cf>14 && sc>0.70 && zcr<0.08)  return PROFILES[0];
  if (sc>0.88 && cf>10 && zcr<0.05)  return PROFILES[1];
  if (sc>0.80 && cf>10)              return PROFILES[2];
  if (cf<8   && zcr>0.12)            return PROFILES[3];
  if (cf<11  && rms>0.18)            return PROFILES[4];
  return PROFILES[6];
}

function applyTaste(base:DSPSettings, taste:Taste): DSPSettings {
  const s = {...base};
  if (taste==='QUALITY') {
    // HD CLEAR: Laser-focused vocals, tight close-surround, pristine clarity.
    s.drive = base.drive * 0.35;    // Cut exciter distortion so vocals stay pure
    s.widen = 1.08;                 // Very tight "close surround" width
    s.spatial = 0.0;                // Zero roaming 3D phase-shifting
    s.reverb = 0.01;                // Barely 1% algorithmic reverb for natural air
    s.compress = true;
    s.remaster = base.remaster;
  } else if (taste==='IMMERSIVE') {
    // IMMERSIVE: Deep, wide, roaming 3D effects.
    s.drive = Math.min(2.0, base.drive + 0.15); 
    s.widen = Math.min(1.5, base.widen + 0.20); 
    s.spatial = Math.max(0.25, base.spatial + 0.15); // Force 3D depth ON
    s.reverb = Math.max(0.12, base.reverb + 0.08);   // Push room size up
    s.compress = true;
    s.remaster = base.remaster;
  } else if (taste==='CHILL') {
    // CHILL: Low energy, distant.
    s.drive = base.drive * 0.2; 
    s.widen = 1.0;
    s.spatial = Math.min(0.30, base.spatial + 0.10); 
    s.reverb = Math.min(0.30, base.reverb + 0.12);
    s.compress = false;
    s.remaster = base.remaster;
  }
  return s;
}

const fac = new FastAverageColor();
const FIR_GAINS: Record<string, [number,number,number]> = {
  CLASSICAL:[1.20,0.82,1.50], BOLLYWOOD:[1.55,0.72,1.20], VOCAL:[1.10,0.68,1.45],
  ELECTRONIC:[1.70,0.75,1.55], HIPHOP:[1.65,0.78,1.25], AMBIENT:[1.00,0.90,1.60],
  POP:[1.40,0.80,1.40], DEFAULT:[1.50,0.79,1.33],
};
const isHexDark = (hex:string) => {
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16),g=parseInt(h.substring(2,4),16),b=parseInt(h.substring(4,6),16);
  return ((r*299)+(g*587)+(b*114))/1000 < 145;
};
const trackAccentColor = (name:string): string => {
  let h=0; for (const c of name) h=(h<<5)-h+c.charCodeAt(0);
  return ['#c8222a','#1565c0','#2e7d32','#e65100','#6a1b9a','#00838f','#c62828','#4527a0'][Math.abs(h)%8];
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
  const lines:LyricLine[]=[]; const re=/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/;
  for (const line of text.split('\n')){const m=re.exec(line);if(m){const txt=line.replace(/\[.*?\]/g,'').trim();if(txt)lines.push({time:parseInt(m[1])*60+parseFloat(m[2]),text:txt});}}
  return lines.sort((a,b)=>a.time-b.time);
};

// ─────────────────────────────────────────────────────────────────────────────
// TRACK ROW — memo so it only re-renders when its own props change.
// Receives `isFav: boolean` (pre-computed by parent from a Set) so it never
// does its own O(n) array lookup. `top` is a primitive number — safe for memo.
// ─────────────────────────────────────────────────────────────────────────────
// Paste this OUTSIDE and ABOVE the main App() function

const TrackRow = memo(({ track, isActive, albumArt, isFav, onPlay, formatTime, onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, isSelectionMode, isSelected, onToggleSelect, top, onLongPress }: {
  track: Track; isActive: boolean; albumArt: string | null;
  isFav: boolean; onPlay: (t: Track) => void; formatTime: (s:number)=>string;
  onAddToPlaylist: (t: Track) => void; onRemoveFromPlaylist: (t: Track) => void;
  activePlaylistId: string | null; isSelectionMode: boolean; isSelected: boolean;
  onToggleSelect: (path: string) => void; top: number; onLongPress?: (path: string) => void;
}) => {
  const profileData = PROFILES.find(p => p.id === track.profile);
  
  // NEW: Android Long-Press Engine
  const timerRef = useRef<number | null>(null);
  const handleTouchStart = () => {
    if (IS_ANDROID && !isSelectionMode && onLongPress) {
      timerRef.current = window.setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(50); // Haptic feedback snap
        onLongPress(track.path);
      }, 600); // 600ms hold to trigger
    }
  };
  const cancelTouch = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  return (
    <li className={`track-item ${isActive ? 'active' : ''} ${isSelected ? 'selected-row' : ''}`}
      style={{ position: 'absolute', top, left: 0, right: 0, height: ITEM_HEIGHT, '--track-color': trackAccentColor(track.name), ...(IS_ANDROID ? { transform: 'translateZ(0)', willChange: 'transform' } : {}) } as React.CSSProperties}
      onClick={() => { if (isSelectionMode) onToggleSelect(track.path); else onPlay(track); }}
      onTouchStart={handleTouchStart} onTouchEnd={cancelTouch} onTouchMove={cancelTouch} onTouchCancel={cancelTouch}>
      <div className="track-cell title-cell">
        {isSelectionMode && <input type="checkbox" checked={isSelected} readOnly style={{ marginRight: '10px', transform: 'scale(1.2)', accentColor: 'var(--theme-color)' }} />}
        <div className="track-item-icon">
          {isActive && albumArt ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
            : track.thumb ? <div className="track-thumb-art" style={{ backgroundImage:`url(${track.thumb})` }} />
            : <span>{profileData?.icon ?? '🎵'}</span>}
        </div>
        <div className="track-item-details">
          <span className="track-item-name">{isFav && <span className="fav-dot">♥ </span>}{track.name}</span>
          <span className="track-item-artist">{track.artist}{track.profile && <span className="track-profile-icon">{profileData?.icon}</span>}</span>
        </div>
      </div>
      <div className="track-cell hide-mobile">{track.album}</div>
      <div className="track-cell hide-mobile">{track.year}</div>
      <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
      <div className="track-cell time-cell" style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'12px' }}>
        {activePlaylistId
          ? <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,fontSize:15,background:'transparent',border:'none',opacity:0.8,color:'#ff4444' }} onClick={e=>{e.stopPropagation();onRemoveFromPlaylist(track);}}>✕</button>
          : <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,fontSize:14,background:'transparent',border:'none',opacity:0.6 }} onClick={e=>{e.stopPropagation();onAddToPlaylist(track);}}>+</button>}
        {track.duration ? formatTime(track.duration) : '--:--'}
      </div>
    </li>
  );
});
const ITEM_HEIGHT = 72;
// CHANGE: Reduced OVERSCAN from 8 → 3.
// OVERSCAN=8 renders 8 invisible items above AND below the viewport = 1152px of
// hidden DOM per render. On Android that is ~2 screen-heights of wasted paint.
// OVERSCAN=3 (216px each side) prevents blank-row flash on fast scroll while
// cutting hidden DOM work by 62%.
const OVERSCAN = 3;

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL LIST
// CHANGE: `favorites` prop replaced with `favoritesSet: Set<string>`.
// favorites.includes(path) inside TrackRow = O(n) per visible row per render.
// With 1800 tracks / 50 favorites = 90,000 string comparisons per render.
// Set.has(path) = O(1). At 15 visible rows: 15 hash lookups instead of 750.
// The memo comparator checks Set identity (===), same guarantee as before.
// ─────────────────────────────────────────────────────────────────────────────
const VirtualList = memo(({ tracks, currentTrackPath, albumArt, favoritesSet, onPlay, formatTime, onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, isSelectionMode, selectedTracks, onToggleSelect, onLongPress }: {
  tracks: Track[]; currentTrackPath: string | undefined; albumArt: string | null;
  favoritesSet: Set<string>;
  onPlay: (track: Track) => void; formatTime: (s: number) => string;
  onAddToPlaylist: (track: Track) => void; onRemoveFromPlaylist: (track: Track) => void;
  activePlaylistId: string | null; isSelectionMode: boolean;
  selectedTracks: Set<string>; onToggleSelect: (path: string) => void;
  onLongPress: (path: string) => void; // <--- ADD THIS
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(entries => setViewHeight(entries[0].contentRect.height));
    ro.observe(el); setViewHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const totalHeight   = tracks.length * ITEM_HEIGHT;
  const startIdx      = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIdx        = Math.min(tracks.length, Math.ceil((scrollTop + viewHeight) / ITEM_HEIGHT) + OVERSCAN);
  const visibleTracks = tracks.slice(startIdx, endIdx);
  const handleScroll  = useCallback((e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  return (
    <div ref={containerRef} className="virtual-scroll-container" onScroll={handleScroll}>
      <ul className="track-list" style={{ height: totalHeight, position: 'relative' }}>
       {visibleTracks.map((track, i) => (
          <TrackRow key={track.path} track={track}
            isActive={currentTrackPath === track.path} albumArt={albumArt}
            isFav={favoritesSet.has(track.path)}
            onPlay={onPlay} formatTime={formatTime}
            onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={onRemoveFromPlaylist}
            activePlaylistId={activePlaylistId} isSelectionMode={isSelectionMode}
            isSelected={selectedTracks.has(track.path)} onToggleSelect={onToggleSelect}
            top={(startIdx + i) * ITEM_HEIGHT} 
            onLongPress={onLongPress} // <--- ADD THIS
          />
        ))}
      </ul>
    </div>
  );
// CHANGE: Comparator updated to use favoritesSet instead of favorites.
// This blocks the 250ms metrics poll from re-rendering the list — the poll
// calls setCurrentTime/setAudioLevel which propagate to App but none of
// these props change, so the list stays frozen between user interactions.
}, (prev, next) =>
  prev.tracks === next.tracks &&
  prev.currentTrackPath === next.currentTrackPath &&
  prev.albumArt === next.albumArt &&
  prev.favoritesSet === next.favoritesSet &&
  prev.activePlaylistId === next.activePlaylistId &&
  prev.isSelectionMode === next.isSelectionMode &&
  prev.selectedTracks === next.selectedTracks
);

const DraggablePlaylistView = memo(({ tracks, currentTrackPath, albumArt, onPlay, formatTime, onRemove, onReorder, isSelectionMode, selectedTracks, onToggleSelect }: {
  tracks: Track[]; currentTrackPath: string | undefined; albumArt: string | null;
  onPlay: (t: Track) => void; formatTime: (s: number) => string;
  onRemove: (t: Track) => void; onReorder: (from: Track, to: Track) => void;
  isSelectionMode: boolean; selectedTracks: Set<string>; onToggleSelect: (path: string) => void;
}) => {
  const dragState = useRef<{ active:boolean; fromTrack:Track|null; startY:number; startScrollTop:number; ghost:HTMLDivElement|null; }>({ active:false, fromTrack:null, startY:0, startScrollTop:0, ghost:null });
  const [dragOverPath, setDragOverPath] = useState<string|null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollInterval = useRef<number|null>(null);
  useEffect(() => () => { if (dragState.current.ghost) dragState.current.ghost.remove(); }, []);

  const startDrag = (e: React.PointerEvent, track: Track) => {
    if (isSelectionMode) return;
    const handle = (e.target as HTMLElement).closest('.drag-handle'); if (!handle) return;
    e.preventDefault(); e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className='drag-ghost'; ghost.textContent=track.name;
    Object.assign(ghost.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,opacity:'0.85',zIndex:'9999',pointerEvents:'none',background:'var(--bg-raised)',borderRadius:'8px',padding:'12px',boxShadow:'0 8px 20px rgba(0,0,0,0.3)'});
    document.body.appendChild(ghost);
    dragState.current = { active:true, fromTrack:track, startY:e.clientY, startScrollTop:containerRef.current?.scrollTop||0, ghost };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragState.current.active) return;
    const ghost = dragState.current.ghost;
    if (ghost) ghost.style.transform = `translateY(${e.clientY - dragState.current.startY}px)`;
    const li = (document.elementsFromPoint(e.clientX, e.clientY)[0] as Element).closest('.track-item');
    const targetPath = li?.getAttribute('data-path');
    setDragOverPath(targetPath && targetPath !== dragState.current.fromTrack?.path ? targetPath : null);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect(); const speed = 15;
      if (e.clientY < rect.top+80) { if (!scrollInterval.current) scrollInterval.current=window.setInterval(()=>container.scrollTop-=speed,16); }
      else if (e.clientY > rect.bottom-80) { if (!scrollInterval.current) scrollInterval.current=window.setInterval(()=>container.scrollTop+=speed,16); }
      else { if (scrollInterval.current){clearInterval(scrollInterval.current);scrollInterval.current=null;} }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragState.current.active) return;
    const fromTrack = dragState.current.fromTrack;
    const toPath = (document.elementsFromPoint(e.clientX, e.clientY)[0] as Element)?.closest('.track-item')?.getAttribute('data-path');
    const toTrack = tracks.find(t => t.path === toPath);
    if (fromTrack && toTrack && fromTrack !== toTrack) onReorder(fromTrack, toTrack);
    if (dragState.current.ghost) dragState.current.ghost.remove();
    if (scrollInterval.current) clearInterval(scrollInterval.current);
    dragState.current = { active:false, fromTrack:null, startY:0, startScrollTop:0, ghost:null };
    setDragOverPath(null);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  return (
    <div ref={containerRef} className="virtual-scroll-container" style={{ overflowY:'auto', maxHeight:'calc(100vh - 200px)' }}>
      <ul className="track-list" style={{ height:'auto', position:'relative' }}>
        {tracks.map((track, index) => {
          const profileData = PROFILES.find(p => p.id === track.profile);
          return (
            <li key={track.path+index} data-path={track.path}
              className={`track-item ${currentTrackPath===track.path?'active':''} ${dragOverPath===track.path?'playlist-drag-over':''} ${selectedTracks.has(track.path)?'selected-row':''}`}
              style={{'--track-color':trackAccentColor(track.name),position:'relative',height:ITEM_HEIGHT,userSelect:'none'} as React.CSSProperties}
              onClick={()=>{ if(isSelectionMode) onToggleSelect(track.path); else onPlay(track); }}>
              <div className="track-cell title-cell">
                {isSelectionMode
                  ? <input type="checkbox" checked={selectedTracks.has(track.path)} readOnly style={{ marginRight:'10px',transform:'scale(1.2)',accentColor:'var(--theme-color)' }} />
                  : <span className="drag-handle" style={{ cursor:'grab',paddingRight:'12px',paddingLeft:'4px',touchAction:'none' }} onPointerDown={e=>startDrag(e,track)}>⠿</span>}
                <div className="track-item-icon">
                  {currentTrackPath===track.path && albumArt ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
                    : track.thumb ? <div className="track-thumb-art" style={{ backgroundImage:`url(${track.thumb})` }} />
                    : <span>{profileData?.icon ?? '🎵'}</span>}
                </div>
                <div className="track-item-details">
                  <span className="track-item-name">{track.name}</span>
                  <span className="track-item-artist">{track.artist}{track.profile && <span className="track-profile-icon">{profileData?.icon}</span>}</span>
                </div>
              </div>
              <div className="track-cell hide-mobile">{track.album}</div>
              <div className="track-cell hide-mobile">{track.year}</div>
              <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
              <div className="track-cell time-cell" style={{ display:'flex',alignItems:'center',justifyContent:'flex-end',gap:12 }}>
                {!isSelectionMode && <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,fontSize:15,background:'transparent',border:'none',opacity:0.7,color:'#ff5555' }} onClick={e=>{e.stopPropagation();onRemove(track);}}>✕</button>}
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
    { label:'🎵 Music', path:'/storage/emulated/0/Music' },
    { label:'⬇️ Downloads', path:'/storage/emulated/0/Download' },
    { label:'📁 Downloads (alt)', path:'/storage/emulated/0/Downloads' },
    { label:'📱 Internal Storage', path:'/storage/emulated/0' },
    { label:'💾 SD Card', path:'/storage/sdcard1/Music' },
    { label:'🗂️ SD Card Root', path:'/storage/sdcard1' },
  ];
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" onClick={e=>e.stopPropagation()}>
        <div className="folder-modal-header"><h2>Choose Music Folder</h2><button className="folder-modal-close" onClick={onClose}>×</button></div>
        <p className="folder-modal-hint">Tap a folder to scan it. All audio files inside will be added to your library.</p>
        <div className="folder-modal-list">
          {commonFolders.map(f=>(
            <button key={f.path} className="folder-modal-item" onClick={()=>{onScan(f.path);onClose();}}>
              <span className="folder-modal-icon">{f.label.split(' ')[0]}</span>
              <div><div className="folder-modal-name">{f.label.slice(f.label.indexOf(' ')+1)}</div><div className="folder-modal-path">{f.path}</div></div>
            </button>
          ))}
        </div>
        <div className="folder-modal-footer">
          <button className="folder-modal-scan-all" onClick={()=>{onScan('ALL');onClose();}}>📂 Scan All Common Folders</button>
        </div>
      </div>
    </div>
  );
});

const PlaylistPopup = memo(({ playlists, onClose, onCreate, onAdd, newPlaylistName, setNewPlaylistName }: {
  playlists: CustomPlaylist[]; onClose: () => void; onCreate: (e: React.FormEvent) => void;
  onAdd: (id: string) => void; newPlaylistName: string; setNewPlaylistName: (v: string) => void;
}) => {
  const canClose = useRef(false);
  useEffect(() => { const t = setTimeout(() => { canClose.current = true; }, 220); return () => clearTimeout(t); }, []);
  return (
    <div className="playlist-popup-overlay" onPointerDown={()=>{ if(canClose.current) onClose(); }}>
      <div className="playlist-popup-glass" onPointerDown={e=>e.stopPropagation()}>
        <div className="glass-menu-header">Add to Playlist</div>
        <div className="playlist-popup-list">
          {playlists.length===0
            ? <p className="playlist-popup-empty">No playlists yet — create one below.</p>
            : playlists.map(pl=>(
                <button key={pl.id} className="playlist-popup-item" onPointerDown={e=>e.stopPropagation()} onClick={()=>onAdd(pl.id)}>
                  <span className="playlist-popup-item-icon">📑</span>
                  <div className="playlist-popup-item-info"><span className="playlist-popup-item-name">{pl.name}</span><span className="playlist-popup-item-count">{pl.trackPaths.length} tracks</span></div>
                  <span className="playlist-popup-item-add">＋</span>
                </button>
              ))}
        </div>
        <div className="playlist-popup-divider" />
        <form onSubmit={onCreate} className="playlist-popup-form">
          <input autoFocus className="playlist-popup-input" placeholder="New playlist name…" value={newPlaylistName} onChange={e=>setNewPlaylistName(e.target.value)} onPointerDown={e=>e.stopPropagation()} />
          <button type="submit" className="playlist-popup-create-btn" onPointerDown={e=>e.stopPropagation()}>Create</button>
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

  const bassRef    = useRef<HTMLDivElement>(null);
  const midLRef    = useRef<HTMLDivElement>(null);
  const midRRef    = useRef<HTMLDivElement>(null);
  const trebLRef   = useRef<HTMLDivElement>(null);
  const trebRRef   = useRef<HTMLDivElement>(null);
  const otherLRef  = useRef<HTMLDivElement>(null);
  const otherRRef  = useRef<HTMLDivElement>(null);
  const spatialData    = useRef({ bLvl:0,bPan:0,mLvl:0,mPan:0,mPhs:1,tLvl:0,tPan:0,tPhs:1 });
  const audioLevelRef  = useRef(0);
  const lastReactUpdate = useRef(0);
  const cornerTLRef = useRef<HTMLDivElement>(null);
  const cornerBRRef = useRef<HTMLDivElement>(null);
  const cornerTRRef = useRef<HTMLDivElement>(null);
  const cornerBLRef = useRef<HTMLDivElement>(null);
  const blob5Ref = useRef<HTMLDivElement>(null);
  const blob6Ref = useRef<HTMLDivElement>(null);
  const blob7Ref = useRef<HTMLDivElement>(null);
  const blob8Ref = useRef<HTMLDivElement>(null);
  const ripple1Ref = useRef<HTMLDivElement>(null);
  const ripple2Ref = useRef<HTMLDivElement>(null);
  const ripple3Ref = useRef<HTMLDivElement>(null);

  const isTransitioningRef = useRef(false);


  const rippleState = useRef([
    { active:false, scale:0, opacity:0 },
    { active:false, scale:0, opacity:0 },
    { active:false, scale:0, opacity:0 }
  ]);
  const lastRippleTime  = useRef(0);
  const rippleThreshold = useRef(0.55);
  const lastBassLevel   = useRef(0);
  const dustThreshold   = useRef(0.05);
  const lastTrebleLevel = useRef(0);
  const dustCanvasRef   = useRef<HTMLCanvasElement>(null);
  const artifactRefs    = useRef<(HTMLDivElement|null)[]>([]);
  const artifactState   = useRef([...Array(6)].map(()=>({ active:false,x:0,y:0,scale:0,opacity:0 })));

  // CHANGE: DUST_COUNT fenced per platform.
  // 500 particles at 60fps on Android consumes ~35% of the rAF budget on a
  // 90k AnTuTu device. 80 particles at 30fps uses equivalent GPU/CPU time
  // while freeing the compositor for scroll, touch, and CSS transitions.
  const DUST_COUNT = IS_ANDROID ? 0 : 500;

  const blobState = useRef([
    { px:Math.random()*10, py:Math.random()*10, sx:0.00015, sy:0.00011 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00012, sy:0.00016 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00017, sy:0.00013 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00014, sy:0.00018 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00011, sy:0.00014 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00016, sy:0.00012 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00013, sy:0.00017 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.00018, sy:0.00015 },
  ]);
  const dustState = useRef([...Array(DUST_COUNT)].map(()=>({ active:false,x:0,y:0,vx:0,vy:0,scale:0,opacity:0,isLeft:true })));

  useEffect(() => {
    const resize = () => { if (dustCanvasRef.current) { dustCanvasRef.current.width=window.innerWidth; dustCanvasRef.current.height=window.innerHeight; } };
    window.addEventListener('resize', resize); resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  const REVERB_ENVIRONMENTS = [
    { id:'NONE', label:'Off', path:'' },
    { id:'DTSXHeadphonewide', label:'DTS:X Headphone Wide', path:'resources/impulses/DTSXHeadphonewide.wav' },
    { id:'SennheiserHD', label:'Sennheiser HD', path:'resources/impulses/SennheiserHD.wav' },
    { id:'Head360', label:'Head-360', path:'resources/impulses/Head360.wav' },
    { id:'XHRQSurround', label:'XHR-QSurround', path:'resources/impulses/XHRQSurround.wav' },
    { id:'xiaomipiston2', label:'Xiaomi Piston 2', path:'resources/impulses/xiaomipiston2.wav' },
    { id:'XHRStudioSurround', label:'XHR Studio Surround', path:'resources/impulses/XHRStudioSurround.wav' },
    { id:'dolbybassboost', label:'Dolby Bass Boost', path:'resources/impulses/dolbybassboost.wav' },
    { id:'dolbydimension', label:'Dolby Dimension', path:'resources/impulses/dolbydimension.wav' },
    { id:'OppoPM3', label:'Oppo PM3', path:'resources/impulses/OppoPM3.wav' },
    { id:'HyperXCloudalpha', label:'HyperX Cloud Alpha', path:'resources/impulses/HyperXCloudalpha.wav' },
    { id:'AppleEarPods', label:'Apple EarPods', path:'resources/impulses/AppleEarPods.wav' },
    { id:'AppleAirPods', label:'Apple AirPods', path:'resources/impulses/AppleAirPods.wav' },
    { id:'AKGK240', label:'AKG K240', path:'resources/impulses/AKGK240.wav' },
    { id:'SteelSeriesArctic9X', label:'SteelSeries Arctic 9X', path:'resources/impulses/SteelSeriesArctic9X.wav' },
    { id:'dolbyatmos', label:'Dolby Atmos', path:'resources/impulses/dolbyheadR.wav|resources/impulses/dolbyheadL.wav' },
    { id:'dolbyvirtualspeaker', label:'Dolby Virtual', path:'resources/impulses/dolbyvirtualspeakerL.wav|resources/impulses/dolbyvirtualspeakerR.wav' },
    { id:'Sony_WH1000XM2', label:'Sony WH1000XM2L', path:'resources/impulses/Sony_WH1000XM2L.wav|resources/impulses/Sony_WH1000XM2R.wav' },
    { id:'AKGK701', label:'AKG K701', path:'resources/impulses/AKGK701L.wav|resources/impulses/AKGK701R.wav' },
  ];

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

  // CHANGE: useMemo depends on debouncedSearchQuery instead of searchQuery.
  // This prevents the 1800-item filter from re-running on every keystroke.
  // Also: favorites.includes() was removed — filtering by favorites now uses
  // the favorites array directly in useMemo (cheap reference check) and the
  // O(1) favoritesSet is used inside VirtualList's TrackRow render below.
  const displayedTracks = useMemo(() => {
    let base = playlist;
    if (currentView==='FAVORITES') {
      base = playlist.filter(t => favorites.includes(t.path));
    } else if (currentView==='BOLLYWOOD') {
      base = playlist.filter(t => {
        const s = `${t.genre||''} ${t.album||''} ${t.path}`.toLowerCase();
        return s.includes('bollywood') || s.includes('hindi') || s.includes('indian');
      });
    } else if (currentView==='TOPTRACKS') {
      base = [...playlist].filter(t=>(t.playCount||0)>0).sort((a,b)=>(b.playCount||0)-(a.playCount||0)).slice(0,50);
    } else if (activePlaylistId) {
      const pl = customPlaylists.find(p=>p.id===activePlaylistId);
      if (pl) base = pl.trackPaths.map(path=>playlist.find(t=>t.path===path)).filter((t):t is Track=>t!==undefined);
    }
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      base = base.filter(t => String(t?.name||'').toLowerCase().includes(q) || String(t?.artist||'').toLowerCase().includes(q) || String(t?.album||'').toLowerCase().includes(q));
    }

    // CRITICAL FIX: The Dynamic Sorter
    // Don't accidentally auto-sort custom playlists or the Top Tracks view
    if (currentView === 'TOPTRACKS' || activePlaylistId) return base;

    // We MUST copy the array [...base] because .sort() mutates the original array, which causes React to panic.
    return [...base].sort((a, b) => {
      if (sortMode === 'TITLE') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sortMode === 'ARTIST') return String(a.artist || 'Unknown').localeCompare(String(b.artist || 'Unknown'));
      if (sortMode === 'ALBUM') return String(a.album || 'Unknown').localeCompare(String(b.album || 'Unknown'));
      if (sortMode === 'YEAR') {
        const yA = parseInt(a.year || '0') || 0;
        const yB = parseInt(b.year || '0') || 0;
        return yB - yA; // Sorts Newest to Oldest
      }
      return 0;
    });
  }, [playlist, currentView, favorites, activePlaylistId, customPlaylists, debouncedSearchQuery, sortMode]);



  // CHANGE: favorites → Set<string>, memoized.
  // Passed to VirtualList so TrackRow lookups are O(1) not O(n).
  // The Set is recreated only when the favorites array changes reference.
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  const stateRefs = useRef({ displayedTracks, currentTrack });
  useEffect(() => { stateRefs.current = { displayedTracks, currentTrack }; }, [displayedTracks, currentTrack]);

  const writeToEngine = useCallback(async (cmd:string) => {
    try { await invoke('audio_command', { cmd: cmd.trim() }); } catch (_) {}
  }, []);

  useEffect(() => {
    async function boot() {
      // 1. INSTANT UI FEEDBACK
      // Tell React we are busy immediately so it shows the loading text.
      setIsLoading(true);
      setScanProgress('Waking up database...');

      // 2. THE BREATHER (The Black Screen Killer)
      // This forces the JavaScript engine to pause for exactly 100ms.
      // This gives the Android WebView enough time to actually paint the UI 
      // on the screen BEFORE the main thread gets locked up by the database payload.
      await new Promise(resolve => setTimeout(resolve, 100));

      // 3. LOAD SQLITE TRACKS FIRST (Independent of JSON)
      try {
        const saved = await invoke<Track[]>('fetch_library');
        console.log("SQLite Boot: Fetched", saved?.length || 0, "tracks");
        if (saved && saved.length > 0) {
          playlistRef.current = saved;
          setPlaylist(saved);
          setFavorites(saved.filter(t => t.isFavorite).map(t => t.path)); // Hydrate favorites
        }
      } catch (err) { 
        console.error("CRITICAL: SQLite fetch_library failed in Rust:", err); 
      }

      // 4. LOAD SQLITE PLAYLISTS
      try {
        const savedPlaylists = await invoke<CustomPlaylist[]>('get_playlists');
        if (savedPlaylists) setCustomPlaylists(savedPlaylists);
      } catch (err) {
        console.error("CRITICAL: SQLite get_playlists failed:", err);
      }

      // 5. LOAD LEGACY UI PREFERENCES
      try {
        const store = await load("library.json", { autoSave: true, defaults: {} });
        dbProcess.current = store;
        const savedDark = await store.get<boolean>("isDarkMode");
        if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
      } catch (err) { 
        console.error("Non-critical: Failed to load legacy library.json:", err); 
      }

      // Clear the loading state
      setIsLoading(false);
      setScanProgress('');
    }
    
    boot();
  }, []);
  // CHANGE: Android drip-feed chunk batching.
  // Previously every chunk of 50 tracks triggered an immediate setPlaylist(),
  // causing 36 rapid-fire React re-renders (1800/50) during a full scan.
  // Each render fires before the previous one finished, creating a render
  // storm that blocked the UI thread for several seconds.
  //
  // Fix: buffer incoming chunks in a ref, flush to React state every 200ms
  // via setInterval in a single batched setState call. This reduces 36 state
  // updates to ~1–2 during the entire scan, eliminating the storm.
  useEffect(() => {
    const pending = { chunks: [] as any[] };

    const unlistenChunk = listen('metadata_chunk', (event) => {
      pending.chunks.push(...(event.payload as any[]));
      setScanProgress('Loading chunks from background scanner...');
    });

    const flushInterval = setInterval(() => {
      if (pending.chunks.length === 0) return;
      const batch = pending.chunks.splice(0);
      setPlaylist(prev => {
        const existingPaths = new Set(prev.map(t=>t.path));
        const fresh: Track[] = batch
          .map((c:any):Track => ({ name:c.title||'Unknown Title', path:c.file_path, artist:c.artist||'Unknown Artist', album:'Unknown Album', year:'-', quality:'-', duration:0, metadataLoaded:false, thumb:c.art_uri?convertFileSrc(c.art_uri):undefined }))
          .filter(t => !existingPaths.has(t.path));
        const merged = [...prev, ...fresh].sort((a,b) => {
          const A = String(a?.name||'Unknown').toUpperCase(), B = String(b?.name||'Unknown').toUpperCase();
          return A<B?-1:A>B?1:0;
        });
        playlistRef.current = merged;
        return merged;
      });
    }, 200);

    const unlistenComplete = listen('scan_complete', () => {
      if (pending.chunks.length > 0) {
        const batch = pending.chunks.splice(0);
        setPlaylist(prev => {
          const existingPaths = new Set(prev.map(t=>t.path));
          const fresh: Track[] = batch
            .map((c:any):Track => ({ name:c.title||'Unknown Title', path:c.file_path, artist:c.artist||'Unknown Artist', album:'Unknown Album', year:'-', quality:'-', duration:0, metadataLoaded:false, thumb:c.art_uri?convertFileSrc(c.art_uri):undefined }))
            .filter(t => !existingPaths.has(t.path));
          const merged = [...prev, ...fresh].sort((a,b)=>{ const A=String(a?.name||'Unknown').toUpperCase(),B=String(b?.name||'Unknown').toUpperCase(); return A<B?-1:A>B?1:0; });
          playlistRef.current = merged;
          return merged;
        });
      }
      clearInterval(flushInterval);
      setIsLoading(false);
      setScanProgress('');
    });

    return () => {
      clearInterval(flushInterval);
      unlistenChunk.then(f=>f());
      unlistenComplete.then(f=>f());
    };
  }, []);



  const visModeRef = useRef<'ORBIT'|'RADAR'>('ORBIT');
  useEffect(() => { visModeRef.current = visMode; }, [visMode]);

  useEffect(() => {
    const rBx={v:0},rBs={v:0},rMx={v:0},rMw={v:0},rMs={v:0},rTx={v:0},rTw={v:0},rTs={v:0},rOx={v:0},rOw={v:0},rOs={v:0};
    const glowSpriteDark  = document.createElement('canvas'); glowSpriteDark.width=64;  glowSpriteDark.height=64;
    const glowSpriteLight = document.createElement('canvas'); glowSpriteLight.width=64; glowSpriteLight.height=64;
    let lastSpriteColor = '';

    // CHANGE: rAF throttled to 30fps on Android (60fps on desktop).
    // The visualizer is CPU-bound (JS lerp math + canvas sprite blitting).
    // Halving to 30fps saves ~5ms JS per frame on a 90k AnTuTu device —
    // the difference between smooth scroll at 60fps and jank at ~45fps.
    // Desktop behaviour is unchanged.
    // const TARGET_FPS = IS_ANDROID ? 60 : 60;
    // const FRAME_MS   = 1000 / TARGET_FPS;

    // let lastFrameTime = 0;

    let rafId: number;
    const tick = (timestamp: number) => {
  // 1. Deep sleep check: If the player is minimized, do zero work.
  if (IS_ANDROID && !isExpandedRef.current) { 
    rafId = requestAnimationFrame(tick); 
    return; 
  }

  // 2. Continuous Time Source
  const now = timestamp * 0.001; // Seconds for smooth trig math
  const wallTime = Date.now();   // Milliseconds for interval checks (ripples/dust)
  

  const lvl = audioLevelRef.current;
  const speedMult = IS_ANDROID ? 3.5 : 1.0;
  const activeLvl = IS_ANDROID ? 0 : lvl; 

  // 3. THE GLOBAL WANDERER (8B Engine)
  // This runs regardless of mode so the background never freezes.
  const cRefs = [cornerTLRef, cornerBRRef, cornerTRRef, cornerBLRef, blob5Ref, blob6Ref, blob7Ref, blob8Ref];
  blobState.current.forEach((b, i) => {
    // We use the 'now' (seconds) variable here for buttery smooth movement
    const x = Math.sin(now * (b.sx * speedMult) + b.px) * 15 + Math.sin(now * (b.sx * 0.8 * speedMult) + b.py) * 8;
    const y = Math.cos(now * (b.sy * speedMult) + b.py) * 15 + Math.cos(now * (b.sy * 0.7 * speedMult) + b.px) * 8;
    
    if (cRefs[i].current) {
      cRefs[i].current!.style.transform = `translate(${x}vw, ${y}vh) scale(${1.0 + activeLvl * 0.15}) translateZ(0)`;
    }
  });

  // 4. Mode-Specific Heavy Visuals
  // We completely block this entire block on Android to maintain 60fps.
  if (!IS_ANDROID && visModeRef.current === 'RADAR') {
    const d = spatialData.current;
    const lerp = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k;
    const K_fast = 0.15, K_slow = 0.035;

    // Sprite Generation for Canvas
    if (themeColorRef.current !== lastSpriteColor) {
      lastSpriteColor = themeColorRef.current;
      const dCtx = glowSpriteDark.getContext('2d');
      if (dCtx) { dCtx.clearRect(0, 0, 64, 64); dCtx.shadowBlur = 16; dCtx.shadowColor = lastSpriteColor; dCtx.fillStyle = '#ffffff'; dCtx.beginPath(); dCtx.arc(32, 32, 5, 0, Math.PI * 2); dCtx.fill(); dCtx.shadowBlur = 0; }
      const lCtx = glowSpriteLight.getContext('2d');
      if (lCtx) { lCtx.clearRect(0, 0, 64, 64); lCtx.shadowBlur = 12; lCtx.shadowColor = 'rgba(0,0,0,0.2)'; lCtx.fillStyle = lastSpriteColor; lCtx.beginPath(); lCtx.arc(32, 32, 5, 0, Math.PI * 2); lCtx.fill(); lCtx.shadowBlur = 0; }
    }

    // Bass Center & Ripples
    rBx.v = lerp(rBx.v, d.bPan * 3, K_fast); rBs.v = lerp(rBs.v, d.bLvl, K_fast);
    if (bassRef.current) bassRef.current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${1.0 + rBs.v * 0.8})`;

    rippleThreshold.current = Math.max(0.12, rippleThreshold.current - 0.001);
    const isSpike = d.bLvl > rippleThreshold.current && (d.bLvl - lastBassLevel.current) > 0.035;
    
    // Using wallTime (ms) for the 350ms throttle
    if (isSpike && wallTime - lastRippleTime.current > 350) {
      const r = rippleState.current.find(r => !r.active);
      if (r) { r.active = true; r.scale = 0.5; r.opacity = 1.0; lastRippleTime.current = wallTime; rippleThreshold.current = Math.min(0.8, d.bLvl + 0.15); }
    }
    lastBassLevel.current = d.bLvl;

    [ripple1Ref, ripple2Ref, ripple3Ref].forEach((ref, idx) => {
      const rip = rippleState.current[idx];
      if (rip.active) {
        rip.scale += 0.06; rip.opacity -= 0.006;
        if (rip.opacity <= 0) { rip.active = false; rip.opacity = 0; }
        if (ref.current) {
          ref.current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${rip.scale})`;
          ref.current.style.opacity = `${rip.opacity}`;
        }
      }
    });

    // Mids & Treble Arcs
    rMx.v = lerp(rMx.v, d.mPan * 12, K_slow); rMw.v = lerp(rMw.v, Math.max(0, (1.0 - d.mPhs)) * 8 + 6, K_slow); rMs.v = lerp(rMs.v, d.mLvl, K_slow);
    if (midLRef.current) midLRef.current.style.transform = `translate(calc(-50% + ${rMx.v - rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;
    if (midRRef.current) midRRef.current.style.transform = `translate(calc(-50% + ${rMx.v + rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;

    rTx.v = lerp(rTx.v, d.tPan * 25, K_slow); rTw.v = lerp(rTw.v, Math.max(0, (1.0 - d.tPhs)) * 14 + 15, K_slow); rTs.v = lerp(rTs.v, d.tLvl, K_slow);
    if (trebLRef.current) trebLRef.current.style.transform = `translate(calc(-50% + ${rTx.v - rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;
    if (trebRRef.current) trebRRef.current.style.transform = `translate(calc(-50% + ${rTx.v + rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;

    // Wide 3D Fields
    const isWide3D = d.tPhs < -0.1 ? Math.abs(d.tPhs) : 0;
    rOx.v = lerp(rOx.v, d.tPan * 35, K_slow); rOw.v = lerp(rOw.v, isWide3D * 15 + 32, K_slow); rOs.v = lerp(rOs.v, isWide3D * d.tLvl, K_slow);
    if (otherLRef.current) { otherLRef.current.style.transform = `translate(calc(-50% + ${rOx.v - rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`; otherLRef.current.style.opacity = `${isWide3D * 0.8}`; }
    if (otherRRef.current) { otherRRef.current.style.transform = `translate(calc(-50% + ${rOx.v + rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`; otherRRef.current.style.opacity = `${isWide3D * 0.8}`; }

    // Dust Particles
    dustThreshold.current = Math.max(0.04, dustThreshold.current - 0.003);
    const isTrebleSpike = d.tLvl > dustThreshold.current && (d.tLvl - lastTrebleLevel.current) > 0.008;
    if (isTrebleSpike) {
      for (let i = 0; i < 18; i++) {
        const p = dustState.current.find(p => !p.active);
        if (p) {
          p.active = true; p.isLeft = Math.random() > 0.5; p.y = (Math.random() - 0.5) * 60;
          const yN = p.y / 35, arc = 11 * Math.sqrt(Math.max(0, 1 - yN * yN));
          p.isLeft ? (p.x = (rTx.v - rTw.v) - arc, p.vx = -(Math.random() * 0.6 + 0.2)) : (p.x = (rTx.v + rTw.v) + arc, p.vx = (Math.random() * 0.6 + 0.2));
          p.vy = (Math.random() - 0.5) * 0.4 - 0.15; p.scale = Math.random() * 0.5 + 0.3; p.opacity = 1.0;
        }
      }
      dustThreshold.current = Math.min(0.5, d.tLvl + 0.08);
    }
    lastTrebleLevel.current = d.tLvl;

    // Canvas Draw
    const canvas = dustCanvasRef.current;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1, dw = canvas.clientWidth, dh = canvas.clientHeight;
      if (canvas.width !== dw * dpr || canvas.height !== dh * dpr) { canvas.width = dw * dpr; canvas.height = dh * dpr; }
      const ctx = canvas.getContext('2d', { alpha: true });
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2, cy = canvas.height / 2, vw = canvas.width / 100, vh = canvas.height / 100;
        ctx.globalCompositeOperation = isDarkModeRef.current ? 'screen' : 'source-over';
        const sprite = isDarkModeRef.current ? glowSpriteDark : glowSpriteLight;
        dustState.current.forEach(p => {
          if (p.active) {
            p.vx += (Math.random() - 0.5) * 0.08; p.vy -= 0.015; p.vx *= 0.96; p.vy *= 0.96; p.x += p.vx; p.y += p.vy; p.opacity -= 0.008;
            if (p.opacity <= 0) { p.active = false; } else { ctx.globalAlpha = p.opacity; const ds = (p.scale * dpr) * 70; ctx.drawImage(sprite, (cx + p.x * vw) - ds / 2, (cy + p.y * vh) - ds / 2, ds, ds); }
          }
        });
      }
    }

    // Random Artifacts
    if (d.tPhs < 0.05 && Math.random() > 0.6) {
      const art = artifactState.current.find(a => !a.active);
      if (art) { art.active = true; art.x = (Math.random() - 0.5) * 80; art.y = (Math.random() - 0.5) * 80; art.scale = 0; art.opacity = 1.0; }
    }
    artifactState.current.forEach((art, i) => {
      if (art.active) {
        art.scale += 0.025; const as = 0.5 + Math.sin(art.scale) * 0.6; art.opacity = Math.max(0, 1.0 - (art.scale / 3.14));
        if (art.scale >= 3.14) { art.active = false; art.opacity = 0; }
        const el = artifactRefs.current[i]; if (el) { el.style.transform = `translate(calc(-50% + ${art.x}vw), calc(-50% + ${art.y}vh)) scale(${as})`; el.style.opacity = `${art.opacity}`; }
      }
    });
  }

  rafId = requestAnimationFrame(tick);
};
    rafId=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

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
    const iv = setInterval(async () => {
      if (!isPlaying || isLoading) return;
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

        // CRITICAL FIX: The End-Of-Track Trigger
        // If Rust sends the EOF flag (m[11]), OR we are within 1 second of the end, force the transition immediately.
        if (m[11] === 1.0 || (m[1] > 0 && m[0] >= m[1] - 1.0)) {
          if (isTransitioningRef.current) return;
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

      } catch (_) {}
    }, 32);
    return () => clearInterval(iv);
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
    if(dbProcess.current){await dbProcess.current.set("isDarkMode",next);await dbProcess.current.save();}
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

  const handleClearLibrary = async () => {
    if(!confirm("Clear all tracks? Files won't be deleted.")) return;
    enricherRunning.current=false;
    setPlaylist([]);setFavorites([]);setScanProgress('');
    if(dbProcess.current){await dbProcess.current.set("user_playlist",[]);await dbProcess.current.set("user_favorites",[]);await dbProcess.current.save();}
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
      try{
        const raw=await invoke<number[]|string>('read_file_head',{path:track.path,maxBytes:512000});
        let uint8:Uint8Array;
        if(typeof raw==='string'){const bin=atob(raw);uint8=new Uint8Array(bin.length);for(let j=0;j<bin.length;j++)uint8[j]=bin.charCodeAt(j);}
        else uint8=new Uint8Array(raw);
        const meta=await mm.parseBuffer(uint8,{mimeType:getMime(track.path)});
        let thumbBase64=track.thumb;
        if(!thumbBase64&&meta.common.picture?.length) thumbBase64=await generateThumbnail(meta.common.picture[0])||undefined;

        // THE SPLIT SCANNER: Check Vault on Android, Disk on PC
        let localLyrics = track.lyrics || [];
        try {
          let lrcContent = null;
          if (IS_ANDROID) {
            if (dbProcess.current) lrcContent = await dbProcess.current.get(`lrc_${track.path}`);
          } else {
            const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
            lrcContent = await readTextFile(lrcPath);
          }
          
          if (lrcContent && typeof lrcContent === 'string') {
            localLyrics = parseLRC(lrcContent);
          }
        } catch(e) {}

        const updatedTrack={
          ...track,
          name:meta.common.title||track.name,
          artist:meta.common.artist||track.artist,
          album:meta.common.album||track.album,
          year:meta.common.year?.toString()||track.year,
          quality:meta.format.bitrate?`${Math.round(meta.format.bitrate/1000)} kbps`:track.quality,
          duration:meta.format.duration||track.duration,
          metadataLoaded:true,
          genre:meta.common.genre?.[0]||track.genre||'',
          thumb:thumbBase64,
          lyrics: localLyrics // <-- Attach the loaded lyrics here
        };        
        setPlaylist(prev=>prev.map(t=>t.path===track.path?updatedTrack:t));
        playlistRef.current=playlistRef.current.map(t=>t.path===track.path?updatedTrack:t);
        await invoke('add_to_library',{track:updatedTrack});
      }catch(_){setPlaylist(prev=>prev.map(t=>t.path===track.path?{...t,metadataLoaded:true}:t));}
      enriched++;
      if(enriched%3===0) setScanProgress(`Loading metadata… ${Math.round((enriched/needsEnrich.length)*100)}%`);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    setScanProgress('');enricherRunning.current=false;
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
    const oldTrack=stateRefs.current.currentTrack;const listened=currentTimeRef.current;
    if(oldTrack&&listened>0&&oldTrack.path!==track.path){
      setPlaylist(prev=>{
        const nextList=prev.map(t=>t.path===oldTrack.path?{...t,playCount:listened>=5?(t.playCount||0)+1:(t.playCount||0),totalSecondsListened:(t.totalSecondsListened||0)+Math.floor(listened)}:t);
        if(dbProcess.current) dbProcess.current.set("user_playlist",nextList).then(()=>dbProcess.current.save());
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
      ]);
      if(id!==loadIdRef.current) return;
      await writeToEngine(`LOAD ${track.path}`);
      if(id!==loadIdRef.current) return;
      await writeToEngine('PLAY');setIsPlaying(true);

      setTimeout(async()=>{
        if(id!==loadIdRef.current) return;
        try{
          const fileData=await readFile(track.path);if(id!==loadIdRef.current) return;
          const meta=await mm.parseBuffer(fileData,{mimeType:getMime(track.path)});if(id!==loadIdRef.current) return;
          const title=meta.common.title||track.name,artist=meta.common.artist||track.artist;
          setTrackTitle(title);setTrackArtist(artist);
          if(meta.common.picture?.length){
            const pic=meta.common.picture[0];const blob=new Blob([pic.data],{type:pic.format});const imgUrl=URL.createObjectURL(blob);
            if(id!==loadIdRef.current){URL.revokeObjectURL(imgUrl);return;}
            setAlbumArt(imgUrl);
            try{
              const [facColor,palette]=await Promise.all([fac.getColorAsync(imgUrl,{algorithm:'dominant'}).catch(()=>null),getPalette(imgUrl)]);
              if(id===loadIdRef.current){setBlobColors(palette);const dom=(facColor&&!facColor.error)?facColor.hex:(palette[1]||'#c8222a');setThemeColor(dom);setThemeText(isHexDark(dom)?'#ffffff':'#111111');}
            }catch(_){}
          }
          // THE SPLIT LOADER: Check Vault on Android, Disk on PC
          try {
            let lrcText = null;
            if (IS_ANDROID) {
              if (dbProcess.current) lrcText = await dbProcess.current.get(`lrc_${track.path}`);
            } else {
              const lrcPath = track.path.substring(0, track.path.lastIndexOf('.')) + '.lrc';
              lrcText = await readTextFile(lrcPath);
            }
            
            if (id === loadIdRef.current && lrcText && typeof lrcText === 'string') {
               setLyrics(parseLRC(lrcText));
            }
          } catch (_) {}
          if(title!==track.name||artist!==track.artist||(meta.format.duration&&meta.format.duration!==track.duration)){
            const upd:Track={...track,name:title,artist,album:meta.common.album||track.album,year:meta.common.year?.toString()||track.year,quality:meta.format.bitrate?`${Math.round(meta.format.bitrate/1000)} kbps`:track.quality,duration:meta.format.duration||track.duration};
            setPlaylist(playlistRef.current.map(t=>t.path===track.path?upd:t));
            invoke('add_to_library',{track:upd}).catch(console.error);
          }
        }catch(_){}
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
            if(dbProcess.current){dbProcess.current.set("user_playlist",nl);dbProcess.current.save().catch(()=>{});}
          }
        }catch(_){}finally{setIsAnalyzing(false);}
      },2000);}
    }catch(_){if(id===loadIdRef.current){try{await writeToEngine(`LOAD ${track.path}`);await writeToEngine('PLAY');setIsPlaying(true);}catch(_){}}}
  };
//AIzaSyAoOyi6NwaoVzcSIplFsTk3zHopfCl0WWg
  const geminiMetadataCleaner = async (track: Track) => {
    const API_KEY = "AIzaSyAoOyi6NwaoVzcSIplFsTk3zHopfCl0WWg"; 
    const formattedDuration = `${Math.floor(track.duration / 60)}:${Math.floor(track.duration % 60).toString().padStart(2, '0')}`;

    const prompt = `
      Identify official music metadata. 
      Input: "${track.name}" by "${track.artist}"
      Context: Duration ${formattedDuration}, Year ${track.year}
      
      RULES:
      1. TITLE: Clean official title. Strip all website domains (.co, .com).
      2. ARTISTS: Return an array of the most likely primary artists to query a database with. Do not group them.
      
      Return EXACTLY this JSON format and nothing else:
      {"title": "Clean Title", "artists": ["Artist 1", "Artist 2"]}
    `;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 } 
        })
      });

      // 429 CIRCUIT BREAKER
      if (res.status === 429) {
        console.error("AI RATE LIMITED (429)");
        return null; 
      }

      const data = await res.json();
      if (!res.ok || !data.candidates) return null;

      const text = data.candidates[0].content.parts[0].text;
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch (e) {
      return null;
    }
  };
  // ─────────────────────────────────────────────────────────────────────────────
  // AUTO-LYRICS GENERATOR (LRCLIB Integration)
  // ─────────────────────────────────────────────────────────────────────────────
  const autoFetchLyrics = async (track: Track) => {
    if (!track.name || track.name === 'Unknown Title') return;

    const clean = (str: string, isArtist = false) => {
      let val = str.replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/-?\s*(PagalNew|Pagalworld|Mp3Mad|Mp3 Song|Remix|DjPunjab|Mr-Jatt)\.?(com|co|in|org|mobi)?/gi, '')
        .replace(/\.co(m)?\s*$/gi, '')
        .replace(/\s\s+/g, ' ').trim();
      if (isArtist) val = val.split(/,|;|&|feat\.|ft\./i)[0];
      return val.trim();
    };

    const t = clean(track.name);
    // Ensure every split artist is cleaned individually
    const artistsToTry = track.artist === 'Unknown Artist' 
      ? [''] 
      : track.artist.split(/,|;|&|feat\.|ft\./i).map(x => clean(x, true)).filter(Boolean);

    // THE CACHE: We store the best "Wrong Duration" match here just in case.
    let desperateFallbackLrc: string | null = null;

    try {
      // 1. THE LOCAL BRUTE-FORCE LOOP (Tier 1 & Tier 2)
      for (let i = 0; i < artistsToTry.length; i++) {
        const a = artistsToTry[i];
        console.log(`%c[Lyrics] Testing Artist ${i+1}/${artistsToTry.length}: "${a}"`, "color: #2196f3;");
        setScanProgress(`Testing artist ${i+1}/${artistsToTry.length}: ${a || 'Unknown'}...`);

        // Tier 1: Exact Match Attempt
        const res1 = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`);
        if (res1.ok) {
          const data = await res1.json();
          if (data.syncedLyrics) {
            // THE STRICT GATE
            if (Math.abs(data.duration - track.duration) < 5) {
              console.log("%c[Lyrics] SUCCESS: Perfect Tier 1 match found.", "color: #00e676;");
              return finalizeLyrics(track, data.syncedLyrics);
            } else if (!desperateFallbackLrc) {
              // Save it for later if the duration is wrong
              desperateFallbackLrc = data.syncedLyrics;
            }
          }
        }

        // Tier 2: Fuzzy Match Attempt
        const res2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${t} ${a}`)}`);
        if (res2.ok) {
          const results = await res2.json();
          const bestMatch = results.find((r: any) => r.syncedLyrics && Math.abs(r.duration - track.duration) < 5);
          
          if (bestMatch) {
            console.log("%c[Lyrics] SUCCESS: Perfect Tier 2 match found.", "color: #00e676;");
            return finalizeLyrics(track, bestMatch.syncedLyrics);
          } else if (!desperateFallbackLrc && results.length > 0 && results[0].syncedLyrics) {
             desperateFallbackLrc = results[0].syncedLyrics;
          }
        }
      }

      // 2. TIER 3: THE AI ARRAY GENERATOR
      console.log("%c[Lyrics] T3: Local loop failed. Waking AI...", "color: #f44336; font-weight: bold;");
      setScanProgress('Standard search failed. Engaging AI...');
      
      const aiData = await geminiMetadataCleaner(track);
      
      if (aiData && aiData.artists && Array.isArray(aiData.artists)) {
        for (const aiArtist of aiData.artists) {
           setScanProgress(`AI Testing: ${aiArtist}...`);
           
           const res3 = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(aiData.title)}&artist_name=${encodeURIComponent(aiArtist)}`);
           if (res3.ok) {
             const data = await res3.json();
             if (data.syncedLyrics) {
                if (Math.abs(data.duration - track.duration) < 5) {
                  console.log("%c[Lyrics] SUCCESS: Perfect AI match found.", "color: #00e676;");
                  return finalizeLyrics(track, data.syncedLyrics);
                } else if (!desperateFallbackLrc) {
                  desperateFallbackLrc = data.syncedLyrics;
                }
             }
           }
        }
      }

      // 3. TIER 4: THE DESPERATION FALLBACK
      // We exhausted everything. Reduce constraints and use the back-pocket cache.
      if (desperateFallbackLrc) {
        console.log("%c[Lyrics] T4: Duration constraint failed. Falling back to closest text match.", "color: #ff9800; font-weight: bold;");
        setScanProgress('Duration mismatch. Using closest lyrics found...');
        return finalizeLyrics(track, desperateFallbackLrc);
      }

      setScanProgress('No lyrics found. All attempts exhausted.');
      setTimeout(() => setScanProgress(''), 3000);
    } catch (e) {
      setScanProgress('Network error.');
      setTimeout(() => setScanProgress(''), 3000);
    }
  };

  const finalizeLyrics = async (track: Track, lrc: string) => {
    const parsed = parseLRC(lrc);
    setLyrics(parsed);
    setPlaylist(prev => prev.map(t => t.path === track.path ? { ...t, lyrics: parsed } : t));

    try {
      if (IS_ANDROID) {
        // ANDROID: Store safely in the internal database vault
        if (dbProcess.current) {
          await dbProcess.current.set(`lrc_${track.path}`, lrc);
          await dbProcess.current.save();
          console.log(`%c[Persistence] Lyrics vaulted for: ${track.name}`, "color: #ffeb3b;");
        }
      } else {
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

  
  const createPlaylist = async (e:React.FormEvent) => {
    e.preventDefault();if(!newPlaylistName.trim()) return;
    const newPl:CustomPlaylist={id:Date.now().toString(),name:newPlaylistName.trim(),trackPaths:playlistModalTracks.length>0?[...playlistModalTracks]:[]};
    const updated=[...customPlaylists,newPl];setCustomPlaylists(updated);setNewPlaylistName('');setPlaylistModalTracks([]);setIsSelectionMode(false);setSelectedTracks(new Set());
    if(dbProcess.current){await dbProcess.current.set("user_playlists",updated);await dbProcess.current.save();}
  };
  const addToPlaylist = async (playlistId:string) => {
    const updated=customPlaylists.map(pl=>pl.id===playlistId?{...pl,trackPaths:[...pl.trackPaths,...playlistModalTracks.filter(p=>!pl.trackPaths.includes(p))]}:pl);
    setCustomPlaylists(updated);setPlaylistModalTracks([]);setIsSelectionMode(false);setSelectedTracks(new Set());
    if(dbProcess.current){await dbProcess.current.set("user_playlists",updated);await dbProcess.current.save();}
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
  const formatTime = (s:number) => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  const isCurrentFavorite = currentTrack?favorites.includes(currentTrack.path):false;
  const bollywoodCount = playlist.filter(t=>t.profile==='BOLLYWOOD').length;
  const applyPreset = async (preset:'STUDIO'|'CINEMATIC'|'RELAX') => {
    let pRem=false,pCmp=false,pDrv=0.0,pWid=1.0,p3D=0.0,pRvb=0.0,pBas=0.0;
    if(preset==='STUDIO'){pCmp=true;pDrv=0.7;pWid=1.10;pBas=0.3;}
    else if(preset==='CINEMATIC'){pRem=true;pCmp=true;pDrv=1.2;pWid=1.35;p3D=0.25;pRvb=0.16;pBas=0.8;}
    else{p3D=0.40;pRvb=0.22;pBas=0.1;}
    setIsRemastered(pRem);setIsCompressed(pCmp);setUpscaleDrive(pDrv);setWidenWidth(pWid);setSpatialExtra(p3D);setReverbWet(pRvb);setBassLevel(pBas);
    await writeToEngine(`REMASTER ${pRem?1:0}`);await writeToEngine(`COMPRESS ${pCmp?1:0}`);await writeToEngine(`UPSCALE ${pDrv}`);await writeToEngine(`WIDEN ${pWid}`);await writeToEngine(`3D ${p3D}`);await writeToEngine(`REVERB ${pRvb}`);await writeToEngine(`BASS ${pBas}`);
  };

  const TASTES:{id:Taste;icon:string;label:string}[]=[{id:'QUALITY',icon:'✨',label:'HD Clear'},{id:'IMMERSIVE',icon:'🌌',label:'Immersive'},{id:'CHILL',icon:'🌙',label:'Chill'}];
  const renderSmartPills = () => (
    <div className="player-smart-section">
      <div className="player-profile-line">
        {isAnalyzing?<span className="profile-analyzing"><span className="dot-pulse"/> Analyzing…</span>
          :isManualOverride?<span className="profile-chip" style={{color:'#ffa726',background:'rgba(255,167,38,0.15)'}}>⚙️ Manual Override Active</span>
          :detectedProfile?<span className="profile-chip">Identified: {detectedProfile.icon} {detectedProfile.label}</span>
          :<span className="profile-chip muted">🎵 Standard Audio</span>}
      </div>
      <div className="player-taste-pills" style={{opacity:isManualOverride?0.4:1,transition:'opacity 0.2s ease'}}>
        {TASTES.map(t=>(
          <button key={t.id} className={`taste-pill ${!isManualOverride&&smartTaste===t.id?'active':''}`} onClick={()=>handleTasteChange(t.id)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderManualDSP = () => {
    const isConvActive=selectedAcousticEnv!=='NONE';
    const disabledStyle={opacity:isConvActive?0.3:1,pointerEvents:isConvActive?'none':'auto',transition:'opacity 0.3s'} as React.CSSProperties;
    return (
      <div className="studio-dashboard fade-in">
        <div className="studio-header"><h2>Fine Tune DSP</h2><p className="studio-subtitle">Manual override — resets on next track load</p></div>
        <div className="manual-presets" style={disabledStyle}>
          <button className="preset-btn studio" onClick={()=>applyPreset('STUDIO')}>🎧 Studio</button>
          <button className="preset-btn cinema" onClick={()=>applyPreset('CINEMATIC')}>🍿 Cinematic</button>
          <button className="preset-btn relax" onClick={()=>applyPreset('RELAX')}>🌙 Relax</button>
        </div>
        <div className="dsp-grid">
          <div className="dsp-card toggle-card">
            <div className="dsp-toggle-group"><label>Old Song EQ</label><button className={`dsp-btn ${isRemastered?'active':''}`} onClick={()=>{const v=!isRemastered;setIsRemastered(v);writeToEngine(`REMASTER ${v?1:0}`);}}>{isRemastered?'ON':'BYPASS'}</button></div>
            <div className="dsp-toggle-group"><label>Compressor</label><button className={`dsp-btn ${isCompressed?'active':''}`} onClick={()=>{const v=!isCompressed;setIsCompressed(v);writeToEngine(`COMPRESS ${v?1:0}`);}}>{isCompressed?'ON':'BYPASS'}</button></div>
          </div>
          <div className="dsp-card" style={{position:'relative'}}>
            <div className="dsp-label-row"><label>Acoustic Environment (Convolution)</label></div>
            <div onClick={()=>setIsEnvDropdownOpen(!isEnvDropdownOpen)} style={{marginTop:'8px',padding:'10px 14px',cursor:'pointer',background:'rgba(255,255,255,0.08)',color:'var(--text-primary)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:'8px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>{REVERB_ENVIRONMENTS.find(r=>r.id===selectedAcousticEnv)?.label||'Off'}</span>
              <span style={{fontSize:'12px',opacity:0.7}}>▼</span>
            </div>
            {isEnvDropdownOpen&&(
              <>
                <div style={{position:'fixed',inset:0,zIndex:98}} onClick={()=>setIsEnvDropdownOpen(false)}/>
                <div className="glass-options-menu fade-in" style={{position:'absolute',top:'100%',left:0,right:0,zIndex:99,marginTop:'8px',padding:'6px',maxHeight:'250px',overflowY:'auto'}}>
                  {REVERB_ENVIRONMENTS.map(env=>(
                    <div key={env.id} style={{padding:'12px 14px',borderRadius:'6px',cursor:'pointer',background:selectedAcousticEnv===env.id?'rgba(255,255,255,0.15)':'transparent',transition:'background 0.2s'}}
                      onClick={async e=>{
                        e.stopPropagation();setIsEnvDropdownOpen(false);setSelectedAcousticEnv(env.id);
                        if(env.path){
                          try{
                            if(env.path.includes('|')){const [pL,pR]=env.path.split('|');writeToEngine(`LOAD_IR_DUAL ${await resolveResource(pL)}|${await resolveResource(pR)}`);}
                            else writeToEngine(`LOAD_IR ${await resolveResource(env.path)}`);
                            writeToEngine(`CONVOLUTION 0.35`);setIsManualOverride(true);setSmartTaste('QUALITY' as Taste);
                          }catch(err){console.error(err);}
                        }else{writeToEngine(`LOAD_IR `);writeToEngine(`CONVOLUTION 0.0`);setIsManualOverride(false);}
                      }}>{env.label}</div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Tube Exciter (Air)</label><span style={{color:'#00e676',fontWeight:600}}>{Math.round(upscaleDrive*50)}%</span></div>
            <input type="range" className="dsp-slider" min="0" max="2.0" step="0.05" value={upscaleDrive} onChange={e=>{const v=parseFloat(e.target.value);setUpscaleDrive(v);writeToEngine(`UPSCALE ${v}`);}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{Math.round((widenWidth-1)*100)}% extra</span></div>
            <input type="range" className="dsp-slider widener" min="1" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(`WIDEN ${v}`);}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?`+${Math.round(spatialExtra*100)}%`:'Base'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(`3D ${v}`);}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Digital Reverb (Algorithmic)</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div>
            <input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(`REVERB ${v}`);}}/>
          </div>
        </div>
      </div>
    );
  };

  const isLong = trackTitle.length > 25;
  const artistIsLong = trackArtist.length > 30;

  // CRITICAL FIX: Removed the IS_ANDROID ellipsis bypass. Marquee now runs globally.
  const TitleMarquee = useMemo(() => (
    isLong
      ? <div className="marquee-container scrolling" key={"title-"+trackTitle}><Marquee speed={40} gradient={false} delay={1.5}><h1 className="ep-title" style={{paddingRight:'60px',margin:0}}>{trackTitle}</h1></Marquee></div>
      : <div className="marquee-container" key={"title-"+trackTitle}><h1 className="ep-title">{trackTitle}</h1></div>
  ), [isLong, trackTitle]);

  const ArtistMarquee = useMemo(() => (
    artistIsLong
      ? <div className="ep-artist-marquee scrolling" key={"artist-"+trackArtist}><Marquee speed={35} gradient={false} delay={1.5}><h2 className="ep-artist" style={{paddingRight:'60px',margin:0}}>{trackArtist}</h2></Marquee></div>
      : <div className="ep-artist-marquee" key={"artist-"+trackArtist}><h2 className="ep-artist">{trackArtist}</h2></div>
  ), [artistIsLong, trackArtist]);

  const renderExpandedControls = () => {
   
    
    // THE FIX: We memoize the rendered output, not the function definition.
    // It instantly gets access to all CSS classes, but never flickers.
    return (
      <div className="ep-controls-section">
        <div className="ep-track-header">
          {TitleMarquee}
          {ArtistMarquee}
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
<button 
              className="ep-icon-btn" 
              onClick={e => { e.stopPropagation(); setShowLyrics(!showLyrics); setShowStudio(false); }} 
              style={{ color: showLyrics ? 'var(--theme-color)' : undefined }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </button>

            {/* 2. THE DSP STUDIO BUTTON (Restored) */}
            <button 
              className="ep-icon-btn" 
              onClick={e => { e.stopPropagation(); setShowStudio(!showStudio); setShowLyrics(false); }} 
              style={{ color: showStudio ? 'var(--theme-color)' : undefined }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
              </svg>
            </button>
        </div>
        <div className="ep-progress-container">
          <input type="range" className="ep-progress-bar" min="0" max={duration||1} value={currentTime} onPointerDown={()=>isSeekingRef.current=true} onChange={handleSeekDrag} onPointerUp={handleSeekCommit}/>
          <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
        </div>
        <div className="ep-main-controls">
          <button className="ep-ctrl-btn no-touch-effects" onClick={handleToggleShuffle}>
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 3 8 C 9 8 13 16 20 16":"M 3 8 C 9 8 13 8 20 8"}/>
              <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 3 16 C 9 16 13 8 20 8":"M 3 16 C 9 16 13 16 20 16"}/>
              <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 17 13 L 20 16 L 17 19":"M 17 5 L 20 8 L 17 11"}/>
              <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 17 5 L 20 8 L 17 11":"M 17 13 L 20 16 L 17 19"}/>
            </svg>
          </button>
          <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handlePrev();}}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
          <button className="ep-play-btn no-touch-effects" onClick={handlePlayPause}>
            {isPlaying?<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .656-.656c.163-.32.163-.74.163-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C8.861 3 8.441 3 7.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656zm9 0C14 4.139 14 4.559 14 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z"/></svg>:<svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)"/></svg>}
          </button>
          <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handleNext();}}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
          <button className="ep-ctrl-btn no-touch-effects" onClick={handleToggleRepeat}>
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform:`rotate(${repeatDeg}deg)`,transition:'transform 0.52s cubic-bezier(.4,0,.2,1)'}}>
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              <path style={{transition:'d 0.38s cubic-bezier(.4,0,.2,1), stroke-width 0.3s',strokeWidth:repeatMode==='ONE'?2.2:1.8} as React.CSSProperties} d={repeatBusy?"M 12 12 L 12 12 L 12 12":repeatMode==='OFF'?"M 6 18 L 12 12 L 18 6":repeatMode==='ALL'?"M 12 12 L 12 12 L 12 12":"M 11 10 L 12 8 L 12 15"}/>
            </svg>
          </button>
        </div>
      </div>
    );
  };

  const renderMobileDSPPage = () => (
    <div className="mobile-dsp-page fade-in">
      <div className="mobile-dsp-header">
        <button className="mobile-dsp-back" onClick={()=>setShowDSPPage(false)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
        <h1 className="mobile-dsp-title">Sound Quality & Effects</h1>
      </div>
      <div className="mobile-dsp-body">{renderManualDSP()}</div>
    </div>
  );

  const renderMobileHeader = () => (
    <div className="mobile-header">
      <div className="sidebar-logo"><span className="logo-d">D</span><span className="logo-rest">meX</span></div>
      <div className="mobile-header-actions">
        <button className="mobile-icon-btn" onClick={()=>setMobileSearchOpen(s=>!s)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
        <button className="mobile-icon-btn theme-toggle-btn" onClick={toggleTheme}>{isDarkMode?<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}</button>
        <button className="mobile-icon-btn add-folder-mobile" onClick={handleAddFolder} disabled={isLoading}>{isLoading?'⏳':'+'}</button>
      </div>
    </div>
  );

  const renderBulkScanBanner = () => {
    const unscannedCount=playlist.filter(t=>!t.profile).length;
    if(!bulkScanActive&&unscannedCount===0) return null;
    const pct=bulkScanTotal>0?Math.round((bulkScanDone/bulkScanTotal)*100):0;
    return (
      <>
        <button className="bulk-scan-fab fade-in" onClick={()=>setIsBulkScanOpen(true)}>
          <span className="fab-text">{bulkScanActive?(bulkScanPaused?`Paused ${pct}%`:`Scanning ${pct}%`):`Optimize (${unscannedCount})`}</span>
        </button>
        {isBulkScanOpen&&(
          <div className="folder-modal-overlay" onClick={()=>setIsBulkScanOpen(false)}>
            <div className="folder-modal" onClick={e=>e.stopPropagation()}>
              <div className="folder-modal-header"><h2>Audio Optimization</h2><button className="folder-modal-close" onClick={()=>setIsBulkScanOpen(false)}>×</button></div>
              <div className="bulk-scan-modal-content">
                <p className="folder-modal-hint" style={{marginBottom:20,padding:0}}>{bulkScanActive?"Analyzing audio fingerprints in the background to instantly apply the perfect DSP profile when you play a song.":`${unscannedCount} tracks haven't been analyzed yet. Run a background scan to enable instant Smart DSP loading.`}</p>
                {bulkScanActive?(
                  <div className="bulk-scan-active-view">
                    <div className="bulk-scan-info"><span className="bulk-scan-label">{bulkScanPaused?'⏸ Paused':'⚡ Scanning'}</span><span className="bulk-scan-pct">{bulkScanDone} / {bulkScanTotal} ({pct}%)</span></div>
                    <div className="bulk-scan-bar" style={{marginBottom:20}}><div className="bulk-scan-fill" style={{width:`${pct}%`,background:'var(--theme-color)'}}/></div>
                    <div className="bulk-scan-actions" style={{display:'flex',gap:10}}>
                      {bulkScanPaused?<button className="folder-modal-scan-all" style={{flex:1}} onClick={resumeBulkScan}>▶ Resume</button>:<button className="folder-modal-scan-all" style={{flex:1,background:'var(--bg-raised)',color:'var(--text-primary)'}} onClick={pauseBulkScan}>⏸ Pause</button>}
                      <button className="folder-modal-scan-all" style={{flex:1,background:'#e83040'}} onClick={stopBulkScan}>✕ Stop</button>
                    </div>
                  </div>
                ):<button className="folder-modal-scan-all" onClick={()=>{startBulkCategoryScan();setIsBulkScanOpen(false);}}>Start Background Scan</button>}
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

  const isRightPaneActive = showLyrics||showStudio;
  const toggleSelect = useCallback((path:string) => {
    setSelectedTracks(prev=>{const next=new Set(prev);next.has(path)?next.delete(path):next.add(path);return next;});
  }, []);

  const handleLongPress = useCallback((path: string) => {
    setIsSelectionMode(true);
    setSelectedTracks(new Set([path]));
  }, []);

  return (
    <div className="app-layout" data-platform={IS_ANDROID ? 'android' : 'desktop'} data-theme={isDarkMode?'dark':'light'} style={{'--theme-color':themeColor,'--theme-text':themeText,'--blob-1':blobColors[0],'--blob-2':blobColors[1],'--blob-3':blobColors[2],'--audio-level':audioLevel} as React.CSSProperties}>
      
      {showFolderModal&&<FolderModal onClose={()=>setShowFolderModal(false)} onScan={scanAndAdd}/>}
      {playlistModalTracks.length>0&&<PlaylistPopup playlists={customPlaylists} newPlaylistName={newPlaylistName} setNewPlaylistName={setNewPlaylistName} onClose={()=>setPlaylistModalTracks([])} onCreate={createPlaylist} onAdd={id=>addToPlaylist(id)}/>}
      

      <div className="app-container">
        {mobileSearchOpen&&(
          <div className="mobile-search-bar" style={{margin: '16px 36px 0'}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input autoFocus type="text" placeholder="Search tracks…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
            {searchQuery&&<button onClick={()=>setSearchQuery('')}>×</button>}
          </div>
        )}

        {/* TIER 0: THE DEDICATED SYSTEM TITLEBAR */}
        {!IS_MOBILE && (
          <div className="samsung-system-titlebar " data-tauri-drag-region="true">
            <div className="window-controls ">
              <button className="win-btn min" onClick={()=>appWindow.minimize()}>—</button>
              <button className="win-btn max" onClick={()=>appWindow.toggleMaximize()}>□</button>
              <button className="win-btn close" onClick={()=>appWindow.close()}>✕</button>
            </div>
          </div>
        )}

        {/* TIER 1 & 2: THE STACKED HEADER */}
        <div className="samsung-header-wrapper" data-tauri-drag-region="true">
          <header className="samsung-top-bar">
            <div className="samsung-logo-area" data-tauri-drag-region="true">
              <span style={{fontWeight: 800, color: 'var(--text-primary)'}}>DmeX </span>
              <span style={{fontWeight: 400, color: 'var(--text-primary)'}}>Player</span>
            </div>
            
            <div className="samsung-actions">
              <button className="samsung-icon-btn" onClick={handleAddFolder} disabled={isLoading}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <button className="samsung-icon-btn" onClick={()=>setMobileSearchOpen(!mobileSearchOpen)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </button>
              <button className="samsung-icon-btn" onClick={toggleTheme}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="12" cy="20" r="2"/></svg>
              </button>
            </div>
          </header>

          <nav className="samsung-nav-tabs" data-tauri-drag-region="true">
            <button className={currentView==='FAVORITES'?'active':''} onClick={()=>setCurrentView('FAVORITES')}>Favourites</button>
            <button 
              className={currentView === 'PLAYLIST_GALLERY' || currentView.startsWith('PLAYLIST_') ? 'active' : ''} 
              onClick={() => setCurrentView('PLAYLIST_GALLERY')}
            >
              Playlists
            </button>
            <button className={currentView==='ALL'?'active':''} onClick={()=>setCurrentView('ALL')}>Tracks</button>
            <button className={currentView==='BOLLYWOOD'?'active':''} onClick={()=>setCurrentView('BOLLYWOOD')}>Albums</button>
            <button className={currentView==='TOPTRACKS'?'active':''} onClick={()=>setCurrentView('TOPTRACKS')}>Artists</button>
          </nav>
        </div>

        {/* TIER 3: THE ROUNDED TRACK CONTAINER */}
        <main className="content-area">
          <div className="samsung-track-container">
            
            {/* 1. HIGHEST PRIORITY: PLAYLIST GALLERY */}
            {currentView === 'PLAYLIST_GALLERY' ? (
              <div className="playlist-gallery fade-in" style={{height: '100%', overflowY: 'auto', paddingBottom: '120px'}}>
                {/* TIER 1: The Smart Card Carousel */}
                <div className="smart-carousel-wrapper">
                  <div className="smart-card" onClick={() => setCurrentView('ALL')}>
                    <div className="smart-card-art grid-art">
                      {playlist.slice(0, 4).map((t, i) => (
                        <div key={i} className="mini-art-tile" style={{backgroundImage: `url(${t.thumb || albumArt || ''})`, backgroundSize: 'cover', backgroundPosition: 'center'}} />
                      ))}
                    </div>
                    <p className="smart-title">Recently added</p>
                    <p className="smart-count">{playlist.length} tracks</p>
                  </div>

                  <div className="smart-card" onClick={() => setCurrentView('FAVORITES')}>
                    <div className="smart-card-art fav-art">
                      <div className="fav-heart-icon">♥</div>
                    </div>
                    <p className="smart-title">Favourite tracks</p>
                    <p className="smart-count">{favoritesSet.size} tracks</p>
                  </div>

                  <div className="smart-card" onClick={() => setCurrentView('ALL')}>
                    <div className="smart-card-art most-played-art">
                      <div className="play-icon">▶</div>
                    </div>
                    <p className="smart-title">Most played</p>
                    <p className="smart-count">All tracks</p>
                  </div>
                </div>

                {/* TIER 2: The Custom Playlists Header */}
                <div className="custom-playlist-header">
                  <h2 style={{fontSize: '18px', fontWeight: 700, margin: 0}}>My Playlists</h2>
                  <button className="samsung-add-playlist-btn" onClick={() => {
                     const name = prompt("Enter playlist name:");
                     if (name) createPlaylist(name);
                  }}>+</button>
                </div>

                {/* TIER 3: The Custom Playlists List */}
                <div className="custom-playlist-list">
                  {customPlaylists.length === 0 ? (
                    <p style={{opacity: 0.5, fontSize: '14px', marginTop: '16px'}}>No custom playlists yet.</p>
                  ) : (
                    customPlaylists.map(pl => (
                      <div key={pl.id} className="samsung-list-item" onClick={() => setCurrentView(`PLAYLIST_${pl.id}`)}>
                        <div className="samsung-list-icon">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                        </div>
                        <div className="samsung-list-text">
                          <p className="samsung-list-title">{pl.name}</p>
                          <p className="samsung-list-count">{pl.tracks.length} tracks</p>
                        </div>
                        <button className="delete-pl-btn" onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); }}>🗑</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            // 2. SECOND PRIORITY: EMPTY STATE (If not in gallery and no tracks exist)
            ) : displayedTracks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎵</div>
                <p className="empty-title">{searchQuery?'No results found':'No music yet'}</p>
                <p className="empty-hint">{searchQuery?'Try a different search term':IS_MOBILE?'Tap the + button to add your music folders':'Click the + button in the top right'}</p>
                {!searchQuery&&IS_MOBILE&&<button className="empty-add-btn" onClick={handleAddFolder}>+ Add Music Folder</button>}
              </div>

            // 3. THIRD PRIORITY: THE MAIN TRACK LIST
            ) : (
              <>
                {!searchQuery && displayedTracks.length > 0 && (
                  <div style={{display:'flex',justifyContent: isSelectionMode ? 'space-between' : 'flex-end',alignItems:'center',marginBottom: IS_ANDROID ? '6px' : '16px', padding: IS_ANDROID ? '0 16px' : '0 16px 0 0', transition: 'all 0.2s'}}>
                    
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
                        {(!activePlaylistId && currentView !== 'TOPTRACKS') && (
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
                
                {/* 4. THE ACTUAL VIRTUAL LIST ENGINE */}
                {activePlaylistId ? (
                  <DraggablePlaylistView tracks={displayedTracks} currentTrackPath={currentTrack?.path} albumArt={albumArt}
                    onPlay={playTrack} formatTime={formatTime}
                    onRemove={track=>removeFromPlaylist(activePlaylistId,[track.path])}
                    onReorder={(from,to)=>reorderPlaylist(activePlaylistId,from,to)}
                    isSelectionMode={isSelectionMode} selectedTracks={selectedTracks} onToggleSelect={toggleSelect}/>
                ) : (
                  <VirtualList tracks={displayedTracks} currentTrackPath={currentTrack?.path} albumArt={albumArt}
                    favoritesSet={favoritesSet}
                    onPlay={playTrack} formatTime={formatTime}
                    onAddToPlaylist={track=>setPlaylistModalTracks([track.path])}
                    onRemoveFromPlaylist={track=>activePlaylistId&&removeFromPlaylist(activePlaylistId,[track.path])}
                    activePlaylistId={activePlaylistId} isSelectionMode={isSelectionMode}
                    selectedTracks={selectedTracks} onToggleSelect={toggleSelect}
                    onLongPress={handleLongPress} 
                  />
                )}
              </>
            )}
          </div>
        </main>

        
        <footer className={`bottom-player ${isExpanded?'expanded':''}`}>
          
          {/* 1. Mini Player: Never unmounted, never display:none. Just faded out. */}
          <div className="mini-player-content" style={{ 
            opacity: isExpanded ? 0 : 1, 
            pointerEvents: isExpanded ? 'none' : 'auto',
            position: isExpanded ? 'absolute' : 'relative',
            width: '100%',
            transition: 'opacity 0.2s ease',
            zIndex: 1
          }}>
            <div className="progress-container mini">
              <input type="range" className="progress-bar" min="0" max={duration||1} value={currentTime} onPointerDown={()=>isSeekingRef.current=true} onChange={handleSeekDrag} onPointerUp={handleSeekCommit} onClick={e=>e.stopPropagation()}/>
            </div>
            <div className="player-interface">
              <div className="track-info" onClick={()=>setIsExpanded(true)}>
                <div className="art-circle" style={{backgroundImage:albumArt?`url(${albumArt})`:'none',backgroundColor:albumArt?'transparent':'rgba(255,255,255,0.15)'}}>{!albumArt&&<span>🎵</span>}</div>
                <div className="mini-text-block">
                  {/* CHANGE: Marquee replaced with ellipsis on Android in mini player too */}
                  {trackTitle.length>22?(IS_ANDROID?<div className="mini-marquee-clip scrolling"><span className="track-title" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{trackTitle}</span></div>:<div className="mini-marquee-clip scrolling"><Marquee speed={35} gradient={false} delay={1}><span className="track-title" style={{paddingRight:'48px'}}>{trackTitle}</span></Marquee></div>):<div className="mini-marquee-clip"><span className="track-title">{trackTitle}</span></div>}
                  {trackArtist.length>26?(IS_ANDROID?<div className="mini-marquee-clip scrolling"><span className="artist-subtitle" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{trackArtist}{detectedProfile&&<span className="mini-profile"> {detectedProfile.icon}</span>}</span></div>:<div className="mini-marquee-clip scrolling"><Marquee speed={30} gradient={false} delay={1}><span className="artist-subtitle" style={{paddingRight:'48px'}}>{trackArtist}{detectedProfile&&<span className="mini-profile"> {detectedProfile.icon}</span>}</span></Marquee></div>):<div className="mini-marquee-clip"><span className="artist-subtitle">{trackArtist}{detectedProfile&&<span className="mini-profile"> {detectedProfile.icon}</span>}</span></div>}
                </div>
              </div>
              <div className="controls">
                <button className="control-btn" onClick={e=>{e.stopPropagation();handlePrev();}}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
                <button className="play-main" onClick={handlePlayPause}>{isPlaying?<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.163 1.581a1.5 1.5 0 0 0 .656.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .656-.656c.163-.32.163-.74.163-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C8.861 3 8.441 3 7.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.656.656zm9 0C14 4.139 14 4.559 14 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z"/></svg>:<svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)"/></svg>}</button>
                <button className="control-btn" onClick={e=>{e.stopPropagation();handleNext();}}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
              </div>
            </div>
          </div>

          {/* 2. Expanded Player: Fully painted in the background on boot. Zero layout math on click. */}
          <div className="expanded-player-content" style={{ 
            opacity: isExpanded ? 1 : 0, 
            pointerEvents: isExpanded ? 'auto' : 'none',
            visibility: isExpanded ? 'visible' : 'hidden', 
            position: isExpanded ? 'relative' : 'absolute',
            height: '100%',
            width: '100%',
            transition: 'opacity 0.3s ease',
            zIndex: 2
          }}>
            <div className="ambient-background">
              {visMode==='ORBIT'?(
                <>
                  {/* CRITICAL FIX: Nullified audio scaling on Android so they become static, zero-cost drifters */}
                  <div className="blob blob-1" style={{transform:`scale(${1 + (IS_ANDROID ? 0 : audioLevel * 2.0)})`, transition: IS_ANDROID ? 'none' : 'transform 0.12s ease-out'}}/>
                  <div className="blob blob-2" style={{transform:`scale(${1 + (IS_ANDROID ? 0 : audioLevel * 1.3)})`, transition: IS_ANDROID ? 'none' : 'transform 0.18s ease-out'}}/>
                  <div className="blob blob-3" style={{transform:`scale(${1 + (IS_ANDROID ? 0 : audioLevel * 0.9)})`, transition: IS_ANDROID ? 'none' : 'transform 0.22s ease-out'}}/>
                </>
              ):(
                <div style={{position:'absolute',inset:0,'--ring-core':isDarkMode?'rgba(255,255,255,0.9)':'var(--theme-color)'} as React.CSSProperties}>
                  
                  {/* The 8 Base Blobs - Now fully restored on Android for 8B Mode */}
                  <div ref={cornerTLRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,top:'5%',left:'5%',width:'50vw',height:'50vw',background:'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={cornerBRRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,bottom:'5%',right:'5%',width:'45vw',height:'45vw',background:'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={cornerTRRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,top:'5%',right:'5%',width:'35vw',height:'35vw',background:'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={cornerBLRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,bottom:'5%',left:'5%',width:'40vw',height:'45vw',background:'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={blob5Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,top:'20%',left:'30%',width:'35vw',height:'35vw',background:'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={blob6Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,bottom:'20%',right:'30%',width:'40vw',height:'40vw',background:'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={blob7Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,top:'35%',right:'15%',width:'38vw',height:'38vw',background:'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)',willChange:'transform'}}/>
                  <div ref={blob8Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,bottom:'35%',left:'15%',width:'50vw',height:'50vw',background:'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)',willChange:'transform'}}/>
                  
                  {/* CRITICAL FIX: The Spatial Radar geometry is physically blocked from rendering on Android */}
                  {!IS_ANDROID && (
                    <>
                      <div style={{position:'absolute',inset:0,background:isDarkMode?'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)':'radial-gradient(circle at center, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.4) 100%)',zIndex:1}}/>
                      <div style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden',zIndex:2}}>
                        <div ref={ripple1Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                        <div ref={ripple2Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                        <div ref={ripple3Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                        <canvas ref={dustCanvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:3,pointerEvents:'none'}}/>
                        <div ref={bassRef} style={{position:'absolute',top:'50%',left:'50%',width:'2.5vw',height:'2.5vw',borderRadius:'50%',background:'var(--ring-core)',boxShadow:'0 0 30px 8px var(--theme-color)',willChange:'transform'}}/>
                        <div ref={midLRef} style={{position:'absolute',top:'50%',left:'50%',width:'12vw',height:'45vh',borderRadius:'50%',borderLeft:'4px solid var(--ring-core)',filter:'drop-shadow(-4px 0 8px var(--blob-1)) drop-shadow(-4px 0 16px var(--theme-color))',willChange:'transform'}}/>
                        <div ref={midRRef} style={{position:'absolute',top:'50%',left:'50%',width:'12vw',height:'45vh',borderRadius:'50%',borderRight:'4px solid var(--ring-core)',filter:'drop-shadow(4px 0 8px var(--blob-1)) drop-shadow(4px 0 16px var(--theme-color))',willChange:'transform'}}/>
                        <div ref={trebLRef} style={{position:'absolute',top:'50%',left:'50%',width:'22vw',height:'70vh',borderRadius:'50%',borderLeft:'3px solid var(--ring-core)',filter:'drop-shadow(-6px 0 10px var(--blob-2)) drop-shadow(-6px 0 20px var(--theme-color))',willChange:'transform'}}/>
                        <div ref={trebRRef} style={{position:'absolute',top:'50%',left:'50%',width:'22vw',height:'70vh',borderRadius:'50%',borderRight:'3px solid var(--ring-core)',filter:'drop-shadow(6px 0 10px var(--blob-2)) drop-shadow(6px 0 20px var(--theme-color))',willChange:'transform'}}/>
                        <div ref={otherLRef} style={{position:'absolute',top:'50%',left:'50%',width:'35vw',height:'95vh',borderRadius:'50%',borderLeft:'2px solid var(--ring-core)',filter:'drop-shadow(-10px 0 15px var(--blob-3))',willChange:'transform, opacity'}}/>
                        <div ref={otherRRef} style={{position:'absolute',top:'50%',left:'50%',width:'35vw',height:'95vh',borderRadius:'50%',borderRight:'2px solid var(--ring-core)',filter:'drop-shadow(10px 0 15px var(--blob-3))',willChange:'transform, opacity'}}/>
                        {[...Array(6)].map((_,i)=>(<div key={`art${i}`} ref={el=>{artifactRefs.current[i]=el;}} style={{position:'absolute',top:'50%',left:'50%',width:'2vw',height:'2vw',borderRadius:'50%',background:'var(--blob-3)',filter:'blur(3px)',opacity:0,willChange:'transform, opacity'}}/>))}
                      </div>
                    </>
                  )}
                </div>
                
              )}
            </div>
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
                    {detectedProfile.icon} {detectedProfile.label} {!isProfileActive && '(Raw)'}
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
                {isRightPaneActive&&renderExpandedControls()}
              </div>
              <div className="ep-right">
                {!isRightPaneActive&&renderExpandedControls()}
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
                          onClick={() => currentTrack && autoFetchLyrics(currentTrack)}
                        >
                          {scanProgress ? `⏳ ${scanProgress}` : '🔍 Fetch Lyrics Online'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {showStudio&&renderManualDSP()}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;