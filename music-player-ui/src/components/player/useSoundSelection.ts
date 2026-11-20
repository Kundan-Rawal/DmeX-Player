import { useCallback, useEffect, useRef, useState } from 'react';
import type { Taste } from '../../types';
import { soundPreset } from '../../config/soundPresets';
import { DEFAULT_SOUND_SELECTION, parseSoundSelection, processingStatus, quickTaste, selectTaste, SOUND_SELECTION_KEY, SoundSelection, toggleCategory } from '../../config/soundSelection';
import { useAudioSettings } from './AudioSettingsContext';

export function useSoundSelection(profileId: string | null, ready: boolean) {
  const audio = useAudioSettings();
  const [selection, setSelection] = useState(() => parseSoundSelection(localStorage.getItem(SOUND_SELECTION_KEY)) || { ...DEFAULT_SOUND_SELECTION });
  const selectionRef = useRef(selection), [pending, setPending] = useState(false);
  const [appliedProfile, setAppliedProfile] = useState(profileId);
  const generation = useRef(0), requested = useRef<string | null>(null);
  const current = useRef({ audio, profileId }); current.current = { audio, profileId };
  const commit = useCallback((value: SoundSelection) => { selectionRef.current = value; setSelection(value); }, []);
  const markManual = useCallback(() => {
    ++generation.current; requested.current = null; setPending(false);
    commit({ ...selectionRef.current, manual: true });
  }, [commit]);
  const apply = useCallback(async (value: SoundSelection) => {
    const { audio, profileId } = current.current;
    if (audio.status?.bypassAll || (!audio.status && localStorage.getItem('dmex_bypass_all') === 'true')) return;
    const id = ++generation.current;
    const fromManual = selectionRef.current.manual;
    requested.current = `${value.categoryEnabled ? profileId || 'POP' : 'NONE'}:${value.taste}`;
    commit(value); setPending(true);
    try {
      if (fromManual && audio.environment !== 'NONE') await audio.loadAsset('NONE', false);
      if (id !== generation.current) return;
      await audio.update(soundPreset(value.categoryEnabled ? profileId || 'POP' : null, value.taste));
      if (id === generation.current) setAppliedProfile(profileId);
    } catch (error) {
      if (id === generation.current) commit({ ...value, manual: true });
      throw error;
    } finally { if (id === generation.current) setPending(false); }
  }, [commit]);
  const toggle = useCallback(() => apply(toggleCategory(selectionRef.current)), [apply]);
  const chooseTaste = useCallback((taste: Taste) => apply(selectTaste(selectionRef.current, taste)), [apply]);
  const setManualOverride = useCallback((manual: boolean) => {
    if (manual) markManual();
    else void apply({ ...selectionRef.current, categoryEnabled: true, manual: false }).catch(() => {});
  }, [apply, markManual]);
  const hydrateLegacy = useCallback((settings: { smartTaste?: unknown; isManualOverride?: boolean } | null) => {
    if (localStorage.getItem(SOUND_SELECTION_KEY) || generation.current) return;
    commit({ ...DEFAULT_SOUND_SELECTION, taste: quickTaste(settings?.smartTaste), manual: settings?.isManualOverride === true });
  }, [commit]);
  useEffect(() => {
    if (ready) localStorage.setItem(SOUND_SELECTION_KEY, JSON.stringify(selection));
  }, [ready, selection]);
  useEffect(() => {
    if (audio.status?.bypassAll) { requested.current = null; return; }
    if (!ready || audio.busy || !audio.status?.ready || selectionRef.current.manual) return;
    const value = selectionRef.current, key = `${value.categoryEnabled ? profileId || 'POP' : 'NONE'}:${value.taste}`;
    if (requested.current !== key) void apply(value).catch(() => {});
  }, [profileId, ready, audio.busy, audio.status?.ready, audio.status?.bypassAll, apply]);
  return { selection, pending, markManual, setManualOverride, hydrateLegacy, toggle, chooseTaste,
    status: processingStatus(selection, appliedProfile, !!audio.status?.bypassAll, pending || !ready || !audio.status?.ready),
    disabled: audio.busy || !ready || !audio.status?.ready || !!audio.status?.bypassAll };
}
