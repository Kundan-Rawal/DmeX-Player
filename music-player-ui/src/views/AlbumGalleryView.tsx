import React, { useMemo, useState, useRef } from 'react';
import { Track } from '../types';
import './AlbumGalleryView.css';

interface AlbumGalleryProps {
  playlist: Track[];
  setCurrentView: (view: string) => void;
}

export const AlbumGalleryView = ({ playlist, setCurrentView }: AlbumGalleryProps) => {
  const [visibleCount, setVisibleCount] = useState(40); // Chunk size increased to fill the wider columns
  const [isShuffled, setIsShuffled] = useState(false);
  const [shuffledAlbums, setShuffledAlbums] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. DATA AGGREGATOR
  const baseAlbums = useMemo(() => {
    const map = new Map<string, { name: string, artist: string, thumb: string | undefined, count: number, year: number }>();
    
    playlist.forEach(track => {
      const albumName = track.album || 'Unknown Album';
      if (!map.has(albumName)) {
        map.set(albumName, {
          name: albumName,
          artist: track.artist || 'Unknown Artist',
          thumb: track.thumb,
          count: 1,
          year: parseInt(track.year || '0') || 0
        });
      } else {
        const existing = map.get(albumName)!;
        existing.count += 1;
        if (!existing.thumb && track.thumb) existing.thumb = track.thumb;
        if (existing.year === 0 && track.year) existing.year = parseInt(track.year) || 0;
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return a.name.localeCompare(b.name);
    });
  }, [playlist]);

  const displayAlbums = useMemo(() => {
    return isShuffled ? shuffledAlbums : baseAlbums;
  }, [baseAlbums, isShuffled, shuffledAlbums]);

  // 2. THE LAZY LOADER (Smooth Append)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 1200) {
      setVisibleCount(prev => Math.min(prev + 30, displayAlbums.length));
    }
  };

  const handleShuffle = () => {
    if (isShuffled) {
      setIsShuffled(false);
    } else {
      const shuffled = [...baseAlbums];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setShuffledAlbums(shuffled);
      setIsShuffled(true);
    }
    setVisibleCount(40);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  // 3. 2D SHAPE GENERATOR
  // Deterministically assigns 1x1, 2x1 (Wide), 1x2 (Tall), and 2x2 (Massive) shapes
  const getCardShape = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const mod = Math.abs(hash) % 100;
    
    return mod < 80 ? 'bento-1x1' : 'bento-2x2';
  };

  if (baseAlbums.length === 0) return null;

  return (
    <div className="album-scroll-container" ref={scrollRef} onScroll={handleScroll}>
      
      <div className="album-actions-header">
        <button className="dsp-btn" onClick={handleShuffle} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px',marginBottom:'10px' }}>
          {isShuffled ? 'Sort Newest' : 'Shuffle Albums'}
        </button>
        <span className="album-count-text">{baseAlbums.length} Albums</span>
      </div>

      <div className="bento-grid-v2">
        {displayAlbums.slice(0, visibleCount).map((album, idx) => {
          const shapeClass = getCardShape(album.name);
          return (
            <div 
              key={isShuffled ? `${album.name}-${idx}` : album.name} 
              className={`bento-card-v2 ${shapeClass}`}
              style={{ backgroundImage: album.thumb ? `url(${album.thumb})` : 'none' }}
              onClick={() => setCurrentView(`ALBUM_${album.name}`)} /* <-- ADD THIS EXACT LINE */
            >
              {!album.thumb && <div className="bento-fallback-v2">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              </div>}
              <div className="bento-overlay-v2">
                <div className="bento-title-v2">{album.name}</div>
                <div className="bento-subtitle-v2">{album.count} tracks • {album.artist}</div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};