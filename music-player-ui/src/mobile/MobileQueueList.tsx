import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripVertical, MoreHorizontal, Music2 } from 'lucide-react';
import { MobilePlayback } from './useMobilePlayback';
import { Track } from '../types';

export function MobileQueueList({ playback, tracks, onMenu }: { playback: MobilePlayback; tracks: ReadonlyMap<string, Track>; onMenu: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), [scroll, setScroll] = useState(0), [height, setHeight] = useState(500);
  const drag = useRef<{ id: string; target: number } | null>(null), [over, setOver] = useState(-1);
  const entries = playback.queue.entries, current = entries.findIndex(e => e.id === playback.queue.currentId), rowHeight = 76;
  useLayoutEffect(() => {
    const element = ref.current!;
    element.scrollTop = Math.max(0, current * rowHeight - rowHeight);
    setScroll(element.scrollTop);
    const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!drag.current) setOver(-1); }, [entries]);
  const begin = Math.max(0, Math.floor(scroll / rowHeight) - 4), end = Math.min(entries.length, Math.ceil((scroll + height) / rowHeight) + 4);
  return <div className="dmex-mobile-track-scroll" role="list" aria-label="Queue tracks" ref={ref} onScroll={e => setScroll(e.currentTarget.scrollTop)}>
    <div className="dmex-mobile-queue-spacer" data-count={entries.length} style={{ height: entries.length * rowHeight, position: 'relative' }}>
      {entries.slice(begin, end).map((entry, offset) => {
        const index = begin + offset, active = entry.id === playback.queue.currentId, track = tracks.get(entry.track.path) || entry.track;
        return <div role="listitem" key={entry.id} className={'dmex-mobile-queue-row' + (active ? ' is-current' : '') + (over === index ? ' is-drag-target' : '')} style={{ position: 'absolute', top: index * rowHeight, left: 16, right: 8, height: rowHeight }}>
          <button className="dmex-mobile-queue-track" aria-label={`Play queued ${track.name}`} onClick={() => playback.jump(entry.id)}>
            <span className="dmex-artwork">{track.thumb ? <img key={track.thumb} src={track.thumb} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Music2 size={22} />}</span>
            <span><strong>{track.name}</strong><small>{active ? 'Now playing' : index < current ? 'Played' : track.artist}</small></span>
          </button>
          {index > current && <button className="dmex-mobile-icon dmex-mobile-drag-handle" aria-label={`Drag to reorder ${entry.track.name}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: entry.id, target: index }; }} onPointerMove={e => {
            if (!drag.current || !ref.current) return;
            const rect = ref.current.getBoundingClientRect();
            if (e.clientY < rect.top + 40) ref.current.scrollTop -= 12;
            if (e.clientY > rect.bottom - 40) ref.current.scrollTop += 12;
            const target = Math.max(current + 1, Math.min(entries.length - 1, Math.floor((e.clientY - rect.top + ref.current.scrollTop) / rowHeight)));
            drag.current.target = target; setOver(target);
          }} onPointerUp={() => { if (drag.current) playback.moveTo(drag.current.id, drag.current.target); drag.current = null; setOver(-1); }} onPointerCancel={() => { drag.current = null; setOver(-1); }}><GripVertical size={19} /></button>}
          <button className="dmex-mobile-icon" aria-label={`Options for queued ${entry.track.name}`} onClick={() => onMenu(entry.id)}><MoreHorizontal size={21} /></button>
        </div>;
      })}
    </div>
  </div>;
}
