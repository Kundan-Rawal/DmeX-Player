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
          <button className="play-main" onClick={e => { e.stopPropagation(); handlePlayPause(); }}>
            {isPlaying ? <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M5.163 3.819C5 4.139 5 4.559 5 5.4v13.2c0 .84 0 1.26.164 1.581a1.5 1.5 0 0 0 .655.655c.32.164.74.164 1.581.164h.2c.84 0 1.26 0 1.581-.163a1.5 1.5 0 0 0 .655-.656c.164-.32.164-.74.164-1.581V5.4c0-.84 0-1.26-.163-1.581a1.5 1.5 0 0 0-.656-.656C17.861 3 17.441 3 16.6 3h-.2c-.84 0-1.26 0-1.581.163a1.5 1.5 0 0 0-.655.656z" /></svg> : <svg viewBox="-3 0 28 28" width="1em" height="1em" fill="currentColor"><path d="M440.415,583.554 L421.418,571.311 C420.291,570.704 419,570.767 419,572.946 L419,597.054 C419,599.046 420.385,599.36 421.418,598.689 L440.415,586.446 C441.197,585.647 441.197,584.353 440.415,583.554" transform="translate(-419.000000, -571.000000)" /></svg>}
          </button>
          <button className="control-btn" onClick={e => { e.stopPropagation(); handleNext(); }}><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg></button>
        </div>
      </div>
    </div>
  );
};