import React from 'react';
import Marquee from 'react-fast-marquee';
import { IS_ANDROID } from '../../types';
import { AudioProfile } from '../../config/audio';

interface MiniPlayerProps {
  isExpanded: boolean;
  setIsExpanded: (val: boolean) => void;
  duration: number;
  currentTime: number;
  isSeekingRef: React.MutableRefObject<boolean>;
  handleSeekDrag: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSeekCommit: (e: React.MouseEvent | React.TouchEvent) => void;
  albumArt: string | null;
  trackTitle: string;
  trackArtist: string;
  detectedProfile: AudioProfile | null;
  isPlaying: boolean;
  handlePlayPause: () => void;
  handlePrev: () => void;
  handleNext: () => void;
}

export const MiniPlayer = ({
  isExpanded, setIsExpanded, duration, currentTime, isSeekingRef,
  handleSeekDrag, handleSeekCommit, albumArt, trackTitle, trackArtist,
  detectedProfile, isPlaying, handlePlayPause, handlePrev, handleNext
}: MiniPlayerProps) => {
  return (
    <div className="mini-player-content" style={{
      opacity: isExpanded ? 0 : 1,
      pointerEvents: isExpanded ? 'none' : 'auto',
      position: isExpanded ? 'absolute' : 'relative',
      width: '100%',
      transition: 'opacity 0.2s ease',
      zIndex: 1
    }}>
      <div className="progress-container mini">
        <input type="range" className="progress-bar" min="0" max={duration || 1} value={currentTime} onPointerDown={() => isSeekingRef.current = true} onChange={handleSeekDrag} onPointerUp={handleSeekCommit} onClick={e => e.stopPropagation()} />
      </div>
      <div className="player-interface">
        <div className="track-info" onClick={() => setIsExpanded(true)}>
          {/* THE EMOJI PURGE: Removed the 🎵 span completely */}
          <div className="art-circle" style={{ backgroundImage: albumArt ? `url(${albumArt})` : 'none', backgroundColor: albumArt ? 'transparent' : 'rgba(255,255,255,0.05)' }}></div>
          
          <div className="mini-text-block">
            {/* THE TITLE MARQUEE FIX */}
            {trackTitle.length > 22 ? (
              IS_ANDROID ? (
                <div className="mini-marquee-clip scrolling">
                  <div className="mini-marquee-inner">
                    <span className="track-title" style={{ paddingRight: '48px' }}>{trackTitle}</span>
                    <span className="track-title" style={{ paddingRight: '48px' }}>{trackTitle}</span>
                  </div>
                </div>
              ) : (
                <div className="mini-marquee-clip scrolling">
                  <Marquee speed={35} gradient={false} delay={1}>
                    <span className="track-title" style={{ paddingRight: '48px' }}>{trackTitle}</span>
                  </Marquee>
                </div>
              )
            ) : (
              <div className="mini-marquee-clip"><span className="track-title">{trackTitle}</span></div>
            )}
            
            {/* THE ARTIST MARQUEE FIX */}
            {trackArtist.length > 26 ? (
              IS_ANDROID ? (
                <div className="mini-marquee-clip scrolling">
                  <div className="mini-marquee-inner" style={{ animationDuration: '14s' }}>
                    <span className="artist-subtitle" style={{ paddingRight: '48px' }}>{trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}</span>
                    <span className="artist-subtitle" style={{ paddingRight: '48px' }}>{trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}</span>
                  </div>
                </div>
              ) : (
                <div className="mini-marquee-clip scrolling">
                  <Marquee speed={30} gradient={false} delay={1}>
                    <span className="artist-subtitle" style={{ paddingRight: '48px' }}>{trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}</span>
                  </Marquee>
                </div>
              )
            ) : (
              <div className="mini-marquee-clip"><span className="artist-subtitle">{trackArtist}{detectedProfile && <span className="mini-profile"> {detectedProfile.icon}</span>}</span></div>
            )}
          </div>

        </div>
        <div className="controls">
          <button className="control-btn" onClick={e => { e.stopPropagation(); handlePrev(); }}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg></button>
          <button style={{ background: 'transparent', border: 'none', cursor: 'pointer' }} className="your-play-btn-class" onClick={handlePlayPause}>
            <svg 
              width="36" 
              height="36" 
              viewBox="0 0 24 24" /* DO NOT TOUCH THIS. This is the math grid. */
              fill="currentColor"
              style={{ background: 'transparent' }} 
            >
              <path
                style={{ transition: 'd 0.35s cubic-bezier(0.68, -0.55, 0.265, 1.55)' }} 
                d={isPlaying 
                  // PAUSE STATE (Two bars)
                  ? "M 6 5 L 9 5 L 9 19 L 6 19 Z M 14 5 L 17 5 L 17 19 L 14 19 Z" 
                  // PLAY STATE (Right bar stretches to a point and merges with the left)
                  : "M 6 5 L 9 5 L 9 19 L 6 19 Z M 9 5 L 19 12 L 19 12 L 9 19 Z"
                }
              />
            </svg>
          </button>
          <button className="control-btn" onClick={e => { e.stopPropagation(); handleNext(); }}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg></button>
        </div>
      </div>
    </div>
  );
};