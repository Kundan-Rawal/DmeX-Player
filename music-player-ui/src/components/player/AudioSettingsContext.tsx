import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { IS_ANDROID } from '../../types';
import { ACOUSTIC_ENVIRONMENTS, HEADPHONE_MODELS } from '../../config/audioAssets';
import { applyAudioSettings, sendAudioCommand } from '../../services/audioBridge';

export interface AudioStatus {
  ready: boolean; bypassAll: boolean; ecoMode: boolean; measuredHrtf: boolean; spatialAvailable: boolean;
  sampleRate: number; requestedSampleRate: number; generation: number;
  outputPeak: number; limiterGain: number; correctionAvailable: boolean; convolutionAvailable: boolean;
  recoveryRequested: boolean; settings: number[];
  irRestoreFailed: boolean;
  processingDelayFrames: number; callbackLoadPercent: number; maximumCallbackLoadPercent: number; overBudgetCallbacks: number;
}
export const PARAM = {
  bass: 0, treble: 1, exciter: 2, width: 3, separation: 4, depth: 5, reverb: 6, compressor: 7,
  volume: 8, subBassHz: 9, bassField: 10, roomBass: 11, vocal: 12, loudness: 13, roomSize: 14,
  damping: 15, air: 16, spatial: 17, boost: 18, device: 19,
} as const;
export type Parameter = keyof typeof PARAM;
export const DEFAULT_AUDIO = [0.25, 0, 0, 1, 0, 0, 0, 0, 1, 52, 0, 0, 0, 0, 0.84, 0.5, 0, 0, 0, 0];
interface AudioControls {
  status: AudioStatus | null; values: number[]; busy: boolean; error: string;
  headphone: string; environment: string;
  update: (changes: Partial<Record<Parameter, number>>) => Promise<void>;
  command: (cmd: string) => Promise<void>;
  loadAsset: (id: string, correction: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}
const Context = createContext<AudioControls | null>(null);
export function AudioSettingsProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [values, setValues] = useState(DEFAULT_AUDIO);
  const valuesRef = useRef(DEFAULT_AUDIO);
  const [headphone, setHeadphone] = useState(localStorage.getItem('dmex_headphone_model') || 'NONE');
  const [environment, setEnvironment] = useState(localStorage.getItem('dmex_environment_v2') || 'NONE');
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const booted = useRef(false), initialized = useRef(false);
  const mutations = useRef(0), revision = useRef(0), operations = useRef(0);
  const refreshId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++refreshId.current;
    const version = revision.current;
    try {
      const actual = await invoke<AudioStatus>('audio_status');
      if (request !== refreshId.current) return;
      setStatus(actual);
      if (initialized.current && mutations.current === 0 && version === revision.current &&
          actual.ready && actual.settings.length === 20) {
        valuesRef.current = actual.settings; setValues(actual.settings);
        localStorage.setItem('dmex_audio_v2', JSON.stringify(actual.settings));
      }
    } catch (e) { setError(String(e)); }
  }, []);
  const command = useCallback(async (cmd: string) => {
    ++operations.current; ++revision.current; setBusy(true); setError('');
    try { await sendAudioCommand(cmd); await refresh(); }
    catch (e) { setError(String(e)); throw e; }
    finally { setBusy(--operations.current > 0 || !initialized.current); }
  }, [refresh]);
  const update = useCallback(async (changes: Partial<Record<Parameter, number>>) => {
    const next = [...valuesRef.current];
    for (const [key, value] of Object.entries(changes)) next[PARAM[key as Parameter]] = value!;
    ++revision.current; ++mutations.current;
    valuesRef.current = next; setValues(next); setError('');
    try { await applyAudioSettings(next); }
    catch (e) { setError(String(e)); throw e; }
    finally { if (--mutations.current === 0) await refresh(); }
  }, [refresh]);
  const loadAsset = useCallback(async (id: string, correction: boolean) => {
    const selected = (correction ? HEADPHONE_MODELS : ACOUSTIC_ENVIRONMENTS).find(v => v.id === id);
    if (!selected) throw new Error('Unknown audio asset');
    ++operations.current; setBusy(true); setError('');
    try {
      if (!selected.path) {
        await sendAudioCommand(correction ? 'HEADPHONE_CORRECTION OFF' : 'CONVOLUTION 0');
      } else {
        const physical = await Promise.all(selected.path.split('|').map(assetPath =>
          invoke<string>('extract_and_load_ir', { assetPath })));
        await sendAudioCommand((correction ? 'HEADPHONE_CORRECTION ' :
          physical.length === 2 ? 'LOAD_IR_DUAL ' : 'LOAD_IR ') + physical.join('|'));
        if (!correction) await sendAudioCommand('CONVOLUTION 0.35');
      }
      if (correction) { setHeadphone(id); localStorage.setItem('dmex_headphone_model', id); }
      else { setEnvironment(id); localStorage.setItem('dmex_environment_v2', id); }
      await refresh();
    } catch (e) { setError(String(e)); throw e; }
    finally { setBusy(--operations.current > 0 || !initialized.current); }
  }, [refresh]);
  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      void (async () => {
        try {
          const saved: unknown = JSON.parse(localStorage.getItem('dmex_audio_v2') || 'null');
          const initial = Array.isArray(saved) && saved.length === 20 && saved.every(Number.isFinite) ? saved : DEFAULT_AUDIO;
          valuesRef.current = initial; setValues(initial);
          await applyAudioSettings(initial);
        const rate = localStorage.getItem('dmex_output_rate');
        if (rate === '44100' || rate === '48000' || (!IS_ANDROID && rate === '96000')) await sendAudioCommand('SAMPLE_RATE ' + rate);
          await sendAudioCommand('QUALITY ' + (localStorage.getItem('dmex_audio_quality') || (IS_ANDROID ? 'ECO' : 'FULL')));
          await sendAudioCommand('BYPASS_ALL ' + (localStorage.getItem('dmex_bypass_all') === 'true' ? '1' : '0'));
          await loadAsset(localStorage.getItem('dmex_headphone_model') || 'NONE', true);
          await loadAsset(localStorage.getItem('dmex_environment_v2') || 'NONE', false);
        } catch (e) { setError(String(e)); }
        finally { initialized.current = true; setBusy(operations.current > 0); await refresh(); }
      })();
    }
    const changed = () => { void refresh(); };
    const failed = (event: Event) => setError(String((event as CustomEvent).detail));
    window.addEventListener('dmex-audio-error', failed);
    window.addEventListener('dmex-audio-changed', changed);
    const interval = window.setInterval(changed, 2000);
    return () => { clearInterval(interval); window.removeEventListener('dmex-audio-changed', changed);
      window.removeEventListener('dmex-audio-error', failed); };
  }, [refresh, loadAsset]);
  return <Context.Provider value={{ status, values, busy, error, headphone, environment, update, command, loadAsset, refresh }}>{children}</Context.Provider>;
}
export function useAudioSettings() {
  const value = useContext(Context);
  if (!value) throw new Error('AudioSettingsProvider is missing');
  return value;
}
