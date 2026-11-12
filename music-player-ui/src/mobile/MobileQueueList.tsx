import { PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, MoreHorizontal, Music2 } from 'lucide-react';
import { MobilePlayback } from './useMobilePlayback';
import { Track } from '../types';
import { MobileQueue, QueueEntry, moveQueueTo } from './queue';
import { haptic } from './haptics';

const ROW = 76;
interface Drag {
  id: string; from: number; target: number; pointerId: number; startY: number; clientY: number;
  grabOffset: number; startScroll: number; lastFrame: number; snapshot: MobileQueue;
}
export function MobileQueueList({ playback, tracks, onMenu }: { playback: MobilePlayback; tracks: ReadonlyMap<string, Track>; onMenu: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), frame = useRef(0);
  const [scroll, setScroll] = useState(0), [height, setHeight] = useState(500), [announcement, setAnnouncement] = useState('');
  const drag = useRef<Drag | null>(null), pendingDrop = useRef<{ id: string; top: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; from: number } | null>(null), [preview, setPreview] = useState<QueueEntry[] | null>(null);
  const playbackRef = useRef(playback); playbackRef.current = playback;
  const entries = playback.queue.entries, current = entries.findIndex(entry => entry.id === playback.queue.currentId);
  const displayed = preview || entries;
  const finish = useCallback((commit: boolean) => {
    const value = drag.current, element = ref.current;
    if (!value) return;
    if (commit && element) {
      const min = value.snapshot.entries.findIndex(entry => entry.id === value.snapshot.currentId) + 1;
      value.target = Math.max(min, Math.min(value.snapshot.entries.length - 1, Math.round((value.clientY - element.getBoundingClientRect().top + element.scrollTop - value.grabOffset) / ROW)));
    }
    drag.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    if (element?.hasPointerCapture(value.pointerId)) element.releasePointerCapture(value.pointerId);
    const unchanged = playbackRef.current.queue.entries === value.snapshot.entries && playbackRef.current.queue.currentId === value.snapshot.currentId;
    if (commit && unchanged && value.from !== value.target && element) {
      pendingDrop.current = { id: value.id, top: value.from * ROW + value.clientY - value.startY + element.scrollTop - value.startScroll };
      playbackRef.current.moveTo(value.id, value.target);
      setAnnouncement('Moved to position ' + (value.target + 1)); haptic('confirm');
    } else setAnnouncement(commit ? 'Queue order unchanged' : 'Reordering cancelled');
    setDragging(null); setPreview(null);
  }, []);
  useLayoutEffect(() => {
    const element = ref.current!;
    element.scrollTop = Math.max(0, current * ROW - ROW); setScroll(element.scrollTop);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const drop = pendingDrop.current; if (!drop) return;
    pendingDrop.current = null;
    const index = entries.findIndex(entry => entry.id === drop.id);
    const element = [...(ref.current?.querySelectorAll<HTMLElement>('[data-queue-id]') || [])].find(row => row.dataset.queueId === drop.id);
    if (element && index >= 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) element.animate([
      { transform: 'translate3d(0,' + drop.top + 'px,0)' }, { transform: 'translate3d(0,' + index * ROW + 'px,0)' },
    ], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
  }, [entries]);
  useEffect(() => {
    if (drag.current && (drag.current.snapshot.entries !== entries || drag.current.snapshot.currentId !== playback.queue.currentId)) finish(false);
  }, [entries, playback.queue.currentId, finish]);
  useEffect(() => {
    const cancel = () => finish(false), visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(frame.current); drag.current = null; window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, [finish]);
  const tick = useCallback((time: number) => {
    const value = drag.current, element = ref.current; if (!value || !element) return;
    const rect = element.getBoundingClientRect(), edge = Math.min(48, rect.height / 3), elapsed = Math.min(32, Math.max(0, time - value.lastFrame));
    value.lastFrame = time;
    const speed = value.clientY < rect.top + edge ? -Math.min(1, (rect.top + edge - value.clientY) / edge)
      : value.clientY > rect.bottom - edge ? Math.min(1, (value.clientY - rect.bottom + edge) / edge) : 0;
    if (speed) element.scrollTop += speed * 480 * elapsed / 1000;
    const min = value.snapshot.entries.findIndex(entry => entry.id === value.snapshot.currentId) + 1;
    const target = Math.max(min, Math.min(value.snapshot.entries.length - 1, Math.round((value.clientY - rect.top + element.scrollTop - value.grabOffset) / ROW)));
    if (target !== value.target) { value.target = target; setPreview(moveQueueTo(value.snapshot, value.id, target).entries); haptic('dragTick'); }
    if (overlay.current) overlay.current.style.transform = 'translate3d(0,' + (value.clientY - value.startY + element.scrollTop - value.startScroll) + 'px,0)';
    frame.current = requestAnimationFrame(tick);
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>, entry: QueueEntry, index: number) => {
    const element = ref.current;
    if (!element || !event.isPrimary || event.button !== 0 || index <= current) return;
    event.preventDefault(); event.stopPropagation();
    const row = event.currentTarget.closest<HTMLElement>('[data-queue-id]')!;
    element.setPointerCapture(event.pointerId);
    drag.current = { id: entry.id, from: index, target: index, pointerId: event.pointerId, startY: event.clientY, clientY: event.clientY,
      grabOffset: event.clientY - row.getBoundingClientRect().top, startScroll: element.scrollTop, lastFrame: performance.now(), snapshot: playbackRef.current.queue };
    setDragging({ id: entry.id, from: index }); setPreview(playbackRef.current.queue.entries);
    setAnnouncement('Reordering ' + entry.track.name); haptic('dragStart');
    frame.current = requestAnimationFrame(tick);
  };
  const renderRow = (entry: QueueEntry, index: number, lifted = false) => {
    const active = entry.id === playback.queue.currentId, track = tracks.get(entry.track.path) || entry.track;
    return <div role="listitem" key={lifted ? 'drag:' + entry.id : entry.id} data-queue-id={entry.id}
      className={'dmex-mobile-queue-row' + (active ? ' is-current' : '') + (lifted ? ' is-dragging' : entry.id === dragging?.id ? ' is-drag-source' : '')}
      ref={lifted ? overlay : undefined} inert={lifted} aria-hidden={lifted || undefined}
      style={{ position: 'absolute', top: lifted ? index * ROW : 0, transform: lifted ? 'translate3d(0,0,0)' : 'translate3d(0,' + index * ROW + 'px,0)', left: 16, right: 8, height: ROW }}>
      <button className="dmex-mobile-queue-track" aria-label={'Play queued ' + track.name} onClick={() => playback.jump(entry.id)}>
        <span className="dmex-artwork">{track.thumb ? <img key={track.thumb} src={track.thumb} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Music2 size={22} />}</span>
        <span><strong>{track.name}</strong><small>{active ? 'Now playing' : index < current ? 'Played' : track.artist}</small></span>
      </button>
      {index > current && <button className="dmex-mobile-icon dmex-mobile-drag-handle" aria-label={'Drag to reorder ' + track.name}
        onPointerDown={event => start(event, entry, index)} onClick={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); playback.move(entry.id, event.key === 'ArrowUp' ? -1 : 1); haptic('selection'); } }}><GripVertical size={19} /></button>}
      <button className="dmex-mobile-icon" aria-label={'Options for queued ' + track.name} onClick={() => onMenu(entry.id)}><MoreHorizontal size={21} /></button>
    </div>;
  };
  const begin = Math.max(0, Math.floor(scroll / ROW) - 4), end = Math.min(displayed.length, Math.ceil((scroll + height) / ROW) + 4);
  const liftedEntry = dragging && entries.find(entry => entry.id === dragging.id);
  return <>
    <span className="dmex-mobile-sr-only" role="status" aria-live="polite">{announcement}</span>
    <div className="dmex-mobile-track-scroll" role="list" aria-label="Queue tracks" ref={ref}
      onScroll={event => setScroll(event.currentTarget.scrollTop)}
      onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) { event.preventDefault(); drag.current.clientY = event.clientY; } }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current.clientY = event.clientY; finish(true); } }}
      onPointerCancel={() => finish(false)} onLostPointerCapture={() => { if (drag.current) finish(false); }}>
      <div className="dmex-mobile-queue-spacer" data-count={entries.length} style={{ height: displayed.length * ROW, position: 'relative' }}>
        {displayed.slice(begin, end).map((entry, offset) => renderRow(entry, begin + offset))}
        {dragging && <span className="dmex-mobile-queue-slot" style={{ transform: 'translate3d(0,' + (drag.current?.target ?? dragging.from) * ROW + 'px,0)', height: ROW }} />}
        {liftedEntry && dragging && renderRow(liftedEntry, dragging.from, true)}
      </div>
    </div>
  </>;
}
