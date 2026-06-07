// import React from 'react';
import { ArtistProfile } from '../../utils/artistEngine';

interface ArtistCardProps {
  artist: ArtistProfile;
  onClick: (artistId: string) => void;
}

export const ArtistCard = ({ artist, onClick }: ArtistCardProps) => {
  return (
    <div 
      className="artist-card-root"
      onClick={() => onClick(artist.id)}
    >
      {/* 1. The Square Image Container */}
      <div className="artist-card-art">
        {artist.localImagePath ? (
           <img src={artist.localImagePath} alt={artist.name} loading="lazy" />
        ) : (
           // THE OFFLINE-FIRST PLACEHOLDER
           <div className="artist-placeholder">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
               <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
               <circle cx="12" cy="7" r="4"></circle>
             </svg>
           </div>
        )}
      </div>

      {/* 2. Text strictly outside the image box */}
      <div className="artist-card-info">
        <span className="artist-card-name">{artist.name}</span>
        <span className="artist-card-count">{artist.trackIds.length} tracks</span>
      </div>
    </div>
  );
};