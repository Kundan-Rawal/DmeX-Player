import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { IS_ANDROID } from '../types';

interface MediaState {
  hasTrack: boolean; title: string; artist: string; duration: number; position: number;
  playing: boolean; canNext: boolean; canPrevious: boolean;
}
interface TransportEvent { action: number; playing: boolean; position: number; ok: boolean }
export function useAndroidMediaSession(state: MediaState, handlers: {
  playing: (value: boolean) => void; seek: (value: number) => void; next: () => void; previous: () => void;
}) {
  const actions = useRef(handlers); actions.current = handlers;
  const latest = useRef(state); latest.current = state;
  useEffect(() => {
    if (!IS_ANDROID) return;
    let disposed = false, unlisten: (() => void) | undefined;
    void listen<TransportEvent>('mobile-transport', ({ payload }) => {
      if (!payload.ok) return;
      if (payload.action === 3) actions.current.next();
      else if (payload.action === 4) actions.current.previous();
      else {
        actions.current.playing(payload.playing);
        if (payload.action === 5) actions.current.seek(payload.position / 1000);
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => console.error('[Media session]', error));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const positionBucket = Math.floor(state.position / 5000);
  useEffect(() => {
    if (!IS_ANDROID) return;
    void invoke('mobile_media_update', { state: latest.current }).catch(error => console.error('[Media session]', error));
  }, [state.hasTrack, state.title, state.artist, state.duration, state.playing, state.canNext, state.canPrevious, positionBucket]);
}
