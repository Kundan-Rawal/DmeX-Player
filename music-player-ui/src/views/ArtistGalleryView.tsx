import React, { useMemo, useState, useRef } from 'react';
import { Track } from '../types';
import { buildArtistDictionary } from '../utils/artistEngine';
import { X, Search, Trash2, Pause, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface ArtistGalleryProps {
  playlist: Track[];
  setCurrentView: (view: string) => void;
}

// Ensure running context check
const IS_ANDROID = navigator.userAgent.toLowerCase().includes('android');

export const ArtistGalleryView = ({ playlist, setCurrentView }: ArtistGalleryProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'A-Z' | 'Count'>('A-Z');
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [totalArtistsToSync, setTotalArtistsToSync] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(40);
  
  // Advanced Dictionary extraction
  const allArtists = useMemo(() => {
    return buildArtistDictionary(playlist);
  }, [playlist]);

  // Handle Sort & Search
  const displayArtists = useMemo(() => {
    let result = [...allArtists];

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q));
    }

    if (sortMode === 'Count') {
      result.sort((a, b) => b.trackIds.length - a.trackIds.length || a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [allArtists, searchQuery, sortMode]);

  // Virtualized Scroll Loader
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 800) {
      setVisibleCount(prev => Math.min(prev + 30, displayArtists.length));
    }
  };

  // Sync Logic Simulation (Since backend is Rust)
  const toggleSync = () => {
    if (isSyncing) {
      setIsSyncing(false);
    } else {
      setIsSyncing(true);
      setTotalArtistsToSync(allArtists.length);
      // Let backend know we are syncing. In reality, you probably listen to tauri events.
      // We will mock the progress bar for the UI just in case events are missing right now.
      invoke('get_all_artist_images', { artists: allArtists.map(a => a.name) }).catch(console.error);
    }
  };

  const wipeArt = () => {
    setIsSyncing(false);
    setSyncProgress(0);
    // Add logic to delete local art directory via backend
  };

  // The Top Sync Progress Bar
  const renderSyncBar = () => {
    if (!isSyncing && syncProgress === 0) return null;
    
    // Windows: Dark red gradient bar
    // Android: Loading metadata... X% (pill shape)
    
    const percentage = totalArtistsToSync > 0 ? Math.round((syncProgress / totalArtistsToSync) * 100) : 0;

    if (IS_ANDROID) {
      return (
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '12px',
          padding: '10px',
          textAlign: 'center',
          marginBottom: '16px',
          color: '#8ab4f8',
          fontSize: '14px',
          fontWeight: 600,
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div style={{ width: '8px', height: '8px', background: '#8ab4f8', borderRadius: '50%', display: 'inline-block', marginRight: '8px', animation: 'pulse 1.5s infinite' }} />
          Loading metadata... {percentage}%
        </div>
      );
    }

    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(70,20,20,1) 0%, rgba(100,30,30,1) 100%)',
        borderRadius: '8px',
        padding: '12px',
        textAlign: 'center',
        marginBottom: '20px',
        color: '#fff',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Progress Fill */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, bottom: 0,
          width: `${percentage}%`,
          background: 'rgba(255,255,255,0.1)',
          transition: 'width 0.3s ease'
        }} />
        <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', background: '#ff4444', borderRadius: '50%', animation: 'pulse 1.5s infinite' }} />
          Syncing Artists: {syncProgress} / {totalArtistsToSync}
        </span>
      </div>
    );
  };

  return (
    <div className="artist-scroll-container" ref={scrollRef} onScroll={handleScroll} style={{ 
      flex: 1, 
      overflowY: 'auto', 
      padding: IS_ANDROID ? '16px 12px' : '24px 32px',
      paddingBottom: '150px' // Space for player
    }}>
      
      {renderSyncBar()}

      {/* Control Bar */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: '12px', 
        alignItems: 'center', 
        marginBottom: '24px' 
      }}>
        
        {/* Search Input */}
        <div style={{ 
          display: 'flex', alignItems: 'center', background: 'var(--bg-raised)', 
          border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', 
          gap: '8px', flex: IS_ANDROID ? '1 1 100%' : '1', minWidth: '200px'
        }}>
          <Search size={16} color="var(--text-muted)" />
          <input 
            type="text" 
            placeholder="Search artists..." 
            value={searchQuery} 
            onChange={e => setSearchQuery(e.target.value)} 
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Buttons */}
        <button 
          onClick={wipeArt}
          style={{ 
            background: 'rgba(255, 50, 50, 0.1)', border: '1px solid rgba(255, 50, 50, 0.2)', 
            color: '#ff5555', padding: '8px 16px', borderRadius: '8px', 
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
          }}>
          <Trash2 size={14} /> Wipe Art
        </button>

        <button 
          onClick={toggleSync}
          style={{ 
            background: isSyncing ? 'rgba(255, 170, 0, 0.15)' : 'var(--bg-raised)', 
            border: isSyncing ? '1px solid rgba(255, 170, 0, 0.3)' : '1px solid var(--border)', 
            color: isSyncing ? '#ffaa00' : 'var(--text-primary)', 
            padding: '8px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', 
            fontSize: '13px', fontWeight: 600, cursor: 'pointer'
          }}>
          {isSyncing ? <Pause size={14} /> : <RefreshCw size={14} />}
          {isSyncing ? 'Pause' : 'Sync Art'}
        </button>

        {/* Sort Dropdown */}
        <div 
          onClick={() => setSortMode(prev => prev === 'A-Z' ? 'Count' : 'A-Z')}
          style={{ 
            background: 'var(--bg-raised)', border: '1px solid var(--border)', 
            color: 'var(--text-primary)', padding: '8px 16px', borderRadius: '8px', 
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginLeft: IS_ANDROID ? 0 : 'auto',
            display: 'flex', alignItems: 'center', gap: '6px'
          }}>
          Sort: {sortMode} <span style={{ fontSize: '10px', opacity: 0.6 }}>▼</span>
        </div>
      </div>

      {/* The Artist Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${IS_ANDROID ? '140px' : '180px'}, 1fr))`,
        gap: IS_ANDROID ? '16px' : '24px'
      }}>
        {displayArtists.slice(0, visibleCount).map((artist) => {
          // Construct the card
          return (
            <div 
              key={artist.id} 
              style={{ display: 'flex', flexDirection: 'column', gap: '8px', cursor: 'pointer', outline: 'none' }}
              onClick={() => setCurrentView(`ARTIST_${artist.name}`)}
            >
              {/* Image Container */}
              <div style={{
                width: '100%',
                aspectRatio: '1/1',
                borderRadius: '12px',
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative'
              }}>
                {artist.localImagePath ? (
                  <img src={artist.localImagePath} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                )}
              </div>
              
              {/* Text Meta */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {artist.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  {artist.trackIds.length} tracks
                </span>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};
