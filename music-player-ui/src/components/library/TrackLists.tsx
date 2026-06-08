import React, { memo, useState, useRef, useEffect, useCallback } from "react";
import { Track, IS_ANDROID } from "../../types"; // Adjust path if necessary
import { PROFILES } from "../../config/audio";
import { trackAccentColor } from "../../utils/helpers";
import { Music, X, Heart } from 'lucide-react';
// import { Position } from "@tauri-apps/api/dpi";

const ITEM_HEIGHT = 72;
const OVERSCAN = 3;

// ─────────────────────────────────────────────────────────────────────────────
// TRACK ROW
// ─────────────────────────────────────────────────────────────────────────────
interface TrackRowProps {
  track: Track;
  isActive: boolean;
  albumArt: string | null;
  isFav: boolean;
  onPlay: (t: Track) => void;
  formatTime: (s: number) => string;
  onAddToPlaylist: (t: Track) => void;
  onRemoveFromPlaylist: (t: Track) => void;
  activePlaylistId: string | null;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (path: string) => void;
  top: number;
  onLongPress?: (path: string) => void;
}

const TrackRow = memo(({ 
  track, isActive, albumArt, isFav, onPlay, formatTime, 
  onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, 
  isSelectionMode, isSelected, onToggleSelect, top, onLongPress 
}: TrackRowProps) => {
  const profileData = PROFILES.find(p => p.id === track.profile);
  
  const timerRef = useRef<number | null>(null);
  const handleTouchStart = () => {
    if (IS_ANDROID && !isSelectionMode && onLongPress) {
      timerRef.current = window.setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(50); 
        onLongPress(track.path);
      }, 600); 
    }
  };
  const cancelTouch = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  return (
    <li className={`track-item ${isActive ? 'active' : ''} ${isSelected ? 'selected-row' : ''}`}
      style={{ position: 'absolute', top, left: 0, right: 0, height: ITEM_HEIGHT, '--track-color': trackAccentColor(track.name), ...(IS_ANDROID ? { transform: 'translateZ(0)', willChange: 'transform' } : {}) } as React.CSSProperties}
      onClick={() => { if (isSelectionMode) onToggleSelect(track.path); else onPlay(track); }}
      onTouchStart={handleTouchStart} onTouchEnd={cancelTouch} onTouchMove={cancelTouch} onTouchCancel={cancelTouch}>
      <div className="track-cell title-cell">
        {isSelectionMode && <input type="checkbox" checked={isSelected} readOnly style={{ marginRight: '10px', transform: 'scale(1.2)', accentColor: 'var(--theme-color)', position:'relative', left:'5px' }}/>}
        <div className="track-item-icon" style={{ 
          backgroundColor: 'var(--bg-raised)', 
          border: '1px solid var(--border)',
          borderRadius: '8px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          overflow: 'hidden'
        }}>
          {isActive && albumArt ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
            : track.thumb ? <div className="track-thumb-art" style={{ backgroundImage:`url(${track.thumb})` }} />
            : <span style={{ color: 'var(--text-primary)', opacity: 0.6, display: 'flex', alignItems: 'center' }}>{profileData?.icon ? React.createElement(profileData.icon as any, {size: 16}) : <Music size={16} />}</span>}
        </div>
        <div className="track-item-details">
          <span className="track-item-name" style={{ display: 'flex', alignItems: 'center' }}>{isFav && <Heart size={14} fill="currentColor" strokeWidth={0} style={{ color: 'var(--theme-color)', marginRight: '6px' }} />}{track.name}</span>
          <span className="track-item-artist">{track.artist}</span>
        </div>
      </div>
      <div className="track-cell hide-mobile">{track.album}</div>
      <div className="track-cell hide-mobile">{track.year}</div>
      <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
      <div className="track-cell time-cell" style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'12px' }}>
        {activePlaylistId
          ? <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,background:'transparent',border:'none',opacity:0.8,color:'#ff4444', display:'flex', alignItems:'center', justifyContent:'center' }} onClick={e=>{e.stopPropagation();onRemoveFromPlaylist(track);}}><X size={16} /></button>
          : <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,fontSize:14,background:'transparent',border:'none',opacity:0.6 }} onClick={e=>{e.stopPropagation();onAddToPlaylist(track);}}>+</button>}
        {track.duration ? formatTime(track.duration) : '--:--'}
      </div>
    </li>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL LIST
// ─────────────────────────────────────────────────────────────────────────────
interface VirtualListProps {
  tracks: Track[];
  currentTrackPath: string | undefined;
  albumArt: string | null;
  favoritesSet: Set<string>;
  onPlay: (track: Track) => void;
  formatTime: (s: number) => string;
  onAddToPlaylist: (track: Track) => void;
  onRemoveFromPlaylist: (track: Track) => void;
  activePlaylistId: string | null;
  isSelectionMode: boolean;
  selectedTracks: Set<string>;
  onToggleSelect: (path: string) => void;
  onLongPress: (path: string) => void;
}

export const VirtualList = memo(({ 
  tracks, currentTrackPath, albumArt, favoritesSet, onPlay, formatTime, 
  onAddToPlaylist, onRemoveFromPlaylist, activePlaylistId, isSelectionMode, 
  selectedTracks, onToggleSelect, onLongPress 
}: VirtualListProps) => {
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
            onLongPress={onLongPress}
          />
        ))}
      </ul>
    </div>
  );
}, (prev, next) =>
  prev.tracks === next.tracks &&
  prev.currentTrackPath === next.currentTrackPath &&
  prev.albumArt === next.albumArt &&
  prev.favoritesSet === next.favoritesSet &&
  prev.activePlaylistId === next.activePlaylistId &&
  prev.isSelectionMode === next.isSelectionMode &&
  prev.selectedTracks === next.selectedTracks
);

// ─────────────────────────────────────────────────────────────────────────────
// DRAGGABLE PLAYLIST VIEW
// ─────────────────────────────────────────────────────────────────────────────
interface DraggablePlaylistProps {
  tracks: Track[];
  currentTrackPath: string | undefined;
  albumArt: string | null;
  onPlay: (t: Track) => void;
  formatTime: (s: number) => string;
  onRemove: (t: Track) => void;
  onReorder: (from: Track, to: Track) => void;
  isSelectionMode: boolean;
  selectedTracks: Set<string>;
  onToggleSelect: (path: string) => void;
}

export const DraggablePlaylistView = memo(({ 
  tracks, currentTrackPath, albumArt, onPlay, formatTime, 
  onRemove, onReorder, isSelectionMode, selectedTracks, onToggleSelect 
}: DraggablePlaylistProps) => {
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
    const li = (document.elementsFromPoint(e.clientX, e.clientY)[0] as Element)?.closest('.track-item');
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
    <div ref={containerRef} className="virtual-scroll-container" style={{ paddingBottom: '150px' }}>
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
                <div className="track-item-icon" style={{ 
                  backgroundColor: 'var(--bg-raised)', 
                  border: '1px solid var(--border)',
                  borderRadius: '8px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}>
                  {currentTrackPath===track.path && albumArt ? <div className="track-thumb-art" style={{ backgroundImage:`url(${albumArt})` }} />
                    : track.thumb ? <div className="track-thumb-art" style={{ backgroundImage:`url(${track.thumb})` }} />
                    : <span style={{ color: 'var(--text-secondary)', opacity: 1, display: 'flex', alignItems: 'center' }}>{profileData?.icon ? React.createElement(profileData.icon as any, {size: 16}) : <Music size={16} />}</span>}
                </div>
                <div className="track-item-details">
                  <span className="track-item-name">{track.name}</span>
                  <span className="track-item-artist">{track.artist}{track.profile && <span className="track-profile-icon" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: '4px' }}>{profileData?.icon && React.createElement(profileData.icon as any, {size: 12})}</span>}</span>
                </div>
              </div>
              <div className="track-cell hide-mobile">{track.album}</div>
              <div className="track-cell hide-mobile">{track.year}</div>
              <div className="track-cell hide-mobile quality-badge">{track.quality}</div>
              <div className="track-cell time-cell" style={{ display:'flex',alignItems:'center',justifyContent:'flex-end',gap:12 }}>
                {!isSelectionMode && <button className="ep-icon-btn no-touch-effects" style={{ width:28,height:28,background:'transparent',border:'none',opacity:0.7,color:'#ff5555', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e=>{e.stopPropagation();onRemove(track);}}><X size={16} /></button>}
                {track.duration ? formatTime(track.duration) : '--:--'}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
});