import './MobileExpandedPlayer.css';

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import Marquee from 'react-fast-marquee';
import { DSPStudio, ReverbEnv } from './ExpandedPlayerUI';
import { AmbientBackground } from './AmbientBackground';
import { Taste, LyricLine } from '../../types/index';
import { AudioProfile } from '../../config/audio';
import { formatTime } from '../../utils/formatters';
import { HDCrystalIcon } from './HDCrystalIcon';
import { ImmersiveIcon } from './ImmersiveIcon';
import { ChillIcon } from './ChillIcon';
import { triggerHapticClick } from '../../utils/helpers';
import { Disc, Music, Search, Hourglass } from 'lucide-react';
import { appDataDir, join, resolveResource } from '@tauri-apps/api/path';

import { writeFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';


interface MobileExpandedPlayerProps {
  trackTitle: string; trackArtist: string; albumArt: string | null;
  isPlaying: boolean; currentTime: number; duration: number;
  isShuffle: boolean; repeatMode: 'OFF'|'ALL'|'ONE'; repeatDeg: number; repeatBusy: boolean;
  isAnalyzing: boolean; isManualOverride: boolean; detectedProfile: AudioProfile | null;
  smartTaste: Taste; isCurrentFavorite: boolean;
  lyrics: LyricLine[]; activeLyricIndex: number; scanProgress: string;
  isRemastered: boolean;       setIsRemastered: (v: boolean) => void;
  isCompressed: boolean;       setIsCompressed: (v: boolean) => void;
  selectedAcousticEnv: string; setSelectedAcousticEnv: (v: string) => void;
  isEnvDropdownOpen: boolean;  setIsEnvDropdownOpen: (v: boolean) => void;
  upscaleDrive: number;        setUpscaleDrive: (v: number) => void;
  widenWidth: number;          setWidenWidth: (v: number) => void;
  spatialExtra: number;        setSpatialExtra: (v: number) => void;
  reverbWet: number;           setReverbWet: (v: number) => void;
  setBassLevel: (v: number) => void; setIsManualOverride: (v: boolean) => void; setSmartTaste: (v: Taste) => void;
  isProfileActive: boolean;    setIsProfileActive: (v: boolean) => void;
  isProfileActiveRef: React.MutableRefObject<boolean>;
  applySmartSettings: (profile: AudioProfile, taste: Taste) => Promise<void>;
  smartTasteRef: React.MutableRefObject<Taste>;
  bassLevel: number; bassLevelRef: React.MutableRefObject<number>;
  speakerMode: 'NONE'|'LOW'|'MED'|'HIGH'; setSpeakerMode: (v: 'NONE'|'LOW'|'MED'|'HIGH') => void;
  isFIRMode: boolean; setIsFIRMode: (v: boolean) => void;
  visMode: 'ORBIT'|'RADAR'; setVisMode: (v: 'ORBIT'|'RADAR') => void;
  isPhoneSpeaker: boolean; setIsPhoneSpeaker: (v: boolean) => void;
  isPhoneSpeakerRef: React.MutableRefObject<boolean>;
  isExpandedRef: React.MutableRefObject<boolean>;
  audioLevelRef: React.MutableRefObject<number>;
  spatialData: React.MutableRefObject<any>;
  themeColor: string; isDarkMode: boolean; audioLevel: number;
  onClose: () => void; onPlayPause: () => Promise<void>;
  onNext: () => void; onPrev: () => void;
  onToggleShuffle: (e?: React.MouseEvent) => void;
  onToggleRepeat: (e?: React.MouseEvent) => void;
  onToggleFavorite: (e: React.MouseEvent) => Promise<void>;
  onSeekDrag: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekCommit: (e: React.MouseEvent | React.TouchEvent) => Promise<void>;
  onTasteChange: (t: Taste) => Promise<void>;
  onFetchLyrics: () => Promise<void>;
  writeToEngine: (cmd: string) => Promise<void>;
  isSeekingRef: React.MutableRefObject<boolean>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
}

export const MobileExpandedPlayer: React.FC<MobileExpandedPlayerProps> = (p) => {


  // 2. Define the TASTES array
  const TASTES: { id: Taste; icon: React.ReactNode; label: string }[] = [
  { 
    id: 'QUALITY',   
    icon: (
        <HDCrystalIcon 
          isActive={p.smartTaste === 'QUALITY'} // Fixed: Changed 'props' to 'p'
        />
      ), 
      label: 'HD Clear'
  },
  { 
    id: 'IMMERSIVE', 
    icon: <ImmersiveIcon isActive={p.smartTaste === 'IMMERSIVE'} />, 
    label: 'Immersive' 
  },
  { 
    id: 'CHILL',     
    icon: <ChillIcon isActive={p.smartTaste === 'CHILL'} />, 
    label: 'Chill'     
  },
];
  const [panel, setPanel] = useState<'none'|'lyrics'|'dsp'>('none');
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const prevPressRef = useRef<number>(0);
  const nextPressRef = useRef<number>(0);
  const scrubIntervalRef = useRef<any>(null);
  const scrubStartOffsetRef = useRef<number>(0);

  useEffect(() => {
    if (panel !== 'lyrics' || !lyricsRef.current || p.activeLyricIndex < 0) return;
    const el = lyricsRef.current.children[p.activeLyricIndex] as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [p.activeLyricIndex, panel]);

  const safeTitle  = p.trackTitle?.trim()  || '\u200B';
  const safeArtist = p.trackArtist?.trim() || '\u200B';

  const TitleNode = useMemo(() => (
    safeTitle.length > 22
      ? <Marquee speed={38} gradient={false} delay={1.5}><h1 className="mep-title" style={{ paddingRight: 60, margin: 0 }}>{safeTitle}</h1></Marquee>
      : <h1 className="mep-title">{safeTitle}</h1>
  ), [safeTitle]);

  const ArtistNode = useMemo(() => (
    safeArtist.length > 28
      ? <Marquee speed={32} gradient={false} delay={1.5}><span className="mep-artist" style={{ paddingRight: 60 }}>{safeArtist}</span></Marquee>
      : <span className="mep-artist">{safeArtist}</span>
  ), [safeArtist]);

  const panelOpen = panel !== 'none';


  // ─────────────────────────────────────────────────────────────────────────
  // ANDROID ACOUSTIC ENVIRONMENT HANDLER
  //
  // On Android, impulse-response .wav files are packed inside the APK and are
  // NOT accessible by a filesystem path.  resolveResource() (the Windows path
  // used inside DSPStudio) returns a string the native audio engine can't open.
  //
  // Strategy:
  //   1. fetch() the file from the bundled asset URL — Tauri/WebView serves
  //      APK assets at their relative path (e.g. "resources/impulses/foo.wav").
  //   2. Write the raw bytes to AppData/dsp_cache/ using plugin-fs.
  //   3. Build the absolute physical path via appDataDir() + join().
  //   4. Hand that real path to the C++ engine with LOAD_IR / LOAD_IR_DUAL.
  //   5. Send CONVOLUTION 0.35 and update UI state to match the Windows path.
  //
  // This function is passed to DSPStudio as the `onEnvSelect` prop.
  // DSPStudio calls it instead of its internal resolveResource handler whenever
  // the prop is present, so no DSPStudio internals need to change per-platform.
  // ─────────────────────────────────────────────────────────────────────────

  /** Extract one IR file from the APK bundle to the physical filesystem.
   *  Returns the absolute path on the device that the C++ engine can open. */
  const extractIRFile = useCallback(async (assetPath: string): Promise<string> => {
    // Resolve the resource path to an internal asset URL so the WebView can read inside the APK
    const assetUrl = await resolveResource(assetPath);
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch IR asset: ${assetPath} (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Keep it as raw binary — never convert to Array or string
    const uint8Array = new Uint8Array(arrayBuffer);
    const filename = assetPath.split('/').pop() || 'fallback_ir.wav';

    // Ensure the cache directory exists
    const dspDirExists = await exists('dsp_cache', { baseDir: BaseDirectory.AppData });
    if (!dspDirExists) {
      await mkdir('dsp_cache', { baseDir: BaseDirectory.AppData, recursive: true });
    }

    // Write directly to flash storage (bypasses JSON IPC size limits)
    await writeFile(`dsp_cache/${filename}`, uint8Array, { baseDir: BaseDirectory.AppData });

    // Build and return the physical path the C++ engine can use
    const baseAppDir = await appDataDir();
    return await join(baseAppDir, 'dsp_cache', filename);
  }, []);

  /**
   * Full Android handler passed to DSPStudio as `onEnvSelect`.
   * Matches the ReverbEnv type exported from ExpandedPlayerUI.
   *
   * Handles:
   *   - "Off" (id === 'NONE') → clear IR and reset state
   *   - Mono IR  (single path)  → LOAD_IR <physicalPath>
   *   - Stereo IR (path has '|') → LOAD_IR_DUAL <pathL>|<pathR>
   * Then fires CONVOLUTION 0.35 and sets manual-override state, identical to
   * the Windows path in DSPStudio so behavior is 1:1 across platforms.
   */
  const handleAcousticEnvSelect = useCallback(async (env: ReverbEnv) => {
    // Update dropdown display immediately so the UI feels responsive
    p.setSelectedAcousticEnv(env.id);

    // ── "Off" selected ──────────────────────────────────────────────────────
    if (env.id === 'NONE' || !env.path) {
      await p.writeToEngine('LOAD_IR ');       // clear the IR buffer
      await p.writeToEngine('CONVOLUTION 0.0');
      p.setIsManualOverride(false);
      return;
    }

    // ── Load IR from APK bundle ─────────────────────────────────────────────
    try {
      if (env.path.includes('|')) {
        // Stereo / dual-channel IR (e.g. Dolby Atmos, Sony WH1000XM2)
        const [pathL, pathR] = env.path.split('|');
        const [physL, physR] = await Promise.all([
          extractIRFile(pathL),
          extractIRFile(pathR),
        ]);
        await p.writeToEngine(`LOAD_IR_DUAL ${physL}|${physR}`);
      } else {
        // Standard mono IR
        const physicalPath = await extractIRFile(env.path);
        await p.writeToEngine(`LOAD_IR ${physicalPath}`);
      }

      // Activate convolution and update UI state — mirrors the Windows path exactly
      await p.writeToEngine('CONVOLUTION 0.35');
      p.setIsManualOverride(true);
      p.setSmartTaste('QUALITY' as Taste);
    } catch (error) {
      console.error('[Android] Failed to extract and load IR file:', error);
    }
  }, [extractIRFile, p.writeToEngine, p.setSelectedAcousticEnv, p.setIsManualOverride, p.setSmartTaste]);

  return (
    <div className="mep-root">
      <AmbientBackground
        isExpandedRef={p.isExpandedRef} audioLevelRef={p.audioLevelRef} spatialData={p.spatialData} visMode={p.visMode}
        themeColor={p.themeColor} isDarkMode={p.isDarkMode} audioLevel={p.audioLevel}
      />

      {/* ── TOP BAR ──────────────── */}
      <div className="mep-topbar">
        <button className="mep-topbar-btn" onClick={p.onClose} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div className="mep-topbar-center"
          onClick={() => {
            if (!p.detectedProfile) return;
            const next = !p.isProfileActive;
            p.setIsProfileActive(next);
            p.isProfileActiveRef.current = next;
            p.applySmartSettings(p.detectedProfile, p.smartTasteRef.current);
          }}
          style={{ cursor: p.detectedProfile ? 'pointer' : 'default' }}
        >
          {p.isAnalyzing
            ? <span className="mep-badge-analyzing"><span className="mep-dot-pulse"/>Analyzing…</span>
            : p.isManualOverride
              ? <span className="mep-badge" style={{ color: '#ffa726' }}>Manual Override</span>
              : p.detectedProfile
                ? <span className="mep-badge">{p.detectedProfile.icon && React.createElement(p.detectedProfile.icon as any, {size: 14})} {p.detectedProfile.label}{!p.isProfileActive ? ' (Raw)' : ''}</span>
                : <span className="mep-badge mep-badge-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Disc size={14} /> Standard Audio</span>
          }
        </div>

        <button className={`mep-topbar-btn ${showOptionsMenu ? 'mep-topbar-btn--active' : ''}`}
          onClick={e => { e.stopPropagation(); setShowOptionsMenu(v => !v); }}>
          <svg width="4" height="20" viewBox="0 0 4 20" fill="currentColor">
            <circle cx="2" cy="2" r="2"/><circle cx="2" cy="10" r="2"/><circle cx="2" cy="18" r="2"/>
          </svg>
        </button>

        {showOptionsMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={e => { e.stopPropagation(); setShowOptionsMenu(false); }}/>
            <div className="glass-options-menu fade-in" style={{ top: '80px', right: '24px', zIndex: 100 }} onClick={e => e.stopPropagation()}>
              <div className="glass-menu-header">Track Options</div>
              
              <div className="glass-menu-section">
                <div className="glass-label-row"><span>Subwoofer Bass</span><span style={{ color: 'var(--theme-color)', fontWeight: 600 }}>{Math.round(p.bassLevel * 100)}%</span></div>
                <input type="range" className="glass-slider" min="0" max="1.5" step="0.05" value={p.bassLevel} onChange={e => { const v = parseFloat(e.target.value); p.setBassLevel(v); p.bassLevelRef.current = v; p.writeToEngine(`BASS ${v}`); }}/>
              </div>

              <div className="glass-menu-section" style={{ marginTop: 14 }}>
                <div className="glass-label-row" style={{ marginBottom: 10 }}>
                  <span>Speaker Boost</span>
                  <span style={{ color: p.speakerMode === 'NONE' ? 'var(--text-secondary)' : p.speakerMode === 'LOW' ? '#4fc3f7' : p.speakerMode === 'MED' ? '#ff9800' : '#ff3b30', fontWeight: 600, fontSize: '0.8rem' }}>
                    {p.speakerMode === 'NONE' ? 'Off' : p.speakerMode === 'LOW' ? '30%' : p.speakerMode === 'MED' ? '60%' : '100%'}
                  </span>
                </div>
                <div className="glass-boost-grid">
                  {(['NONE','LOW','MED','HIGH'] as const).map(mode => (
                    <button key={mode} className={`glass-boost-btn ${p.speakerMode === mode ? 'active' : ''}`}
                      style={p.speakerMode === mode ? { background: mode==='NONE'?'rgba(255,255,255,0.18)':mode==='LOW'?'rgba(79,195,247,0.25)':mode==='MED'?'rgba(255,152,0,0.25)':'rgba(255,59,48,0.28)', borderColor: mode==='NONE'?'rgba(255,255,255,0.35)':mode==='LOW'?'rgba(79,195,247,0.5)':mode==='MED'?'rgba(255,152,0,0.5)':'rgba(255,59,48,0.55)', color: mode==='NONE'?'#fff':mode==='LOW'?'#4fc3f7':mode==='MED'?'#ff9800':'#ff3b30' } : undefined}
                      onClick={() => { p.setSpeakerMode(mode); p.writeToEngine(`LIMITER ${mode==='NONE'?0:mode==='LOW'?0.3:mode==='MED'?0.6:1.0}`); }}>
                      {mode === 'NONE' ? 'None' : mode === 'LOW' ? 'Low' : mode === 'MED' ? 'Med' : 'High'}
                    </button>
                  ))}
                </div>
              </div>

              {/* RESTORED: VISUALIZER */}
              <div className="glass-menu-section" style={{ marginTop: 14 }}>
                <div className="glass-label-row" style={{ marginBottom: 10 }}><span>Background Visualizer</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{p.visMode === 'ORBIT' ? 'Lava Lamps' : '8B Fast'}</span></div>
                <div className="glass-boost-grid">
                  <button className={`glass-boost-btn ${p.visMode === 'ORBIT' ? 'active' : ''}`} style={p.visMode === 'ORBIT' ? { background: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' } : undefined} onClick={() => p.setVisMode('ORBIT')}>Orbit</button>
                  <button className={`glass-boost-btn ${p.visMode === 'RADAR' ? 'active' : ''}`} style={p.visMode === 'RADAR' ? { background: 'rgba(200,34,42,0.25)', borderColor: 'var(--theme-color)', color: 'var(--theme-color)' } : undefined} onClick={() => p.setVisMode('RADAR')}>8B</button>
                </div>
              </div>

              {/* RESTORED: EQ */}
              <div className="glass-menu-section" style={{ marginTop: 14 }}>
                <div className="glass-label-row" style={{ marginBottom: 6 }}><span>Audiophile EQ</span><span style={{ fontSize: '0.72rem', fontWeight: 600, color: p.isFIRMode ? '#a5d6a7' : 'var(--text-secondary)' }}>{p.isFIRMode ? '✦ Linear Phase' : 'Standard IIR'}</span></div>
                <div className="glass-boost-grid">
                  <button className={`glass-boost-btn ${!p.isFIRMode ? 'active' : ''}`} style={!p.isFIRMode ? { background: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' } : undefined} onClick={() => { p.setIsFIRMode(false); p.writeToEngine('FIRMODE 0'); }}>Standard</button>
                  <button className={`glass-boost-btn ${p.isFIRMode ? 'active' : ''}`} style={p.isFIRMode ? { background: 'rgba(165,214,167,0.2)', borderColor: '#a5d6a7', color: '#a5d6a7' } : undefined} onClick={() => { p.setIsFIRMode(true); p.writeToEngine('FIRMODE 1'); }}>✦ Audiophile</button>
                </div>
              </div>

              {/* RESTORED: HARDWARE OUTPUT */}
              <div className="glass-menu-section" style={{ marginTop: 14 }}>
                <div className="glass-label-row" style={{ marginBottom: 10 }}>
                  <span>Hardware Output</span>
                  <span style={{ color: 'var(--theme-color)', fontWeight: 600, fontSize: '0.8rem' }}>{p.isPhoneSpeaker ? 'Phone Speaker' : 'Headphones'}</span>
                </div>
                <div className="glass-boost-grid">
                  <button className={`glass-boost-btn ${!p.isPhoneSpeaker ? 'active' : ''}`} style={!p.isPhoneSpeaker ? { background: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' } : undefined} onClick={() => { p.setIsPhoneSpeaker(false); p.writeToEngine('ANDROID_SPEAKER 0'); }}>Headphones</button>
                  <button className={`glass-boost-btn ${p.isPhoneSpeaker ? 'active' : ''}`} style={p.isPhoneSpeaker ? { background: 'rgba(255,59,48,0.28)', borderColor: 'rgba(255,59,48,0.55)', color: '#ff3b30' } : undefined} onClick={() => { p.setIsPhoneSpeaker(true); p.writeToEngine('ANDROID_SPEAKER 1'); }}>Phone Speaker</button>
                </div>
              </div>

            </div>
          </>
        )}
      </div>

      {/* ── BODY CORE ENGINE ─────────────────────────────────────── */}
      <div className="mep-body">

        {/* =========================================================================
            THE ARCHITECTURAL FIX: Grouped Art, Title, Artist, and Pills.
            This entire block is swapped for Lyrics/DSP, keeping layout pure.
            ========================================================================= */}
        {!panelOpen ? (
          <div className="mep-dynamic-upper">
            
            {/* 1. Album Art */}
            <div className="mep-art-wrap">
              <div className="mep-art" style={{ backgroundImage: p.albumArt ? `url(${p.albumArt})` : 'none', backgroundColor: 'rgba(128,128,128,0.08)' }}>
                {!p.albumArt && <span className="mep-art-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music size={48} /></span>}
                {p.lyrics.length > 0 && <div className="lyrics-art-badge">Synced lyrics</div>}
              </div>
            </div>

            {/* 2. Title & Artist */}
            <div className="mep-track-header">
              <div className="mep-title-wrap">{TitleNode}</div>
              <div className="mep-artist-wrap">{ArtistNode}</div>
            </div>

            {/* 3. Taste Pills */}
            <div className="mep-taste-row" style={{ opacity: p.isManualOverride ? 0.4 : 1 }}>
              {TASTES.map(t => (
                <button key={t.id} className={`mep-taste-pill ${!p.isManualOverride && p.smartTaste === t.id ? 'mep-taste-pill--active' : ''}`} onClick={() => {triggerHapticClick(); p.onTasteChange(t.id)}}>
                  <span>{t.icon}</span> <span className='mainclasstastepilllabel'>{t.label}</span>
                </button>
              ))}
            </div>

          </div>
        ) : (
          <div className="mep-panel">
            {panel === 'lyrics' && (
              <div className="mep-lyrics-scroll" ref={lyricsRef}>
                {p.lyrics.length > 0 ? (
                  p.lyrics.map((line, i) => (
                    <p key={i} className={`mep-lyric-line ${i === p.activeLyricIndex ? 'mep-lyric-active' : ''}`}>{line.text}</p>
                  ))
                ) : (
                  <div className="mep-lyrics-empty">
                    <p className="mep-lyrics-empty-text">No synced lyrics available.</p>
                    <button className="mep-fetch-btn" style={{ opacity: p.scanProgress ? 0.6 : 1, pointerEvents: p.scanProgress ? 'none' : 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={p.onFetchLyrics}>
                      {p.scanProgress ? <><Hourglass size={14} /> {p.scanProgress}</> : <><Search size={14} /> Fetch Lyrics Online</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            {panel === 'dsp' && (
              <div className="mep-dsp-scroll">
                <DSPStudio
                  isRemastered={p.isRemastered}               setIsRemastered={p.setIsRemastered}
                  isCompressed={p.isCompressed}               setIsCompressed={p.setIsCompressed}
                  selectedAcousticEnv={p.selectedAcousticEnv} setSelectedAcousticEnv={p.setSelectedAcousticEnv}
                  isEnvDropdownOpen={p.isEnvDropdownOpen}     setIsEnvDropdownOpen={p.setIsEnvDropdownOpen}
                  upscaleDrive={p.upscaleDrive}               setUpscaleDrive={p.setUpscaleDrive}
                  widenWidth={p.widenWidth}                   setWidenWidth={p.setWidenWidth}
                  spatialExtra={p.spatialExtra}               setSpatialExtra={p.setSpatialExtra}
                  reverbWet={p.reverbWet}                     setReverbWet={p.setReverbWet}
                  setIsManualOverride={p.setIsManualOverride} setSmartTaste={p.setSmartTaste}
                  setBassLevel={p.setBassLevel}               writeToEngine={p.writeToEngine}
          
                  onEnvSelect={handleAcousticEnvSelect}
                />
              </div>
            )}
          </div>
        )}

        {/* ── FIXED CONTROLS ZONE — NEVER ROAMS ────────────────────── */}
        <div className="mep-controls-zone">
          <div className="mep-actions">
            <button className="mep-icon-btn" onClick={p.onToggleFavorite} style={{ color: p.isCurrentFavorite ? 'var(--theme-color)' : undefined }}>
              {p.isCurrentFavorite
                ? <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="m12 21.35-1.45-1.32C5.4 15.36 2 12.27 2 8.5C2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.08C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53z"/></svg>
                : <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="m12.1 18.55-.1.1-.11-.1C7.14 14.24 4 11.39 4 8.5C4 6.5 5.5 5 7.5 5c1.54 0 3.04 1 3.57 2.36h1.86C13.46 6 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5c0 2.89-3.14 5.74-7.9 10.05M16.5 3c-1.74 0-3.41.81-4.5 2.08C10.91 3.81 9.24 3 7.5 3C4.42 3 2 5.41 2 8.5c0 3.77 3.4 6.86 8.55 11.53L12 21.35l1.45-1.32C18.6 15.36 22 12.27 22 8.5C22 5.41 19.58 3 16.5 3"/></svg>
              }
            </button>
            <button className="mep-icon-btn" onClick={() => setPanel(prev => prev === 'lyrics' ? 'none' : 'lyrics')} style={{ color: panel === 'lyrics' ? 'var(--theme-color)' : undefined }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.577 19.577V4.616q0-.672.472-1.144T5.192 3h9.77q.67 0 1.143.472q.472.472.472 1.144v.251q-.293.14-.533.32q-.24.179-.467.39v-.961q0-.27-.173-.443T14.96 4H5.192q-.269 0-.442.173t-.173.443v12.54L5.733 16h9.229q.269 0 .442-.173t.173-.442v-2.962q.227.212.467.39q.24.18.533.32v2.252q0 .67-.472 1.143q-.472.472-1.143.472H6.154zm3.5-6.077h3v-1h-3zm11.539-2q-1.039 0-1.77-.73T16.116 9t.73-1.77t1.77-.73q.486 0 .823.137t.677.461V1.5h3v1h-2V9q0 1.039-.731 1.77q-.731.73-1.77.73m-11.538-1h6v-1h-6zm0-3h6v-1h-6zm-2.5 8.5V4z"/></svg>
            </button>
            <button className="mep-icon-btn" onClick={() => setPanel(prev => prev === 'dsp' ? 'none' : 'dsp')} style={{ color: panel === 'dsp' ? 'var(--theme-color)' : undefined }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            </button>
          </div>

          <div className="mep-seek">
            <input type="range" className="mep-seek-bar" min="0" max={p.duration || 1} value={p.currentTime} onPointerDown={() => { p.isSeekingRef.current = true; }} onTouchStart={() => { p.isSeekingRef.current = true; }} onChange={p.onSeekDrag} onPointerUp={p.onSeekCommit} onTouchEnd={p.onSeekCommit}/>
            <div className="mep-seek-labels"><span>{formatTime(p.currentTime)}</span><span>{formatTime(p.duration)}</span></div>
          </div>

          <div className="mep-playback">
            <button className="mep-ctrl-btn" onClick={p.onToggleShuffle}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={p.isShuffle ? 'M 3 8 C 9 8 13 16 20 16' : 'M 3 8 C 9 8 13 8 20 8'}/>
                <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={p.isShuffle ? 'M 3 16 C 9 16 13 8 20 8' : 'M 3 16 C 9 16 13 16 20 16'}/>
                <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={p.isShuffle ? 'M 17 13 L 20 16 L 17 19' : 'M 17 5 L 20 8 L 17 11'}/>
                <path style={{ transition: 'd 0.42s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties} d={p.isShuffle ? 'M 17 5 L 20 8 L 17 11' : 'M 17 13 L 20 16 L 17 19'}/>
              </svg>
            </button>
            <button className="mep-ctrl-btn" 
              onPointerDown={e => { 
                e.stopPropagation(); 
                prevPressRef.current = Date.now();
                p.isSeekingRef.current = true;
                scrubStartOffsetRef.current = p.currentTime;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                scrubIntervalRef.current = setInterval(() => {
                  const holdTime = Date.now() - prevPressRef.current;
                  if (holdTime > 300) {
                    const scrubAmount = 10 + ((holdTime - 300) / 1000) * 15;
                    p.setCurrentTime(Math.max(0, scrubStartOffsetRef.current - scrubAmount));
                  }
                }, 50);
              }}
              onPointerUp={e => {
                e.stopPropagation();
                if (!prevPressRef.current) return;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                const duration = Date.now() - prevPressRef.current;
                prevPressRef.current = 0;
                
                if (duration < 300) { 
                  p.onPrev(); 
                  p.isSeekingRef.current = false;
                } else {
                  const scrubAmount = 10 + ((duration - 300) / 1000) * 15;
                  const finalTime = Math.max(0, scrubStartOffsetRef.current - scrubAmount);
                  p.writeToEngine(`SEEK ${finalTime}`);
                  p.setCurrentTime(finalTime);
                  setTimeout(() => { p.isSeekingRef.current = false; }, 50);
                }
              }}
              onPointerLeave={() => {
                if (!prevPressRef.current) return;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                const duration = Date.now() - prevPressRef.current;
                prevPressRef.current = 0;
                if (duration >= 300) {
                  const scrubAmount = 10 + ((duration - 300) / 1000) * 15;
                  const finalTime = Math.max(0, scrubStartOffsetRef.current - scrubAmount);
                  p.writeToEngine(`SEEK ${finalTime}`);
                  p.setCurrentTime(finalTime);
                }
                setTimeout(() => { p.isSeekingRef.current = false; }, 50);
              }}
              onContextMenu={e => e.preventDefault()}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
            </button>
            
            <button className="mep-play-btn" onClick={p.onPlayPause}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
                <path style={{ transition: 'd 0.35s cubic-bezier(0.68,-0.55,0.265,1.55)' }}
                  d={p.isPlaying
                    ? 'M 6 5 L 9 5 L 9 19 L 6 19 Z M 14 5 L 17 5 L 17 19 L 14 19 Z'
                    : 'M 6 5 L 9 5 L 9 19 L 6 19 Z M 9 5 L 19 12 L 19 12 L 9 19 Z'}/>
              </svg>
            </button>
            
            <button className="mep-ctrl-btn" 
              onPointerDown={e => { 
                e.stopPropagation(); 
                nextPressRef.current = Date.now();
                p.isSeekingRef.current = true;
                scrubStartOffsetRef.current = p.currentTime;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                scrubIntervalRef.current = setInterval(() => {
                  const holdTime = Date.now() - nextPressRef.current;
                  if (holdTime > 300) {
                    const scrubAmount = 10 + ((holdTime - 300) / 1000) * 15;
                    p.setCurrentTime(scrubStartOffsetRef.current + scrubAmount);
                  }
                }, 50);
              }}
              onPointerUp={e => {
                e.stopPropagation();
                if (!nextPressRef.current) return;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                const duration = Date.now() - nextPressRef.current;
                nextPressRef.current = 0;
                
                if (duration < 300) { 
                  p.onNext(); 
                  p.isSeekingRef.current = false;
                } else {
                  const scrubAmount = 10 + ((duration - 300) / 1000) * 15;
                  const finalTime = scrubStartOffsetRef.current + scrubAmount;
                  p.writeToEngine(`SEEK ${finalTime}`);
                  p.setCurrentTime(finalTime);
                  setTimeout(() => { p.isSeekingRef.current = false; }, 50);
                }
              }}
              onPointerLeave={() => {
                if (!nextPressRef.current) return;
                if (scrubIntervalRef.current) clearInterval(scrubIntervalRef.current);
                const duration = Date.now() - nextPressRef.current;
                nextPressRef.current = 0;
                if (duration >= 300) {
                  const scrubAmount = 10 + ((duration - 300) / 1000) * 15;
                  const finalTime = scrubStartOffsetRef.current + scrubAmount;
                  p.writeToEngine(`SEEK ${finalTime}`);
                  p.setCurrentTime(finalTime);
                }
                setTimeout(() => { p.isSeekingRef.current = false; }, 50);
              }}
              onContextMenu={e => e.preventDefault()}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
            <button className="mep-ctrl-btn" onClick={p.onToggleRepeat}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${p.repeatDeg}deg)`, transition: 'transform 0.52s cubic-bezier(.4,0,.2,1)' }}>
                <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                <path style={{ transition: 'd 0.38s cubic-bezier(.4,0,.2,1), stroke-width 0.3s', strokeWidth: p.repeatMode === 'ONE' ? 2.2 : 1.8 } as React.CSSProperties} d={p.repeatBusy ? 'M 12 12 L 12 12 L 12 12' : p.repeatMode === 'OFF' ? 'M 6 18 L 12 12 L 18 6' : p.repeatMode === 'ALL' ? 'M 12 12 L 12 12 L 12 12' : 'M 11 10 L 12 8 L 12 15'}/>
              </svg>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}