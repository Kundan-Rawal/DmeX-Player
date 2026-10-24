import { HEADPHONE_MODELS } from '../../config/audioAssets';
import { IS_ANDROID } from '../../types';
import { CustomSelect } from '../common/CustomSelect';
import { BypassAllButton } from './AdvancedAudioPanel';
import { PARAM, Parameter, useAudioSettings } from './AudioSettingsContext';

interface TrackOptionsProps {
  visMode: 'ORBIT' | 'RADAR';
  setVisMode: (mode: 'ORBIT' | 'RADAR') => void;
  onManualEdit?: () => void;
}

export function TrackOptions({ visMode, setVisMode, onManualEdit }: TrackOptionsProps) {
  const audio = useAudioSettings();
  const disabled = audio.busy || !!audio.status?.bypassAll;
  const value = (key: Parameter) => audio.values[PARAM[key]];
  const selected = (key: Parameter, v: number) => Math.abs(value(key) - v) < 0.0001;
  const set = (key: Parameter, v: number) => { onManualEdit?.(); void audio.update({ [key]: v }).catch(() => {}); };
  const segment = (key: Parameter, label: string, choices: [number, string][]) =>
    <div className="glass-menu-section track-option-section">
      <div className="glass-label-row"><span>{label}</span></div>
      <div className="glass-boost-grid" role="group" aria-label={label}>
        {choices.map(([v, text]) => <button key={v} type="button"
          className={'glass-boost-btn' + (selected(key, v) ? ' active' : '')}
          aria-pressed={selected(key, v)} disabled={disabled} onClick={() => set(key, v)}>{text}</button>)}
      </div>
    </div>;
  const slider = (key: Parameter, label: string, min: number, max: number, step: number, display: string) =>
    <label className="glass-menu-section track-option-section">
      <span className="glass-label-row"><span>{label}</span><output>{display}</output></span>
      <input className="glass-slider" aria-label={label} type="range" min={min} max={max} step={step}
        value={value(key)} disabled={disabled} onChange={e => set(key, Number(e.target.value))} />
    </label>;
  return <div className="track-options">
    <div className="glass-menu-header">Track Options</div>
    <div className="glass-label-row track-bypass-row"><span>Bypass All</span><BypassAllButton /></div>
    {slider('bass', 'Subwoofer Bass', 0, 2.1, 0.01, Math.round(value('bass') / 2.1 * 100) + '%')}
    {slider('bassField', 'Bass Field', 0, 1, 0.01, Math.round(value('bassField') * 100) + '%')}
    {slider('treble', 'Crystal Treble', -12, 12, 0.1, value('treble').toFixed(1) + ' dB')}
    {segment('boost', 'Speaker Boost', [[0, 'None'], [0.3, 'Low'], [0.6, 'Med'], [1, 'High']])}
    <div className="glass-menu-section track-option-section">
      <div className="glass-label-row"><span>Background Visualizer</span></div>
      <div className="glass-boost-grid" role="group" aria-label="Background visualizer">
        {(['ORBIT', 'RADAR'] as const).map(mode => <button type="button" key={mode}
          className={'glass-boost-btn' + (visMode === mode ? ' active' : '')} aria-pressed={visMode === mode}
          onClick={() => { setVisMode(mode); localStorage.setItem('dmex_visualizer', mode);
            window.dispatchEvent(new CustomEvent('dmex-visualizer', { detail: mode })); }}>
          {mode === 'ORBIT' ? 'Orbit' : '8B'}</button>)}
      </div>
    </div>
    {segment('spatial', '9D Cinema Stage', [[0, 'Stereo'], [1, '9D Cinema']])}
    {segment('roomBass', '9D Bass Routing', [[0, 'Direct'], [1, 'Room']])}
    {segment('device', 'Hardware Output', [[0, 'Headphones'], [IS_ANDROID ? 2 : 1, IS_ANDROID ? 'Phone Speaker' : 'Laptop Speaker']])}
    <div className="glass-menu-section track-option-section">
      <span className="glass-label-row">Headphone EQ</span>
      <CustomSelect label="Headphone correction" disabled={disabled}
        value={audio.status?.correctionAvailable ? audio.headphone : 'NONE'}
        options={HEADPHONE_MODELS.map(model => ({ value: model.id, label: model.label }))}
        onChange={id => { onManualEdit?.(); void audio.loadAsset(id, true).catch(() => {}); }} />
    </div>
    {audio.error && <p className="audio-error" role="alert">{audio.error}</p>}
  </div>;
}
