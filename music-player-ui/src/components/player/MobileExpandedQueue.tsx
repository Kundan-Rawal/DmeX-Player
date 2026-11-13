import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ListMusic, Trash2, X } from 'lucide-react';
import { Track } from '../../types';
import { MobilePlayback } from '../../mobile/useMobilePlayback';
import { MobileQueueList } from '../../mobile/MobileQueueList';
import { countLabel } from '../../mobile/library';
import { haptic } from '../../mobile/haptics';
import '../../mobile/MobileShell.css';

export function MobileExpandedQueue({ playback, tracks }: { playback: MobilePlayback; tracks: Track[] }) {
  const byPath = useMemo(() => new Map(tracks.map(track => [track.path, track])), [tracks]);
  const [menuId, setMenuId] = useState<string | null>(null), menu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const index = playback.queue.entries.findIndex(entry => entry.id === menuId);
  const current = playback.queue.entries.findIndex(entry => entry.id === playback.queue.currentId);
  const close = () => { setMenuId(null); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  useEffect(() => { if (menuId) menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true }); }, [menuId]);
  useEffect(() => { if (menuId && index < 0) setMenuId(null); }, [index, menuId]);
  return <section className="mep-queue" aria-label="Expanded play queue">
    <header className="mep-queue-header"><div><h2>Play queue</h2><span>{playback.queue.origin || 'Your queue'}</span></div><span>{countLabel(playback.queue.entries.length)}</span></header>
    {playback.error && <div className="mep-queue-error" role="alert"><span>{playback.error}</span><button onClick={() => { void playback.retry(); }}>Retry</button></div>}
    {playback.queue.entries.length ? <MobileQueueList playback={playback} tracks={byPath} onMenu={id => { returnFocus.current = document.activeElement as HTMLElement; setMenuId(id); }} />
      : <div className="mep-queue-empty"><ListMusic size={28} /><span>No queued tracks</span></div>}
    {menuId && <div className="mep-queue-menu-layer" onClick={close}>
      <div ref={menu} className="mep-queue-menu" role="dialog" aria-label="Queue options" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
        <header><strong>Queue options</strong><button aria-label="Close queue options" onClick={close}><X size={18} /></button></header>
        <button disabled={index <= current + 1} onClick={() => { playback.move(menuId, -1); close(); }}><ArrowUp size={18} />Move up</button>
        <button disabled={index <= current || index === playback.queue.entries.length - 1} onClick={() => { playback.move(menuId, 1); close(); }}><ArrowDown size={18} />Move down</button>
        <button disabled={menuId === playback.queue.currentId} onClick={() => { playback.remove(menuId); haptic('confirm'); close(); }}><Trash2 size={18} />Remove from queue</button>
      </div>
    </div>}
  </section>;
}
