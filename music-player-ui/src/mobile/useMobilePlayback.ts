import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../types';
import { advanceQueue, createQueue, emptyQueue, insertQueue, MobileQueue, moveQueueEntry, moveQueueTo, parseQueue, previousQueue, queueCurrent, removeQueueEntry, shuffleQueue } from './queue';

export interface MobileLoadOptions { autoplay?: boolean; position?: number }
const KEY = 'dmex_mobile_queue_v1';
export function useMobilePlayback(enabled: boolean, ready: boolean, library: Track[], load: (track: Track, options?: MobileLoadOptions) => Promise<void>, stats: (path: string, seconds: number, counted: boolean) => void) {
  const [queue, setQueue] = useState<MobileQueue>(() => enabled ? parseQueue(localStorage.getItem(KEY)) : emptyQueue());
  const ref = useRef(queue), libraryRef = useRef(library), loader = useRef(load), statsRef = useRef(stats);
  ref.current = queue; libraryRef.current = library; loader.current = load; statsRef.current = stats;
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [hydrated, setHydrated] = useState(!enabled);
  const [recent, setRecent] = useState<Record<string, number>>(() => { try { return JSON.parse(localStorage.getItem('dmex_mobile_recent_v1') || '{}'); } catch { return {}; } });
  const nextBlock = useRef<string | undefined>(undefined), intent = useRef(0), restored = useRef(false);
  const fallback = useRef<Track | null>(null);
  const telemetry = useRef({ path: '', time: 0, listened: 0, pending: 0, counted: false });
  const commit = useCallback((value: MobileQueue) => { ref.current = value; setQueue(value); }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    invoke<string | null>('get_setting', { key: KEY }).then(raw => { if (active && raw && !ref.current.entries.length) commit(parseQueue(raw)); }).catch(() => {}).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [enabled, commit]);
  useEffect(() => {
    if (!enabled || !hydrated) return;
    const timer = setTimeout(() => {
      const raw = JSON.stringify(ref.current);
      try { localStorage.setItem(KEY, raw); } catch { setError('Queue could not be saved on this device.'); }
      invoke('set_setting', { key: KEY, value: raw }).catch(() => setError('Queue backup could not be saved. Your current session is still available.'));
    }, 350);
    return () => clearTimeout(timer);
  }, [queue, enabled, hydrated]);
  const flush = useCallback(() => {
    const t = telemetry.current, seconds = Math.floor(t.pending);
    if (seconds > 0 && t.path) { t.pending -= seconds; void invoke('update_play_stats', { path: t.path, seconds }).then(() => statsRef.current(t.path, seconds, false)).catch(() => setError('Listening history could not be saved.')); }
  }, []);
  const run = useCallback(async (value: MobileQueue, options: MobileLoadOptions = {}) => {
    const entry = queueCurrent(value); if (!entry) return;
    const id = ++intent.current;
    flush(); nextBlock.current = undefined;
    telemetry.current = { path: entry.track.path, time: options.position || 0, listened: 0, pending: 0, counted: false };
    commit(value); setError(''); setBusy(true);
    try { await loader.current(libraryRef.current.find(t => t.path === entry.track.path) || entry.track, options); }
    catch { if (id === intent.current) setError(`Could not open ${entry.track.name}. Retry or skip this track.`); }
    finally { if (id === intent.current) setBusy(false); }
  }, [commit, flush]);
  useEffect(() => {
    if (!enabled || !ready || !hydrated || restored.current) return;
    restored.current = true;
    if (queueCurrent(ref.current)) void run(ref.current, { autoplay: false, position: ref.current.position });
    else if (fallback.current) void run(createQueue([fallback.current], fallback.current, 'Restored track'), { autoplay: false });
  }, [enabled, ready, hydrated, run]);
  useEffect(() => {
    if (!enabled) return;
    const save = () => { flush(); try { localStorage.setItem(KEY, JSON.stringify(ref.current)); } catch {} };
    const timer = setInterval(save, 10000);
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', save);
    return () => { clearInterval(timer); save(); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [enabled, flush]);
  const progress = useCallback((time: number, playing: boolean) => {
    if (!enabled) return;
    const t = telemetry.current, delta = time - t.time; t.time = time;
    ref.current.position = time;
    if (!playing) { flush(); return; }
    if (delta > 0 && delta < 2) { t.listened += delta; t.pending += delta; }
    if (t.pending >= 15) flush();
    const entry = queueCurrent(ref.current), threshold = Math.min(30, (entry?.track.duration || 60) / 2);
    if (entry && t.listened >= threshold && !t.counted) {
      t.counted = true;
      const now = Date.now();
      setRecent(prev => { const next = { ...prev, [entry.track.path]: now }; localStorage.setItem('dmex_mobile_recent_v1', JSON.stringify(next)); return next; });
      void invoke('record_play', { path: entry.track.path }).then(() => statsRef.current(entry.track.path, 0, true)).catch(() => setError('Play count could not be saved.'));
    }
  }, [enabled, flush]);
  return { queue, recent, error, busy, progress, dismissError: () => setError(''),
    start: (tracks: Track[], track: Track, origin: string, shuffled = false) => run(createQueue(tracks, track, origin, shuffled)),
    restoreFallback: (track: Track) => { fallback.current = track; if (enabled && ready && hydrated && !ref.current.entries.length) void run(createQueue([track], track, 'Restored track'), { autoplay: false }); },
    next: (automatic = false) => { const next = advanceQueue(ref.current, automatic); if (next) void run(next); return !!next; },
    previous: () => { const previous = previousQueue(ref.current); if (previous) void run(previous); },
    jump: (id: string) => { if (ref.current.entries.some(e => e.id === id)) void run({ ...ref.current, currentId: id, history: ref.current.currentId ? [...ref.current.history, ref.current.currentId] : [], position: 0 }); },
    retry: () => run(ref.current, { position: ref.current.position }),
    add: (tracks: Track[], next: boolean) => { const value = insertQueue(ref.current, tracks, next, nextBlock.current); if (next) nextBlock.current = value.entries.filter(e => !ref.current.entries.some(old => old.id === e.id)).slice(-1)[0]?.id; commit(value); },
    remove: (id: string) => commit(removeQueueEntry(ref.current, id)),
    move: (id: string, direction: -1 | 1) => commit(moveQueueEntry(ref.current, id, direction)),
    moveTo: (id: string, target: number) => commit(moveQueueTo(ref.current, id, target)),
    clear: () => { const q = ref.current, index = q.entries.findIndex(e => e.id === q.currentId); commit({ ...q, entries: index >= 0 ? q.entries.slice(0, index + 1) : [] }); },
    replace: (snapshot: MobileQueue) => { if (snapshot.currentId === ref.current.currentId) commit({ ...snapshot, position: ref.current.position }); else setError('The current track changed. Your active queue was kept.'); },
    toggleShuffle: () => commit(shuffleQueue(ref.current, !ref.current.shuffle)),
    toggleRepeat: () => { const q = ref.current; commit({ ...q, repeat: q.repeat === 'OFF' ? 'ALL' : q.repeat === 'ALL' ? 'ONE' : 'OFF' }); },
  };
}
export type MobilePlayback = ReturnType<typeof useMobilePlayback>;
