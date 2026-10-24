import { ReactNode } from 'react';
import { Power, RotateCcw } from 'lucide-react';
import { ACOUSTIC_ENVIRONMENTS, HEADPHONE_MODELS } from '../../config/audioAssets';
import { IS_ANDROID } from '../../types';
import { CustomSelect } from '../common/CustomSelect';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { PARAM, Parameter, useAudioSettings } from './AudioSettingsContext';
import './AdvancedAudioPanel.css';

export function BypassAllButton() {
  const { status, command, busy } = useAudioSettings();
  const enabled = status?.bypassAll ?? false;
  return <button type="button" className={'audio-bypass-button' + (enabled ? ' active' : '')}
    aria-label="Bypass All" aria-pressed={enabled} disabled={busy}
    title={enabled ? 'Raw stereo at unity gain' : 'Bypass All audio enhancements'}
    onClick={() => { void command('BYPASS_ALL ' + (enabled ? '0' : '1')).then(() =>
      localStorage.setItem('dmex_bypass_all', String(!enabled))).catch(() => {}); }}>
    <Power size={17} /><span>{enabled ? 'Raw Stereo' : 'Bypass All'}</span>
  </button>;
}
export function AdvancedAudioPanel({ onManualEdit }: { onManualEdit?: () => void }) {
  const audio = useAudioSettings();
  const disabled = !!audio.status?.bypassAll || audio.busy;
  const value = (key: Parameter) => audio.values[PARAM[key]];
  const set = (key: Parameter, v: number) => {
    onManualEdit?.();
    void audio.update({ [key]: v }).catch(() => {});
  };
  const percent = (v: number) => Math.round(v * 100) + '%';
  const slider = (key: Parameter, label: string, min: number, max: number, step: number,
    format: (v: number) => string) =>
    <label className="dsp-control" key={key}>
      <span className="dsp-label-row"><span>{label}</span><output>{format(value(key))}</output></span>
      <input className="dsp-slider" aria-label={label} type="range"
        min={min} max={max} step={step} value={value(key)} disabled={disabled}
        onChange={e => set(key, Number(e.target.value))} />
    </label>;
  const toggle = (key: Parameter, label: string) =>
    <div className="dsp-control dsp-switch-row" key={key}>
      <span className="dsp-label-row">{label}</span>
      <ToggleSwitch label={label} checked={value(key) > 0.5} disabled={disabled}
        onChange={checked => set(key, checked ? 1 : 0)} />
    </div>;
  const group = (label: string, color: string, children: ReactNode) =>
    <section className={'dsp-section dsp-section-' + color} aria-label={label}>
      <h3>{label}</h3><div className="dsp-section-controls">{children}</div>
    </section>;
  const modelOptions = HEADPHONE_MODELS.map(v => ({ value: v.id, label: v.label }));
  const environmentOptions = ACOUSTIC_ENVIRONMENTS.map(v => ({ value: v.id, label: v.label }));
  return <section className="advanced-audio-panel">
    <div className="studio-header"><h2>Fine-Tune DSP</h2></div>
    <div className="audio-engine-status" role="status">
      <span>{audio.status?.bypassAll ? 'Raw stereo / unity' : 'Enhanced stereo'}</span>
      <span>{audio.status ? (audio.status.sampleRate / 1000).toFixed(1) + ' kHz' : 'Connecting'}</span>
      <span>{audio.status?.bypassAll ? 'DSP disconnected' : audio.status?.portableHrtf ? 'Portable measured HRTF' : audio.status?.measuredHrtf ? 'Measured HRTF' : 'Lightweight spatial'}</span>
    </div>
    {audio.status?.recoveryRequested && <p className="audio-error" role="status">Output changed. Reconnect output to resume.</p>}
    {audio.status?.irRestoreFailed && <p className="audio-error" role="status">An IR could not be restored. Reselect the headphone or acoustic preset.</p>}
    {audio.error && <p className="audio-error" role="alert">{audio.error}</p>}
    <div className="dsp-grid">
      {group('Output', 'neutral', <div className="audio-mode-row">
        <div className="dsp-select-control"><span>Processing</span>
          <CustomSelect label="Processing quality" disabled={audio.busy} value={audio.status?.ecoMode ? 'ECO' : 'FULL'}
            options={[{ value: 'ECO', label: 'Eco' }, { value: 'FULL', label: 'Full' }]}
            onChange={quality => { void audio.command('QUALITY ' + quality)
              .then(() => localStorage.setItem('dmex_audio_quality', quality)).catch(() => {}); }} />
        </div>
        <div className="dsp-select-control"><span>Output Rate</span>
          <CustomSelect label="Output sample rate" disabled={disabled} value={audio.status?.requestedSampleRate || 48000}
            options={[{ value: '44100', label: '44.1 kHz' }, { value: '48000', label: '48 kHz' },
              ...(!IS_ANDROID ? [{ value: '96000', label: '96 kHz' }] : [])]}
            onChange={rate => { void audio.command('SAMPLE_RATE ' + rate)
              .then(() => localStorage.setItem('dmex_output_rate', rate)).catch(() => {}); }} />
        </div>
        <button type="button" className="audio-icon-button" title="Reconnect output" aria-label="Reconnect output"
          disabled={audio.busy} onClick={() => { void audio.command('RECOVER').catch(() => {}); }}><RotateCcw size={18} /></button>
      </div>)}
      {group('Dynamics', 'dynamics', <>
        {toggle('compressor', 'Studio Compressor')}
        {toggle('loudness', 'Adaptive Loudness')}
      </>)}
      {group('Tone & Harmonics', 'tone', <>
        {slider('exciter', 'Tube Exciter', 0, 1, 0.01, percent)}
        {slider('air', 'Harmonic Air', 0, 1, 0.01, percent)}
        {slider('vocal', 'Vocal Frontness', 0, 1, 0.01, percent)}
      </>)}
      {group('Stereo Image', 'stereo', <>
        {slider('width', 'Stereo Widener', 1, 2.5, 0.01, v => v.toFixed(2) + 'x')}
      </>)}
      {group('Spatial Effects', 'spatial', <>
        {toggle('spatial', '9D Cinema Stage')}
        {slider('separation', 'Spatial Separation', 0, 1, 0.01, percent)}
        {slider('depth', '3D Depth', 0, 1, 0.01, percent)}
      </>)}
      {group('Bass Field', 'bass', <>
        {toggle('roomBass', '3D Room Bass')}
        <div className="dsp-control"><span className="dsp-label-row">Sub-Bass Anchor</span>
          <CustomSelect label="Sub-bass frequency" disabled={disabled} value={value('subBassHz')}
            options={[30, 40, 52, 60, 70, 80].map(v => ({ value: String(v), label: v + ' Hz' }))}
            onChange={v => set('subBassHz', Number(v))} /></div>
        {slider('bassField', 'Bass Field', 0, 1, 0.01, percent)}
      </>)}
      {group('Room & Reverb', 'room', <>
        <div className="dsp-control dsp-switch-row"><span className="dsp-label-row">Automatic room</span>
          <ToggleSwitch label="Automatic reverb" checked={audio.status?.autoReverb ?? true} disabled={disabled}
            onChange={enabled => { onManualEdit?.(); void audio.setAutoReverb(enabled).catch(() => {}); }} /></div>
        <div className="dsp-control"><span className="dsp-label-row">Acoustic Environment</span>
          <CustomSelect label="Acoustic impulse response" disabled={disabled}
            value={audio.status?.convolutionAvailable ? audio.environment : 'NONE'} options={environmentOptions}
            onChange={id => { onManualEdit?.(); void audio.loadAsset(id, false).catch(() => {}); }} /></div>
        {slider('reverb', 'Digital Reverb', 0, 1, 0.01, percent)}
        {audio.status?.autoReverb === false && <>
          {slider('roomSize', 'Room Size', 0.2, 0.98, 0.01, percent)}
          {slider('damping', 'Damping', 0, 0.95, 0.01, percent)}
        </>}
      </>)}
      {group('Headphone Correction', 'neutral', <div className="dsp-control">
        <span className="dsp-label-row">Headphone EQ</span>
        <CustomSelect label="Headphone correction" disabled={disabled}
          value={audio.status?.correctionAvailable ? audio.headphone : 'NONE'} options={modelOptions}
          onChange={id => { onManualEdit?.(); void audio.loadAsset(id, true).catch(() => {}); }} />
      </div>)}
    </div>
    <div className="audio-engine-status">
      <span>Peak {audio.status ? (20 * Math.log10(Math.max(audio.status.outputPeak, 1e-6))).toFixed(1) : '-'} dBFS</span>
      <span>Reduction {audio.status ? (-20 * Math.log10(Math.max(audio.status.limiterGain, 1e-6))).toFixed(1) : '0'} dB</span>
      <span>DSP {audio.status?.callbackLoadPercent?.toFixed(1) || '0'}% of buffer budget</span>
      <span>DSP Delay {audio.status ? (audio.status.processingDelayFrames / audio.status.sampleRate * 1000).toFixed(1) : '0'} ms</span>
      <span>Over Budget {audio.status?.overBudgetCallbacks || 0}</span>
    </div>
  </section>;
}
