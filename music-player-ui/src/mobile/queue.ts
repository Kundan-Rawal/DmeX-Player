import { Track } from '../types';

export interface QueueEntry { id: string; track: Track }
export interface MobileQueue {
  version: 1; entries: QueueEntry[]; currentId: string | null; origin: string;
  shuffle: boolean; repeat: 'OFF' | 'ALL' | 'ONE'; originalOrder: string[];
  history: string[]; position: number;
}
export const emptyQueue = (): MobileQueue => ({ version: 1, entries: [], currentId: null, origin: '', shuffle: false, repeat: 'OFF', originalOrder: [], history: [], position: 0 });
const uid = () => crypto.randomUUID();
export const queueCurrent = (q: MobileQueue) => q.entries.find(e => e.id === q.currentId);
export function createQueue(tracks: Track[], selected: Track, origin: string, shuffle = false): MobileQueue {
  const entries = tracks.map(track => ({ id: uid(), track }));
  const selectedEntry = entries.find(e => e.track.path === selected.path);
  if (!selectedEntry) return emptyQueue();
  const q = { ...emptyQueue(), entries, currentId: selectedEntry.id, origin, originalOrder: entries.map(e => e.id) };
  return shuffle ? shuffleQueue(q, true) : q;
}
export function shuffleQueue(q: MobileQueue, enabled: boolean): MobileQueue {
  if (q.shuffle === enabled) return q;
  const index = q.entries.findIndex(e => e.id === q.currentId);
  const before = q.entries.slice(0, index + 1), upcoming = q.entries.slice(index + 1);
  if (enabled) for (let i = upcoming.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]]; }
  else upcoming.sort((a, b) => q.originalOrder.indexOf(a.id) - q.originalOrder.indexOf(b.id));
  return { ...q, shuffle: enabled, entries: [...before, ...upcoming] };
}
export function advanceQueue(q: MobileQueue, automatic = false): MobileQueue | null {
  const index = q.entries.findIndex(e => e.id === q.currentId);
  if (index < 0 || !q.entries.length) return null;
  if (automatic && q.repeat === 'ONE') return { ...q, position: 0 };
  const next = index + 1 < q.entries.length ? index + 1 : q.repeat === 'ALL' ? 0 : -1;
  if (next < 0) return null;
  return { ...q, currentId: q.entries[next].id, history: [...q.history, q.currentId!].slice(-500), position: 0 };
}
export function previousQueue(q: MobileQueue): MobileQueue | null {
  if (q.position > 3) return { ...q, position: 0 };
  const history = [...q.history];
  let id: string | undefined;
  while (history.length && !id) { const previous = history.pop()!; if (q.entries.some(e => e.id === previous)) id = previous; }
  const index = q.entries.findIndex(e => e.id === q.currentId);
  id ??= index > 0 ? q.entries[index - 1].id : q.repeat === 'ALL' ? q.entries.slice(-1)[0]?.id : undefined;
  return id ? { ...q, currentId: id, history, position: 0 } : { ...q, position: 0 };
}
export function insertQueue(q: MobileQueue, tracks: Track[], next: boolean, afterId?: string): MobileQueue {
  const added = tracks.map(track => ({ id: uid(), track }));
  const index = next ? q.entries.findIndex(e => e.id === (afterId || q.currentId)) + 1 : q.entries.length;
  const entries = [...q.entries]; entries.splice(Math.max(0, index), 0, ...added);
  return { ...q, entries, originalOrder: [...q.originalOrder, ...added.map(e => e.id)] };
}
export function removeQueueEntry(q: MobileQueue, id: string): MobileQueue {
  if (id === q.currentId) return q;
  return { ...q, entries: q.entries.filter(e => e.id !== id), originalOrder: q.originalOrder.filter(key => key !== id), history: q.history.filter(key => key !== id) };
}
export function moveQueueEntry(q: MobileQueue, id: string, direction: -1 | 1): MobileQueue {
  const from = q.entries.findIndex(e => e.id === id), current = q.entries.findIndex(e => e.id === q.currentId), to = from + direction;
  if (from <= current || to <= current || to >= q.entries.length) return q;
  const entries = [...q.entries]; [entries[from], entries[to]] = [entries[to], entries[from]];
  return { ...q, entries, originalOrder: entries.map(e => e.id) };
}
export function moveQueueTo(q: MobileQueue, id: string, target: number): MobileQueue {
  const from = q.entries.findIndex(e => e.id === id), current = q.entries.findIndex(e => e.id === q.currentId);
  if (from <= current || target <= current || target >= q.entries.length || from === target) return q;
  const entries = [...q.entries], [entry] = entries.splice(from, 1); entries.splice(target, 0, entry);
  return { ...q, entries, originalOrder: entries.map(e => e.id) };
}
export function parseQueue(raw: string | null): MobileQueue {
  try {
    const q = JSON.parse(raw || 'null');
    if (q?.version !== 1 || !Array.isArray(q.entries) || q.entries.length > 20000) return emptyQueue();
    const ids = new Set<string>();
    const entries: QueueEntry[] = q.entries.filter((e: QueueEntry) => typeof e?.id === 'string' && !ids.has(e.id) && ids.add(e.id) && typeof e.track?.path === 'string' && typeof e.track?.name === 'string');
    return { ...emptyQueue(), entries, currentId: entries.some(e => e.id === q.currentId) ? q.currentId : entries[0]?.id || null,
      origin: typeof q.origin === 'string' ? q.origin : 'Restored queue', shuffle: q.shuffle === true,
      repeat: ['OFF', 'ALL', 'ONE'].includes(q.repeat) ? q.repeat : 'OFF',
      originalOrder: Array.isArray(q.originalOrder) ? q.originalOrder.filter((id: string) => ids.has(id)) : entries.map(e => e.id),
      history: Array.isArray(q.history) ? q.history.filter((id: string) => ids.has(id)).slice(-500) : [], position: Number.isFinite(q.position) ? Math.max(0, q.position) : 0 };
  } catch { return emptyQueue(); }
}
