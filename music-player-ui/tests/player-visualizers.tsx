import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { AmbientBackground } from '../src/components/player/AmbientBackground';
import { Android8BDustCanvas, Android8BRipples } from '../src/components/player/MobileVisualizer';
import { AdvancedAudioPanel } from '../src/components/player/AdvancedAudioPanel';
import { AudioSettingsProvider, DEFAULT_AUDIO } from '../src/components/player/AudioSettingsContext';
import { TrackOptions } from '../src/components/player/TrackOptions';
import { MobileExpandedPlayer } from '../src/components/player/MobileExpandedPlayer';
import { TopNav } from '../src/components/layout/TopNav';
import { IS_ANDROID, NavView } from '../src/types';
import '../src/App.css';
import '../src/components/player/MobileExpandedPlayer.css';

// This fixture uses production components, but no native output device or user library.
document.documentElement.style.setProperty('--theme-color', '#00cfa0');
document.documentElement.style.setProperty('--theme-text', '#07120f');
document.documentElement.style.setProperty('--blob-1', '#168c69');
document.documentElement.style.setProperty('--blob-2', '#855fa9');
document.documentElement.style.setProperty('--blob-3', '#bd8942');
const status = { ready: true, bypassAll: false, ecoMode: IS_ANDROID, measuredHrtf: !IS_ANDROID,
  spatialAvailable: true, sampleRate: 48000, requestedSampleRate: 48000, generation: 1,
  outputPeak: 0.5, limiterGain: 1, correctionAvailable: false, convolutionAvailable: false,
  recoveryRequested: false, irRestoreFailed: false, settings: [...DEFAULT_AUDIO],
  processingDelayFrames: 1208, callbackLoadPercent: 5, maximumCallbackLoadPercent: 10, overBudgetCallbacks: 0 };
mockIPC((command, payload) => {
  if (command === 'audio_status') return { ...status, settings: [...status.settings] };
  if (command === 'audio_apply_settings') status.settings = (payload?.values as number[]).map(Math.fround);
  if (command === 'audio_command' && typeof payload?.cmd === 'string') {
    if (payload.cmd.startsWith('BYPASS_ALL ')) status.bypassAll = payload.cmd.endsWith('1');
  }
});

function Fixture() {
  const [mode, setMode] = useState<'ORBIT' | 'RADAR'>('RADAR');
  const [view, setView] = useState<NavView>('ALL');
  const expanded = useRef(true), level = useRef(0.5);
  const spatial = useRef({ bLvl: 0, bPan: 0, mLvl: 0, mPan: 0, mPhs: 1, tLvl: 0, tPan: 0, tPhs: 1 });
  const dsp = new URLSearchParams(location.search).has('dsp');
  const navigation = new URLSearchParams(location.search).has('nav');
  const player = new URLSearchParams(location.search).has('player');
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      const beat = ++count % 4 === 0;
      spatial.current = { bLvl: beat ? 0.8 : 0.03, bPan: Math.sin(count / 5),
        mLvl: 0.3, mPan: Math.cos(count / 5), mPhs: 0.4,
        tLvl: beat ? 0.5 : 0.01, tPan: Math.sin(count / 8), tPhs: 0.7 };
    }, 100);
    return () => clearInterval(timer);
  }, []);
  const noop = () => {}, asyncNoop = async () => {};
  if (navigation) return <>
    <TopNav currentView={view} setCurrentView={setView} handleAddFolder={noop} handleClearLibrary={noop}
      isLoading={false} mobileSearchOpen={false} setMobileSearchOpen={noop} toggleTheme={noop} onOpenSettings={noop} />
    <output data-testid="selected-view">{view}</output>
  </>;
  if (player) return <div style={{ position: 'fixed', inset: 0 }}>
    <MobileExpandedPlayer isExpanded trackTitle="Test Track" trackArtist="Test Artist" albumArt={null}
      isPlaying currentTime={12} duration={180} isShuffle={false} repeatMode="OFF" repeatDeg={0} repeatBusy={false}
      isAnalyzing={false} isManualOverride={false} detectedProfile={null} smartTaste="QUALITY" isCurrentFavorite={false}
      lyrics={[{ time: 0, text: 'First lyric' }, { time: 20, text: 'Second lyric' }]} activeLyricIndex={0} scanProgress=""
      isRemastered={false} setIsRemastered={noop} isCompressed={false} setIsCompressed={noop}
      selectedAcousticEnv="NONE" setSelectedAcousticEnv={noop} isEnvDropdownOpen={false} setIsEnvDropdownOpen={noop}
      upscaleDrive={0} setUpscaleDrive={noop} widenWidth={1} setWidenWidth={noop} spatialExtra={0} setSpatialExtra={noop}
      depthAmount={0} setDepthAmount={noop} reverbWet={0} setReverbWet={noop}
      restorationDenoise={0} setRestorationDenoise={noop} restorationUpscale={0} setRestorationUpscale={noop}
      restorationPresence={0} setRestorationPresence={noop} setBassLevel={noop} setTrebleLevel={noop}
      setIsManualOverride={noop} setSmartTaste={noop} isProfileActive={false} setIsProfileActive={noop}
      isProfileActiveRef={{ current: false }} applySmartSettings={asyncNoop} smartTasteRef={{ current: 'QUALITY' }}
      bassLevel={0.25} bassLevelRef={{ current: 0.25 }} trebleLevel={0} trebleLevelRef={{ current: 0 }}
      speakerMode="NONE" setSpeakerMode={noop} isFIRMode={false} setIsFIRMode={noop} visMode={mode} setVisMode={setMode}
      isPhoneSpeaker={false} setIsPhoneSpeaker={noop} isPhoneSpeakerRef={{ current: false }}
      isExpandedRef={expanded} audioLevelRef={level} spatialData={spatial} themeColor="#00cfa0" isDarkMode audioLevel={0.5}
      onClose={noop} onPlayPause={asyncNoop} onNext={noop} onPrev={noop} onToggleShuffle={noop} onToggleRepeat={noop}
      onToggleFavorite={asyncNoop} onSeekDrag={noop} onSeekCommit={asyncNoop} onTasteChange={asyncNoop}
      onFetchLyrics={asyncNoop} writeToEngine={asyncNoop} isSeekingRef={{ current: false }} setCurrentTime={noop} />
  </div>;
  return <>
    <AmbientBackground isExpandedRef={expanded} audioLevelRef={level} spatialData={spatial}
      visMode={mode} themeColor="#00cfa0" isDarkMode audioLevel={0.5} />
    {IS_ANDROID && mode === 'RADAR' && <Android8BDustCanvas isExpanded isDarkMode />}
    {IS_ANDROID && mode === 'RADAR' && <div style={{ position: 'absolute', left: '50%', top: '50%', width: 200, height: 200 }}>
      <Android8BRipples spatialData={spatial} isPlaying /></div>}
    <div className={IS_ANDROID ? 'mep-root' : 'expanded-player-content'} style={{ position: 'relative', zIndex: 10, minHeight: '100dvh', background: 'transparent' }}>
      {dsp ? <div className="studio-dashboard" style={{ maxWidth: 640, margin: '16px auto' }}><AdvancedAudioPanel /></div> :
        <div className="glass-options-menu" style={{ top: 24, right: 16 }}><TrackOptions visMode={mode} setVisMode={setMode} /></div>}
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<AudioSettingsProvider><Fixture /></AudioSettingsProvider>);
