import React, { useMemo } from 'react';
import Marquee from 'react-fast-marquee';
import { Taste } from '../../types'; 
import { AudioProfile } from '../../config/audio';
import { formatTime } from '../../utils/formatters';
import { Settings2, Disc } from 'lucide-react';

import { HDCrystalIcon } from './HDCrystalIcon';
import { ImmersiveIcon } from './ImmersiveIcon';
import { ChillIcon } from './ChillIcon';



// Exported so MobileExpandedPlayer can type its handler without duplicating the list.
export { ACOUSTIC_ENVIRONMENTS, HEADPHONE_MODELS } from '../../config/audioAssets';
import { ACOUSTIC_ENVIRONMENTS, HEADPHONE_MODELS } from '../../config/audioAssets';
import { AdvancedAudioPanel } from './AdvancedAudioPanel';

// Convenience aliases for backward compatibility
export const REVERB_ENVIRONMENTS = ACOUSTIC_ENVIRONMENTS;
export type ReverbEnv = typeof ACOUSTIC_ENVIRONMENTS[number];
export type HeadphoneModel = typeof HEADPHONE_MODELS[number];


// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT 1: DSP STUDIO
// ─────────────────────────────────────────────────────────────────────────────
interface DSPStudioProps {
  isRemastered: boolean; setIsRemastered: (v: boolean) => void;
  isCompressed: boolean; setIsCompressed: (v: boolean) => void;
  selectedAcousticEnv: string; setSelectedAcousticEnv: (v: string) => void;
  isEnvDropdownOpen: boolean; setIsEnvDropdownOpen: (v: boolean) => void;
  upscaleDrive: number; setUpscaleDrive: (v: number) => void;
  widenWidth: number; setWidenWidth: (v: number) => void;
  spatialExtra: number; setSpatialExtra: (v: number) => void;
  depthAmount: number; setDepthAmount: (v: number) => void;
  reverbWet: number; setReverbWet: (v: number) => void;
  restorationDenoise: number; setRestorationDenoise: (v: number) => void;
  restorationUpscale: number; setRestorationUpscale: (v: number) => void;
  restorationPresence: number; setRestorationPresence: (v: number) => void;
  setIsManualOverride: (v: boolean) => void;
  setSmartTaste: (v: Taste) => void;
  setBassLevel: (v: number) => void;
  setTrebleLevel: (v: number) => void;
  writeToEngine: (cmd: string) => Promise<void>;
  is9DStageOn?: boolean;
  setIs9DStageOn?: (v: boolean) => void;
  is9DBassRoom?: boolean;
  setIs9DBassRoom?: (v: boolean) => void;
  selectedHeadphoneModel?: string;
  setSelectedHeadphoneModel?: (v: string) => void;
  onHeadphoneModelSelect?: (modelId: string) => Promise<void>;

  // ── ANDROID ESCAPE HATCH ──────────────────────────────────────────────────
  // When provided, DSPStudio delegates ALL acoustic-environment loading to this
  // callback instead of running its internal resolveResource (Windows-only) path.
  //
  // On Android, resources live inside the APK and have no accessible filesystem
  // path, so resolveResource() returns a useless string. The Android caller
  // (MobileExpandedPlayer) must supply a handler that:
  //   1. fetch()es the .wav from the bundled asset URL
  //   2. writes the binary to AppData via plugin-fs
  //   3. hands the real physical path to writeToEngine
  //
  // On Windows this prop is simply omitted and the internal logic runs as before.
  onEnvSelect?: (env: ReverbEnv) => Promise<void>;
}

export const DSPStudio = (props: DSPStudioProps) => <div className="studio-dashboard fade-in">
  <AdvancedAudioPanel onManualEdit={() => { props.setIsManualOverride(true); props.setSmartTaste('ORIGINAL'); }} />
</div>;

interface ExpandedControlsProps {
  trackTitle: string; trackArtist: string; isAnalyzing: boolean; isManualOverride: boolean;
  detectedProfile: AudioProfile | null; smartTaste: Taste; handleTasteChange: (t: Taste) => Promise<void>;
  volume: number; setVolume: (v: number) => void; writeToEngine: (cmd: string) => Promise<void>;
  isCurrentFavorite: boolean; toggleFavorite: (e: React.MouseEvent) => Promise<void>;
  showLyrics: boolean; setShowLyrics: (v: boolean) => void;
  showStudio: boolean; setShowStudio: (v: boolean) => void;
  duration: number; currentTime: number; isSeekingRef: React.MutableRefObject<boolean>;
  handleSeekDrag: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSeekCommit: (e: React.MouseEvent | React.TouchEvent) => Promise<void>;
  isShuffle: boolean; handleToggleShuffle: (e?: React.MouseEvent) => void;
  handlePrev: () => void; isPlaying: boolean; handlePlayPause: () => Promise<void>;
  handleNext: () => void; handleToggleRepeat: (e?: React.MouseEvent) => void;
  repeatDeg: number; repeatMode: 'OFF' | 'ALL' | 'ONE'; repeatBusy: boolean;
  visMode?: 'ORBIT' | 'RADAR';
}

export const ExpandedControls = ({
  trackTitle, trackArtist, isAnalyzing, isManualOverride, detectedProfile, smartTaste, handleTasteChange,
  volume, setVolume, writeToEngine, isCurrentFavorite, toggleFavorite, showLyrics, setShowLyrics,
  showStudio, setShowStudio, duration, currentTime, isSeekingRef, handleSeekDrag, handleSeekCommit,
  isShuffle, handleToggleShuffle, handlePrev, isPlaying, handlePlayPause, handleNext, handleToggleRepeat,
  repeatDeg, repeatMode, repeatBusy
}: ExpandedControlsProps) => {

  // 1. INJECT ZERO-WIDTH SPACES FOR EMPTY STATES
  const safeTitle = trackTitle && trackTitle.trim() !== '' ? trackTitle : '\u200B';
  const safeArtist = trackArtist && trackArtist.trim() !== '' ? trackArtist : '\u200B';

  const isLong = safeTitle.length > 25;
  const artistIsLong = safeArtist.length > 30;

  // 2. APPLY TO MARQUEES
  const TitleMarquee = useMemo(() => (
    isLong
      ? <div className="marquee-container scrolling" key={"title-"+safeTitle}><Marquee speed={40} gradient={false} delay={1.5}><h1 className="ep-title" style={{paddingRight:'60px',margin:0}}>{safeTitle}</h1></Marquee></div>
      : <div className="marquee-container" key={"title-"+safeTitle}><h1 className="ep-title">{safeTitle}</h1></div>
  ), [isLong, safeTitle]);

  const ArtistMarquee = useMemo(() => (
    artistIsLong
      ? <div className="ep-artist-marquee scrolling" key={"artist-"+safeArtist}><Marquee speed={35} gradient={false} delay={1.5}><h2 className="ep-artist" style={{paddingRight:'60px',margin:0}}>{safeArtist}</h2></Marquee></div>
      : <div className="ep-artist-marquee" key={"artist-"+safeArtist}><h2 className="ep-artist">{safeArtist}</h2></div>
  ), [artistIsLong, safeArtist]);



  const TASTES: { id: Taste; icon: React.ReactNode; label: string }[] = [
    { 
      id: 'QUALITY',   
      icon: (
        <HDCrystalIcon 
          isActive={smartTaste === 'QUALITY'} 
        />
      ), 
      label: 'HD Clear'
    },
    { 
      id: 'IMMERSIVE', 
      icon: <ImmersiveIcon isActive={smartTaste === 'IMMERSIVE'} />, 
      label: 'Immersive' 
    },
    { 
      id: 'CHILL',     
      icon: <ChillIcon isActive={smartTaste === 'CHILL'} />, 
      label: 'Chill'     
    },
  ];

  return (
    <div className="ep-controls-section">
      <div className="ep-track-header">
        {TitleMarquee}
        {ArtistMarquee}
      </div>
      
      <div className="player-smart-section">
        <div className="player-profile-line">
          {isAnalyzing?<span className="profile-analyzing"><span className="dot-pulse"/> Analyzing…</span>
            :isManualOverride?<span className="profile-chip" style={{color:'#ffa726',background:'rgba(255,167,38,0.15)', display: 'inline-flex', alignItems: 'center', gap: '4px'}}><Settings2 size={16} /> Manual Override Active</span>
            :detectedProfile?<span className="profile-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>Identified: {detectedProfile.icon && React.createElement(detectedProfile.icon as any, {size: 16})} {detectedProfile.label}</span>
            :<span className="profile-chip muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Disc size={16} /> Standard Audio</span>}
        </div>
        <div className="player-taste-pills" style={{opacity:isManualOverride?0.4:1,transition:'opacity 0.2s ease'}}>
          {TASTES.map(t=>(
            <button key={t.id} className={`taste-pill ${!isManualOverride&&smartTaste===t.id?'active':''}`} onClick={()=>handleTasteChange(t.id)}>
              <span>{t.icon}</span> <span className='mainclasstastepilllabel'>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ep-volume-row">
        <button className="vol-btn" onClick={async()=>{const v=Math.max(0,volume-0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg></button>
        <input type="range" className="ep-volume-slider" min="0" max="1" step="0.02" value={volume} onChange={async e=>{const v=parseFloat(e.target.value);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}/>
        <button className="vol-btn" onClick={async()=>{const v=Math.min(1,volume+0.1);setVolume(v);await writeToEngine(`VOLUME ${v}`);}}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>
        <span className="vol-pct">{Math.round(volume*100)}%</span>
      </div>
      
      <div className="ep-actions">
        <button className="ep-icon-btn" onClick={toggleFavorite} style={{color:isCurrentFavorite?'var(--theme-color)':undefined}}>{isCurrentFavorite?
        <svg  width="20" height="20" viewBox="0 0 24 24"><title >heart</title><path fill="currentColor" d="m12 21.35l-1.45-1.32C5.4 15.36 2 12.27 2 8.5C2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53z"/></svg>
        :<svg  width="20" height="20" viewBox="0 0 24 24"><title >heart-outline</title><path fill="currentColor" d="m12.1 18.55l-.1.1l-.11-.1C7.14 14.24 4 11.39 4 8.5C4 6.5 5.5 5 7.5 5c1.54 0 3.04 1 3.57 2.36h1.86C13.46 6 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5c0 2.89-3.14 5.74-7.9 10.05M16.5 3c-1.74 0-3.41.81-4.5 2.08C10.91 3.81 9.24 3 7.5 3C4.42 3 2 5.41 2 8.5c0 3.77 3.4 6.86 8.55 11.53L12 21.35l1.45-1.32C18.6 15.36 22 12.27 22 8.5C22 5.41 19.58 3 16.5 3"/></svg>}</button>
        <button className="ep-icon-btn" onClick={e => { e.stopPropagation(); setShowLyrics(!showLyrics); setShowStudio(false); }} style={{ color: showLyrics ? 'var(--theme-color)' : undefined }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M3.577 19.577V4.616q0-.672.472-1.144T5.192 3h9.77q.67 0 1.143.472q.472.472.472 1.144v.251q-.293.14-.533.32q-.24.179-.467.39v-.961q0-.27-.173-.443T14.96 4H5.192q-.269 0-.442.173t-.173.443v12.54L5.733 16h9.229q.269 0 .442-.173t.173-.442v-2.962q.227.212.467.39q.24.18.533.32v2.252q0 .67-.472 1.143q-.472.472-1.143.472H6.154zm3.5-6.077h3v-1h-3zm11.539-2q-1.039 0-1.77-.73T16.116 9t.73-1.77t1.77-.73q.486 0 .823.137t.677.461V1.5h3v1h-2V9q0 1.039-.731 1.77q-.731.73-1.77.73m-11.538-1h6v-1h-6zm0-3h6v-1h-6zm-2.5 8.5V4z"/></svg>
        </button>
        <button className="ep-icon-btn" onClick={e => { e.stopPropagation(); setShowStudio(!showStudio); setShowLyrics(false); }} style={{ color: showStudio ? 'var(--theme-color)' : undefined }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
        </button>
      </div>
      <div className="ep-progress-container">
        <input type="range" className="ep-progress-bar" min="0" max={duration||1} value={currentTime} onPointerDown={()=>isSeekingRef.current=true} onChange={handleSeekDrag} onPointerUp={handleSeekCommit}/>
        <div className="ep-time-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>
      <div className="ep-main-controls">
        <button className="ep-ctrl-btn no-touch-effects" onClick={handleToggleShuffle}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 3 8 C 9 8 13 16 20 16":"M 3 8 C 9 8 13 8 20 8"}/>
            <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 3 16 C 9 16 13 8 20 8":"M 3 16 C 9 16 13 16 20 16"}/>
            <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 17 13 L 20 16 L 17 19":"M 17 5 L 20 8 L 17 11"}/>
            <path style={{transition:'d 0.42s cubic-bezier(.4,0,.2,1)'} as React.CSSProperties} d={isShuffle?"M 17 5 L 20 8 L 17 11":"M 17 13 L 20 16 L 17 19"}/>
          </svg>
        </button>
        <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handlePrev();}}><svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
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
        <button className="ep-ctrl-btn no-touch-effects" onClick={e=>{e.stopPropagation();handleNext();}}><svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
        <button className="ep-ctrl-btn no-touch-effects" onClick={handleToggleRepeat}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform:`rotate(${repeatDeg}deg)`,transition:'transform 0.52s cubic-bezier(.4,0,.2,1)'}}>
            <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            <path style={{transition:'d 0.38s cubic-bezier(.4,0,.2,1), stroke-width 0.3s',strokeWidth:repeatMode==='ONE'?2.2:1.8} as React.CSSProperties} d={repeatBusy?"M 12 12 L 12 12 L 12 12":repeatMode==='OFF'?"M 6 18 L 12 12 L 18 6":repeatMode==='ALL'?"M 12 12 L 12 12 L 12 12":"M 11 10 L 12 8 L 12 15"}/>
          </svg>
        </button>
      </div>
    </div>
  );
};
