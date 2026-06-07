import React from 'react';
import { Track, CustomPlaylist } from '../types'; // Adjust path if needed
import { Heart, Play, Plus, Trash2 } from 'lucide-react';

interface PlaylistGalleryProps {
  playlist: Track[];
  favoritesSet: Set<string>;
  customPlaylists: CustomPlaylist[];
  albumArt: string | null;
  setCurrentView: (view: string) => void;
  createPlaylist: (name: string) => void;
  deletePlaylist: (id: string) => void;
}

export const PlaylistGalleryView: React.FC<PlaylistGalleryProps> = ({
  playlist,
  favoritesSet,
  customPlaylists,
  albumArt,
  setCurrentView,
  createPlaylist,
  deletePlaylist
}) => {
  return (
    <div className="playlist-gallery fade-in" style={{ height: '100%', overflowY: 'auto', paddingBottom: '120px' }}>
      {/* TIER 1: The Smart Card Carousel */}
      <div className="smart-carousel-wrapper">
        <div className="smart-card" onClick={() => setCurrentView('ALL')}>
          <div className="smart-card-art grid-art">
            {playlist.slice(0, 4).map((t, i) => (
              <div key={i} className="mini-art-tile" style={{ backgroundImage: `url(${t.thumb || albumArt || ''})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            ))}
          </div>
          <p className="smart-title">Recently added</p>
          <p className="smart-count">{playlist.length} tracks</p>
        </div>

        <div className="smart-card" onClick={() => setCurrentView('FAVORITES')}>
          <div className="smart-card-art grid-art">
            {playlist.filter(t => favoritesSet.has(t.path)).slice(0, 4).map((t, i) => (
              <div key={i} className="mini-art-tile" style={{ backgroundImage: `url(${t.thumb || albumArt || ''})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            ))}
            {playlist.filter(t => favoritesSet.has(t.path)).length === 0 && (
              <div className="fav-heart-icon" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Heart size={24} fill="currentColor" strokeWidth={0} /></div>
            )}
          </div>
          <p className="smart-title">Favourite tracks</p>
          <p className="smart-count">{favoritesSet.size} tracks</p>
        </div>

        <div className="smart-card" onClick={() => setCurrentView('TOPTRACKS')}>
          <div className="smart-card-art grid-art">
            {playlist.filter(t => (t.playCount || 0) > 0).sort((a,b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 4).map((t, i) => (
              <div key={i} className="mini-art-tile" style={{ backgroundImage: `url(${t.thumb || albumArt || ''})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            ))}
            {playlist.filter(t => (t.playCount || 0) > 0).length === 0 && (
              <div className="play-icon" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Play size={24} fill="currentColor" strokeWidth={0} /></div>
            )}
          </div>
          <p className="smart-title">Most played</p>
          <p className="smart-count">{playlist.filter(t => (t.playCount || 0) > 0).length} tracks</p>
        </div>
      </div>

      {/* TIER 2: The Custom Playlists Header */}
      <div className="custom-playlist-header">
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>My Playlists</h2>
        <button className="samsung-add-playlist-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => {
          const name = prompt("Enter playlist name:");
          if (name) createPlaylist(name);
        }}><Plus size={18} /></button>
      </div>

      {/* TIER 3: The Custom Playlists List */}
      <div className="custom-playlist-list">
        {customPlaylists.length === 0 ? (
          <p style={{ opacity: 0.5, fontSize: '14px', marginTop: '16px' }}>No custom playlists yet.</p>
        ) : (
          customPlaylists.map(pl => (
            <div key={pl.id} className="samsung-list-item" onClick={() => setCurrentView(`PLAYLIST_${pl.id}`)}>
              <div className="samsung-list-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </div>
              <div className="samsung-list-text">
                <p className="samsung-list-title">{pl.name}</p>
                <p className="samsung-list-count">{pl.trackPaths.length} tracks</p>
              </div>
              <button className="delete-pl-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); deletePlaylist(pl.id); }}><Trash2 size={16} /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};