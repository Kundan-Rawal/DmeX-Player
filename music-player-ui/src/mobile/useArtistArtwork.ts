import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { artistCacheKey } from '../utils/artistEngine';

export function useArtistArtwork(names: string[]) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [status, setStatus] = useState({ running: false, done: 0, total: 0, failed: 0 });
  const namesRef = useRef(names), imagesRef = useRef(images), mounted = useRef(false);
  namesRef.current = names; imagesRef.current = images;
  const job = useRef({ enabled: false, working: false, names: [] as string[], index: 0, failed: 0 });
  useEffect(() => {
    mounted.current = true;
    invoke<Record<string, string>>('get_all_artist_images').then(value => {
      if (mounted.current) setImages(previous => ({ ...value, ...previous }));
    }).catch(() => {});
    return () => { mounted.current = false; job.current.enabled = false; };
  }, []);
  const pump = useCallback(async () => {
    const state = job.current;
    if (state.working) return;
    state.working = true;
    try {
      while (mounted.current && state.enabled && state.index < state.names.length) {
        const name = state.names[state.index];
        try {
          const path = await invoke<string | null>('download_artist_art', { artistName: name });
          if (path && mounted.current) setImages(previous => ({ ...previous, [artistCacheKey(name)]: path }));
          else if (!path) state.failed++;
        } catch { state.failed++; }
        state.index++;
        if (mounted.current) setStatus({ running: state.enabled, done: state.index, total: state.names.length, failed: state.failed });
        // Serialize downloads and leave breathing room between network requests.
        if (state.enabled && state.index < state.names.length) await new Promise(resolve => setTimeout(resolve, 200));
      }
    } finally {
      state.working = false;
      if (state.index >= state.names.length) state.enabled = false;
      if (mounted.current) setStatus({ running: state.enabled, done: state.index, total: state.names.length, failed: state.failed });
    }
  }, []);
  const start = useCallback(() => {
    const state = job.current;
    if (state.index >= state.names.length) {
      state.names = namesRef.current.filter(name => !imagesRef.current[artistCacheKey(name)]);
      state.index = 0; state.failed = 0;
    }
    state.enabled = state.names.length > state.index;
    setStatus({ running: state.enabled, done: state.index, total: state.names.length, failed: state.failed });
    void pump();
  }, [pump]);
  const pause = useCallback(() => { job.current.enabled = false; setStatus(previous => ({ ...previous, running: false })); }, []);
  const clear = useCallback(async () => {
    if (job.current.working) throw new Error('Wait for the current artwork download to finish.');
    await invoke('nuke_artist_cache');
    job.current.names = []; job.current.index = 0; job.current.failed = 0;
    setImages({}); setStatus({ running: false, done: 0, total: 0, failed: 0 });
  }, []);
  return { images, status, start, pause, clear, missing: names.filter(name => !images[artistCacheKey(name)]).length };
}
