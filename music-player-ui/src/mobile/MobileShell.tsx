import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronRight, Circle, Clock3, Disc3, Folder, GripVertical, Heart, History, ListMusic, ListPlus, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Plus, Search, Settings, Shuffle, SkipBack, SkipForward, Trash2, Undo2, Users, X } from 'lucide-react';
import { Track, CustomPlaylist } from '../types';
import { convertFileSrc } from '@tauri-apps/api/core';
import { FolderModal } from '../modals/modals';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { CustomSelect } from '../components/common/CustomSelect';
import { LibraryFilters, MINIMUM_DURATIONS } from '../utils/libraryFilters';
import { artistCacheKey, buildArtistDictionary } from '../utils/artistEngine';
import { formatTime } from '../utils/formatters';
import { CloudFetchView } from '../views/CloudFetchView';
import { BypassAllButton } from '../components/player/AdvancedAudioPanel';
import { albumGroups, countLabel, folderPath, isFeaturedAlbum, MobileRoute, MobileSort, MobileTab, routeTracks, SMART_TITLES, smartTracks, sortTracks } from './library';
import { MobilePlayback } from './useMobilePlayback';
import { MobileQueueList } from './MobileQueueList';
import { MobilePaletteAmbient } from './MobilePaletteAmbient';
import { useArtistArtwork } from './useArtistArtwork';
import './MobileShell.css';

const TABS: { id: MobileTab; label: string }[] = [{ id: 'favourites', label: 'Favourites' }, { id: 'playlists', label: 'Playlists' }, { id: 'tracks', label: 'Tracks' }, { id: 'albums', label: 'Albums' }, { id: 'artists', label: 'Artists' }, { id: 'folders', label: 'Folders' }, { id: 'discover', label: 'Discover' }];
type Sheet = { kind: 'folder' | 'libraryMenu' | 'sort' | 'playlistMenu' | 'track' | 'addPlaylist' | 'createPlaylist' | 'renamePlaylist' | 'deletePlaylist' | 'replaceQueue' | 'queueEntry' | 'clearArtistArt'; track?: Track; paths?: string[]; playlistId?: string; queueId?: string };
interface Navigation { routes: MobileRoute[]; sheet: Sheet | null; selected: string[]; expanded: boolean }
interface Props {
  ready: boolean;
  loadError: string; onRetryLibrary: () => void; totalTracks: number;
  tracks: Track[]; favourites: Set<string>; playlists: CustomPlaylist[]; playback: MobilePlayback;
  currentTrack: Track | null; isExpanded: boolean; onCollapse: () => void; queueRequest: number;
  onScan: (path: string) => Promise<void>; scanning: boolean; scanMessage: string; onDismissScan: () => void;
  apiKey: string; filters: LibraryFilters; onSaveSettings: (key: string, filters: LibraryFilters) => Promise<void>;
  onSavePlaylist: (playlist: CustomPlaylist) => Promise<void>; onDeletePlaylist: (id: string) => Promise<void>;
  onFavourite: (track: Track, favourite: boolean) => Promise<void>; onClearLibrary: () => Promise<void>;
  dark: boolean; onTheme: () => void;
  profileJob: { active: boolean; paused: boolean; done: number; total: number; start: () => void; pause: () => void; resume: () => void; stop: () => void };
  onCloudPlay: (data: any) => Promise<void>;
}
const routeKey = (route: MobileRoute) => JSON.stringify(route);
function useNavigation(expanded: boolean, collapse: () => void) {
  const initial = useRef<Navigation>({ routes: [{ kind: 'library', tab: 'tracks' }], sheet: null, selected: [], expanded: false });
  const [state, setState] = useState(initial.current), stateRef = useRef(state), collapseRef = useRef(collapse);
  stateRef.current = state; collapseRef.current = collapse;
  const session = useRef(crypto.randomUUID());
  const update = useCallback((value: Navigation, push = true) => {
    stateRef.current = value; setState(value);
    window.history[push ? 'pushState' : 'replaceState']({ dmexMobile: session.current, navigation: value }, '');
  }, []);
  useEffect(() => {
    window.history.replaceState({ dmexMobile: session.current, navigation: initial.current }, '');
    const back = (event: PopStateEvent) => {
      const value: Navigation = event.state?.dmexMobile === session.current ? event.state.navigation : initial.current;
      stateRef.current = value; setState(value); if (!value.expanded) collapseRef.current();
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    if (expanded && !stateRef.current.expanded) update({ ...stateRef.current, sheet: null, expanded: true });
    else if (!expanded && stateRef.current.expanded) window.history.back();
  }, [expanded, update]);
  const back = useCallback(() => {
    const s = stateRef.current;
    if (s.sheet || s.selected.length || s.expanded || s.routes.length > 1) window.history.back();
  }, []);
  return { state, back,
    navigate: (route: MobileRoute, replace = false) => update({ routes: replace ? [route] : [...stateRef.current.routes, route], sheet: null, selected: [], expanded: false }, !replace),
    sheet: (sheet: Sheet) => update({ ...stateRef.current, sheet }),
    replaceSheet: (sheet: Sheet) => update({ ...stateRef.current, sheet }, false),
    fromSheet: (route: MobileRoute) => update({ routes: [...stateRef.current.routes, route], sheet: null, selected: [], expanded: false }, false),
    select: (paths: string[]) => update({ ...stateRef.current, selected: paths }, stateRef.current.selected.length === 0 && paths.length > 0),
    closeSheet: back,
  };
}
function Artwork({ track, src, label = '' }: { track?: Track; src?: string; label?: string }) {
  const [failed, setFailed] = useState(false); const image = src || track?.thumb;
  useEffect(() => setFailed(false), [image]);
  return <span className="dmex-artwork">{image && !failed ? <img src={image} alt={label} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Music2 size={22} aria-hidden="true" />}</span>;
}
function RememberedScroll({ scrollKey, positions, className = '', children }: { scrollKey: string; positions: React.RefObject<Record<string, number>>; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.scrollTop = positions.current[scrollKey] || 0; }, [scrollKey, positions]);
  return <div ref={ref} className={`dmex-mobile-page-scroll ${className}`} data-scroll-key={scrollKey} onScroll={event => { positions.current[scrollKey] = event.currentTarget.scrollTop; }}>{children}</div>;
}
function useTabSwipe(enabled: boolean, active: MobileTab | null, onChange: (tab: MobileTab) => void) {
  const surface = useRef<HTMLElement>(null);
  const gesture = useRef<{ x: number; y: number; horizontal: boolean; rejected: boolean } | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    const element = surface.current; if (!element) return;
    const move = (event: TouchEvent) => {
      const start = gesture.current;
      if (!start || start.rejected || event.touches.length !== 1) return;
      const dx = Math.abs(event.touches[0].clientX - start.x), dy = Math.abs(event.touches[0].clientY - start.y);
      if (dx > 10 && dx > dy * 1.4 && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', move, { passive: false });
    return () => element.removeEventListener('touchmove', move);
  }, []);
  const finish = (x: number, y: number) => {
    const start = gesture.current; gesture.current = null;
    if (!start || start.rejected || !active || !enabled) return;
    const dx = x - start.x, dy = y - start.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    moved.current = true;
    const index = TABS.findIndex(tab => tab.id === active), target = index + (dx < 0 ? 1 : -1);
    if (target >= 0 && target < TABS.length) onChange(TABS[target].id);
  };
  return {
    ref: surface,
    onTouchStart: (event: React.TouchEvent) => {
      moved.current = false;
      const target = event.target as Element;
      if (!enabled || event.touches.length !== 1 || target.closest('input,textarea,select,[role="slider"],.dmex-mobile-drag-handle,.custom-select')) { gesture.current = null; return; }
      const touch = event.touches[0]; gesture.current = { x: touch.clientX, y: touch.clientY, horizontal: false, rejected: false };
    },
    onTouchMove: (event: React.TouchEvent) => {
      const start = gesture.current; if (!start) return;
      if (event.touches.length !== 1) { gesture.current = null; return; }
      const touch = event.touches[0], dx = Math.abs(touch.clientX - start.x), dy = Math.abs(touch.clientY - start.y);
      if (!start.horizontal && !start.rejected && Math.max(dx, dy) > 10) {
        start.horizontal = dx > dy * 1.4; start.rejected = !start.horizontal;
      }
    },
    onTouchEnd: (event: React.TouchEvent) => { if (event.changedTouches.length) finish(event.changedTouches[0].clientX, event.changedTouches[0].clientY); },
    onTouchCancel: () => { gesture.current = null; },
    onClickCapture: (event: React.MouseEvent) => {
      const native = event.nativeEvent as PointerEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } };
      if (moved.current && (native.pointerType === 'touch' || native.sourceCapabilities?.firesTouchEvents)) { event.preventDefault(); event.stopPropagation(); }
      moved.current = false;
    },
  };
}
function MobileTabs({ active, onChange }: { active: MobileTab; onChange: (tab: MobileTab) => void }) {
  const ref = useRef<HTMLElement>(null), programmatic = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const center = useCallback((tab: MobileTab, behavior: ScrollBehavior) => {
    const nav = ref.current, target = nav?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!nav || !target) return; programmatic.current = true;
    nav.scrollTo({ left: target.offsetLeft - nav.clientWidth / 2 + target.offsetWidth / 2, behavior });
  }, []);
  useLayoutEffect(() => { center(active, 'smooth'); }, [active, center]);
  useEffect(() => { const observer = new ResizeObserver(() => center(active, 'auto')); if (ref.current) observer.observe(ref.current); return () => { observer.disconnect(); clearTimeout(timer.current); }; }, [active, center]);
  return <nav ref={ref} className="dmex-mobile-tabs" aria-label="Library views" onPointerDown={() => { programmatic.current = false; }} onWheel={() => { programmatic.current = false; }} onScroll={() => {
    clearTimeout(timer.current); timer.current = setTimeout(() => {
      if (programmatic.current) { programmatic.current = false; return; }
      const nav = ref.current!; const middle = nav.scrollLeft + nav.clientWidth / 2;
      const nearest = [...nav.querySelectorAll<HTMLButtonElement>('button')].sort((a, b) => Math.abs(a.offsetLeft + a.offsetWidth / 2 - middle) - Math.abs(b.offsetLeft + b.offsetWidth / 2 - middle))[0];
      if (nearest?.dataset.tab && nearest.dataset.tab !== active) onChange(nearest.dataset.tab as MobileTab);
    }, 160);
  }}><span className="dmex-tab-spacer" />{TABS.map(tab => <button type="button" key={tab.id} data-tab={tab.id} aria-current={active === tab.id ? 'page' : undefined} onClick={() => onChange(tab.id)}>{tab.label}</button>)}<span className="dmex-tab-spacer" /></nav>;
}
function TrackList({ tracks, currentPath, favourites, selected, onPlay, onMenu, onSelect, scrollKey, positions, onReorder }: {
  tracks: Track[]; currentPath?: string; favourites: Set<string>; selected: string[]; onPlay: (track: Track) => void;
  onMenu: (track: Track) => void; onSelect: (paths: string[]) => void; scrollKey: string; positions: React.RefObject<Record<string, number>>; onReorder?: (from: Track, to: Track) => void;
}) {
  const ref = useRef<HTMLDivElement>(null), [scroll, setScroll] = useState(0), [height, setHeight] = useState(600);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pressed = useRef(false), start = useRef({ x: 0, y: 0 });
  const [rowHeight, setRowHeight] = useState(76);
  const reorder = useRef<{ track: Track; target: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!; el.scrollTop = positions.current[scrollKey] || 0; setScroll(el.scrollTop);
    const observer = new ResizeObserver(() => { setHeight(el.clientHeight); setRowHeight(parseFloat(getComputedStyle(el).getPropertyValue('--dmex-row-height')) || 76); }); observer.observe(el);
    return () => observer.disconnect();
  }, [scrollKey, positions]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const begin = Math.max(0, Math.floor(scroll / rowHeight) - 4), end = Math.min(tracks.length, Math.ceil((scroll + height) / rowHeight) + 4);
  const toggle = (track: Track) => onSelect(selected.includes(track.path) ? selected.filter(p => p !== track.path) : [...selected, track.path]);
  return <div ref={ref} className="dmex-mobile-track-scroll" role="list" aria-label="Tracks" onScroll={event => { const top = event.currentTarget.scrollTop; positions.current[scrollKey] = top; setScroll(top); }}>
    <div className="dmex-mobile-track-spacer" style={{ height: tracks.length * rowHeight }}>
      {tracks.slice(begin, end).map((track, i) => <div role="listitem" className={'dmex-mobile-track' + (track.path === currentPath ? ' is-current' : '')} key={track.path} style={{ top: (begin + i) * rowHeight, height: rowHeight }}>
        {track.path === currentPath && <MobilePaletteAmbient className="dmex-mobile-track-ambient" />}
        {onReorder && <button className="dmex-mobile-icon dmex-mobile-drag-handle" aria-label={`Drag to reorder ${track.name}`} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); reorder.current = { track, target: begin + i }; }} onPointerMove={e => {
          if (!reorder.current || !ref.current) return;
          const rect = ref.current.getBoundingClientRect();
          if (e.clientY < rect.top + 40) ref.current.scrollTop -= 12;
          if (e.clientY > rect.bottom - 40) ref.current.scrollTop += 12;
          reorder.current.target = Math.max(0, Math.min(tracks.length - 1, Math.floor((e.clientY - rect.top + ref.current.scrollTop) / rowHeight)));
        }} onPointerUp={() => { if (reorder.current) onReorder(reorder.current.track, tracks[reorder.current.target]); reorder.current = null; }} onPointerCancel={() => { reorder.current = null; }}><GripVertical size={20} /></button>}
        <button type="button" className="dmex-mobile-track-play" aria-label={selected.length ? `${selected.includes(track.path) ? 'Deselect' : 'Select'} ${track.name}` : `Play ${track.name}`} aria-pressed={selected.length ? selected.includes(track.path) : undefined}
          onContextMenu={e => { e.preventDefault(); pressed.current = true; if (!selected.length) onSelect([track.path]); }}
          onPointerDown={e => { if (e.pointerType === 'mouse') return; pressed.current = false; start.current = { x: e.clientX, y: e.clientY }; timer.current = setTimeout(() => { pressed.current = true; if (!selected.length) onSelect([track.path]); }, 550); }}
          onPointerMove={e => { if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clearTimeout(timer.current); }} onPointerUp={() => clearTimeout(timer.current)} onPointerCancel={() => clearTimeout(timer.current)}
          onClick={() => { if (pressed.current) { pressed.current = false; return; } if (!onReorder) selected.length ? toggle(track) : onPlay(track); }}>
          {selected.length ? <span className="dmex-mobile-selection">{selected.includes(track.path) ? <CheckCircle2 size={24} /> : <Circle size={24} />}</span> : <Artwork track={track} />}
          <span className="dmex-mobile-track-text"><span className="dmex-mobile-track-title">{favourites.has(track.path) && <Heart size={12} fill="currentColor" />}{track.name}</span><span className="dmex-mobile-track-artist">{track.artist || 'Unknown Artist'}</span></span>
          <span className="dmex-mobile-duration">{track.duration ? formatTime(track.duration) : ''}</span>
        </button>
        {!selected.length && <button type="button" className="dmex-mobile-icon" aria-label={`Options for ${track.name}`} onClick={() => onMenu(track)}><MoreHorizontal size={20} /></button>}
      </div>)}
    </div>
  </div>;
}
function Action({ icon: Icon, children, onClick, danger = false, disabled = false }: { icon?: React.ComponentType<{ size?: number }>; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return <button type="button" className={'dmex-mobile-action' + (danger ? ' is-danger' : '')} onClick={onClick} disabled={disabled}>{Icon && <Icon size={20} />}<span>{children}</span></button>;
}
function SheetFrame({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') { const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]') || [])]; if (!items.length) return; const first = items[0], last = items.slice(-1)[0]!; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }; document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="dmex-mobile-sheet-backdrop" onClick={close}><div className="dmex-mobile-sheet" ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><header><h2>{title}</h2><button type="button" className="dmex-mobile-icon" aria-label="Close menu" onClick={close}><X size={21} /></button></header><div className="dmex-mobile-sheet-body">{children}</div></div></div>;
}
function SettingsPage({ p, notify }: { p: Props; notify: (message: string) => void }) {
  const [key, setKey] = useState(p.apiKey), [filters, setFilters] = useState(p.filters), [busy, setBusy] = useState(false);
  return <div className="dmex-mobile-page-scroll"><section className="dmex-mobile-settings-group"><h2>Library</h2><label className="dmex-mobile-setting"><span>Minimum duration</span><CustomSelect label="Minimum duration" value={filters.minimumDuration} options={MINIMUM_DURATIONS.map(v => ({ value: String(v), label: v ? `${v} seconds` : 'Off' }))} onChange={v => setFilters(f => ({ ...f, minimumDuration: Number(v) }))} /></label><div className="dmex-mobile-setting"><span>Skip call recordings</span><ToggleSwitch label="Skip call recordings" checked={filters.skipCallRecordings} onChange={value => setFilters(f => ({ ...f, skipCallRecordings: value }))} /></div></section>
    <section className="dmex-mobile-settings-group"><h2>Appearance</h2><div className="dmex-mobile-setting"><span>Dark appearance</span><ToggleSwitch label="Dark appearance" checked={p.dark} onChange={p.onTheme} /></div><p className="dmex-mobile-secondary">Album artwork supplies your playback colors.</p></section>
    <section className="dmex-mobile-settings-group"><h2>Audio</h2><BypassAllButton /><p className="dmex-mobile-secondary">Advanced sound controls remain in the expanded player.</p></section>
    <section className="dmex-mobile-settings-group"><h2>Lyrics</h2><label className="dmex-mobile-field">Gemini API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Optional API key" /></label><p className="dmex-mobile-secondary">Optional song identification when lyrics search fails. Online lyrics search works without a key. Your key stays on this device.</p>{key && <button type="button" className="dmex-mobile-text-button" onClick={() => setKey('')}>Remove key</button>}</section>
    <button className="dmex-mobile-primary" disabled={busy} onClick={async () => { setBusy(true); try { await p.onSaveSettings(key, filters); notify('Settings saved'); } catch { notify('Settings could not be saved. Please retry.'); } finally { setBusy(false); } }}>{busy ? 'Saving...' : 'Save settings'}</button>
    <section className="dmex-mobile-settings-group"><h2>About</h2><p>DmeX Player</p><p className="dmex-mobile-secondary">Local music. Your sound.</p></section>
  </div>;
}
export function MobileShell(p: Props) {
  const nav = useNavigation(p.isExpanded, p.onCollapse), { state } = nav, route = state.routes.slice(-1)[0]!;
  const [sort, setSort] = useState<MobileSort>(() => { const stored = localStorage.getItem('dmex_mobile_sort'); return ['title', 'artist', 'added', 'duration'].includes(stored || '') ? stored as MobileSort : 'added'; });
  const [query, setQuery] = useState(''), [draftName, setDraftName] = useState(''), [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<null | (() => void)>(null), positions = useRef<Record<string, number>>({}), navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => { if (p.queueRequest) navRef.current.navigate({ kind: 'queue' }); }, [p.queueRequest]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => { setNotice(''); setUndo(null); }, 5500); return () => clearTimeout(timer); }, [notice]);
  const notify = useCallback((message: string) => { setNotice(message); setUndo(null); }, []);
  const albums = useMemo(() => albumGroups(p.tracks), [p.tracks]);
  const artists = useMemo(() => buildArtistDictionary(p.tracks).sort((a, b) => a.name.localeCompare(b.name)), [p.tracks]);
  const artistArt = useArtistArtwork(artists.map(artist => artist.name)), artistImages = artistArt.images;
  const folders = useMemo(() => { const map = new Map<string, Track[]>(); p.tracks.forEach(t => { const key = folderPath(t); const value = map.get(key) || []; value.push(t); map.set(key, value); }); return [...map].sort(([a], [b]) => a.localeCompare(b)); }, [p.tracks]);
  const byPath = useMemo(() => new Map(p.tracks.map(t => [t.path, t])), [p.tracks]);
  const root = route.kind === 'library', tab = root ? route.tab : null;
  const routePlaylist = route.kind === 'playlist' || route.kind === 'playlistEdit' ? p.playlists.find(pl => pl.id === route.id) : undefined;
  const title = root ? 'DmeX Player' : route.kind === 'collection' ? SMART_TITLES[route.id] : route.kind === 'playlist' || route.kind === 'playlistEdit' ? routePlaylist?.name || 'Playlist unavailable' : route.kind === 'album' ? albums.find(a => a.id === route.id)?.name || 'Album' : route.kind === 'artist' ? artists.find(a => a.id === route.id)?.name || 'Artist' : route.kind === 'folder' ? route.id.split(/[\\/]/).slice(-1)[0] || route.id : route.kind === 'queue' ? 'Play queue' : route.kind === 'settings' ? 'Settings' : route.kind === 'activity' ? 'Library activity' : 'Search';
  const baseTracks = useMemo(() => routeTracks(route, p.tracks, p.favourites, p.playlists, p.playback.recent), [route, p.tracks, p.favourites, p.playlists, p.playback.recent]);
  const list = useMemo(() => route.kind === 'playlist' || route.kind === 'playlistEdit' || route.kind === 'collection' || route.kind === 'album' ? baseTracks : sortTracks(baseTracks, sort), [baseTracks, route.kind, sort]);
  const selection = state.selected.map(path => byPath.get(path)).filter((t): t is Track => !!t);
  const searchTracks = useMemo(() => { const q = query.trim().toLocaleLowerCase(); return q ? p.tracks.filter(t => `${t.name} ${t.artist} ${t.album}`.toLocaleLowerCase().includes(q)) : []; }, [query, p.tracks]);
  const searchAlbums = useMemo(() => query.trim() ? albums.filter(a => `${a.name} ${a.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8) : [], [query, albums]);
  const searchArtists = useMemo(() => query.trim() ? artists.filter(a => a.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 8) : [], [query, artists]);
  const replacePending = useRef<{ tracks: Track[]; track: Track; origin: string; shuffled: boolean } | null>(null);
  const play = (tracks: Track[], track: Track, origin = title, shuffled = false) => {
    const current = p.playback.queue.entries.findIndex(e => e.id === p.playback.queue.currentId);
    if (p.playback.queue.entries.length > current + 1 && p.playback.queue.origin !== origin) { replacePending.current = { tracks, track, origin, shuffled }; nav.sheet({ kind: 'replaceQueue' }); return; }
    void p.playback.start(tracks, track, origin, shuffled);
  };
  const add = (tracks: Track[], next: boolean) => { p.playback.add(tracks, next); nav.closeSheet(); notify(`${countLabel(tracks.length)} ${next ? 'will play next' : 'added to queue'}`); };
  const openCreate = (paths: string[] = []) => { setDraftName(''); nav.sheet({ kind: 'createPlaylist', paths }); };
  const savePlaylist = async (playlist: CustomPlaylist, success: string) => { setSaving(true); try { await p.onSavePlaylist(playlist); nav.closeSheet(); notify(success); } catch { notify('Playlist could not be saved. Please retry.'); } finally { setSaving(false); } };
  const trackMenu = (track: Track) => nav.sheet({ kind: 'track', track });
  const reorderPlaylistTrack = async (from: Track, to: Track) => {
    if (!routePlaylist || from.path === to.path || saving) return;
    const paths = [...routePlaylist.trackPaths], first = paths.indexOf(from.path), last = paths.indexOf(to.path);
    if (first < 0 || last < 0) return;
    const [moved] = paths.splice(first, 1); paths.splice(last, 0, moved); setSaving(true);
    try { await p.onSavePlaylist({ ...routePlaylist, trackPaths: paths }); } catch { notify('Playlist order could not be saved.'); } finally { setSaving(false); }
  };
  const trackList = (tracks: Track[], key: string, origin = title) => <TrackList tracks={tracks} currentPath={p.currentTrack?.path} favourites={p.favourites} selected={state.selected} onSelect={nav.select} onPlay={track => play(tracks, track, origin)} onMenu={trackMenu} scrollKey={key} positions={positions} onReorder={route.kind === 'playlistEdit' ? (from, to) => { void reorderPlaylistTrack(from, to); } : undefined} />;
  const empty = (heading: string, text: string) => <div className="dmex-mobile-empty"><Music2 size={34} /><h2>{heading}</h2><p>{text}</p>{p.ready && !p.scanning && p.totalTracks === 0 && <button className="dmex-mobile-primary" onClick={() => nav.sheet({ kind: 'folder' })}><Plus size={18} />Add music</button>}</div>;
  const sheet = state.sheet;
  const sheetTitle = sheet?.kind === 'clearArtistArt' ? 'Clear artist artwork?' : sheet?.kind === 'queueEntry' ? 'Queue options' : null;
  const track = sheet?.track;
  const queueIndex = p.playback.queue.entries.findIndex(entry => entry.id === sheet?.queueId);
  const currentQueueIndex = p.playback.queue.entries.findIndex(entry => entry.id === p.playback.queue.currentId);
  const isList = (root && ['tracks', 'favourites'].includes(tab!)) || ['collection', 'playlist', 'playlistEdit', 'album', 'artist', 'folder'].includes(route.kind);
  const tabSwipe = useTabSwipe(root && !sheet && !state.selected.length && !p.isExpanded, tab, value => nav.navigate({ kind: 'library', tab: value }, true));
  return <div className="dmex-mobile-shell" data-player-open={p.isExpanded}>
    <header className={'dmex-mobile-header' + (!root ? ' is-detail' : '')}>
      {!root && <button className="dmex-mobile-icon" aria-label="Back" onClick={nav.back}><ArrowLeft size={23} /></button>}
      <h1>{state.selected.length ? `${state.selected.length} selected` : root ? <span className="dmex-mobile-wordmark" aria-label="DmeX Player"><img className="app-brand-mark" src="/branding/dmex-d-transparent.png" alt="" aria-hidden="true" width={32} height={38} draggable={false} /><span>meX Player</span></span> : title}</h1>
      {state.selected.length ? <button className="dmex-mobile-icon" aria-label="Cancel selection" onClick={nav.back}><X size={22} /></button> : <>
        {root && <button className="dmex-mobile-icon" aria-label="Search library" onClick={() => { setQuery(''); nav.navigate({ kind: 'search' }); }}><Search size={22} /></button>}
        {root ? <button className="dmex-mobile-icon" aria-label="Library options" onClick={() => nav.sheet({ kind: 'libraryMenu' })}><MoreHorizontal size={23} /></button> : route.kind === 'playlist' && routePlaylist ? <button className="dmex-mobile-icon" aria-label="Playlist options" onClick={() => nav.sheet({ kind: 'playlistMenu', playlistId: routePlaylist.id })}><MoreHorizontal size={23} /></button> : null}
      </>}
    </header>
    {root && !state.selected.length && <MobileTabs active={tab!} onChange={value => nav.navigate({ kind: 'library', tab: value }, true)} />}
    {p.scanning && <button className="dmex-mobile-job-strip" onClick={() => nav.navigate({ kind: 'activity' })}><LoaderCircle size={15} /><span>{p.scanMessage || 'Updating library'}</span><ChevronRight size={17} /></button>}
    {p.playback.error && <div className="dmex-mobile-error" role="alert"><span>{p.playback.error}</span><button onClick={() => void p.playback.retry()}>Retry</button><button className="dmex-mobile-icon" aria-label="Dismiss playback error" onClick={p.playback.dismissError}><X size={17} /></button></div>}
    <main className="dmex-mobile-main" {...tabSwipe} inert={!!sheet} aria-hidden={sheet ? true : undefined} aria-busy={!p.ready}>
      {!p.ready || (p.scanning && !p.tracks.length) ? p.loadError ? <div className="dmex-mobile-empty" role="alert"><Music2 size={34} /><h2>Library unavailable</h2><p>{p.loadError}</p><button className="dmex-mobile-primary" onClick={p.onRetryLibrary}>Retry loading library</button></div> : <div className="dmex-mobile-loading" role="status" aria-label="Loading music library">{Array.from({ length: 9 }, (_, index) => <div className="dmex-mobile-loading-row" aria-hidden="true" key={index}><span className="dmex-mobile-loading-art" /><span className="dmex-mobile-loading-text" /></div>)}</div> : <>
      {route.kind === 'playlistEdit' && <div className="dmex-mobile-selection-bar"><span>Drag tracks to reorder</span><button onClick={nav.back}>Done</button></div>}
      {state.selected.length > 0 && <div className="dmex-mobile-selection-bar"><button onClick={() => nav.select(list.map(t => t.path))}>Select all</button><button aria-label="Play selected" onClick={() => { if (selection[0]) { void p.playback.start(selection, selection[0], 'Selected tracks'); nav.back(); } }}><Play size={19} /></button><button aria-label="Queue selected" onClick={() => { p.playback.add(selection, false); notify(`${countLabel(selection.length)} added to queue`); }}><ListPlus size={21} /></button><button aria-label="Add selection to playlist" onClick={() => nav.sheet({ kind: 'addPlaylist', paths: state.selected })}><Plus size={22} /></button></div>}
      {isList && <>
        {!root && <div className="dmex-mobile-collection-summary"><Artwork track={list.find(t => t.thumb)} /><div><strong>{countLabel(list.length)}</strong><span>{formatTime(list.reduce((sum, t) => sum + (t.duration || 0), 0))} total{route.kind === 'collection' && route.id === 'mostPlayed' ? ' · Ranked by plays' : ''}</span></div><button className="dmex-mobile-icon" aria-label="Shuffle collection" disabled={!list.length} onClick={() => play(list, list[0], title, true)}><Shuffle size={21} /></button><button className="dmex-mobile-play-collection" aria-label="Play collection" disabled={!list.length} onClick={() => play(list, list[0])}><Play size={22} fill="currentColor" /></button></div>}
        {root && <div className="dmex-mobile-list-toolbar"><span>{countLabel(list.length)}</span><button onClick={() => nav.sheet({ kind: 'sort' })}>{sort === 'added' ? 'Recently added' : sort === 'title' ? 'Title' : sort === 'artist' ? 'Artist' : 'Duration'}<ArrowDown size={15} /></button><button className="dmex-mobile-icon" aria-label="Shuffle tracks" disabled={!list.length} onClick={() => play(list, list[0], tab === 'favourites' ? 'Favourites' : 'Tracks', true)}><Shuffle size={20} /></button></div>}
        {list.length ? trackList(list, routeKey(route), root ? tab === 'favourites' ? 'Favourites' : 'Tracks' : title) : empty(root && tab === 'favourites' ? 'Your favourites belong here' : 'No tracks here yet', root && tab === 'favourites' ? 'Favourite a track from its menu or the player.' : p.tracks.length ? 'Add tracks to this collection to get started.' : 'Choose the music you want in your library.')}
      </>}
      {root && tab === 'playlists' && <RememberedScroll key="playlists" scrollKey={routeKey(route)} positions={positions}><div className="dmex-mobile-smart-grid">{(['recentlyAdded', 'recentlyPlayed', 'mostPlayed'] as const).map((id, i) => { const tracks = smartTracks(id, p.tracks, p.playback.recent); const Icon = [Clock3, History, ListMusic][i]; return <button className="dmex-mobile-smart" key={id} onClick={() => nav.navigate({ kind: 'collection', id })}><span className="dmex-mobile-smart-icon"><Icon size={24} /></span><strong>{SMART_TITLES[id]}</strong><span>{countLabel(tracks.length)}</span></button>; })}</div><div className="dmex-mobile-section-title"><h2>My playlists</h2><button className="dmex-mobile-icon" aria-label="Create playlist" onClick={() => openCreate()}><Plus size={23} /></button></div>{!p.playlists.length && <p className="dmex-mobile-secondary">Your playlists will appear here.</p>}{p.playlists.map(pl => { const tracks = pl.trackPaths.map(path => byPath.get(path)).filter((t): t is Track => !!t); return <div className="dmex-mobile-entity-row" key={pl.id}><button onClick={() => nav.navigate({ kind: 'playlist', id: pl.id })}><Artwork track={tracks[0]} /><span><strong>{pl.name}</strong><small>{countLabel(tracks.length)}{tracks.length < pl.trackPaths.length ? ` · ${pl.trackPaths.length - tracks.length} unavailable` : ''}</small></span></button><button className="dmex-mobile-icon" aria-label={`Options for playlist ${pl.name}`} onClick={() => nav.sheet({ kind: 'playlistMenu', playlistId: pl.id })}><MoreHorizontal size={21} /></button></div>; })}</RememberedScroll>}
      {root && tab === 'albums' && <RememberedScroll key="albums" scrollKey={routeKey(route)} positions={positions}><div className="dmex-mobile-list-toolbar"><span>{countLabel(albums.length, 'album')}</span></div><div className="dmex-mobile-album-grid">{albums.map(album => <button className={'dmex-mobile-album' + (isFeaturedAlbum(album.id) ? ' is-featured' : '')} key={album.id} onClick={() => nav.navigate({ kind: 'album', id: album.id })}><Artwork src={album.thumb} /><strong>{album.name}</strong><span>{album.artist}</span></button>)}</div>{!albums.length && empty('No albums yet', 'Your albums appear when you add music.')}</RememberedScroll>}
      {root && tab === 'artists' && <RememberedScroll key="artists" scrollKey={routeKey(route)} positions={positions}><div className="dmex-mobile-list-toolbar"><span>{countLabel(artists.length, 'artist')}</span></div>{artists.map(artist => <button className="dmex-mobile-simple-row dmex-mobile-artist-row" key={artist.id} onClick={() => nav.navigate({ kind: 'artist', id: artist.id })}>{artistImages[artistCacheKey(artist.name)] ? <Artwork src={convertFileSrc(artistImages[artistCacheKey(artist.name)])} /> : <span className="dmex-mobile-initial">{artist.name.slice(0, 1).toLocaleUpperCase()}</span>}<span><strong>{artist.name}</strong><small>{countLabel(artist.trackIds.length)}</small></span><ChevronRight size={18} /></button>)}{!artists.length && empty('No artists yet', 'Your artists appear when you add music.')}</RememberedScroll>}
      {root && tab === 'folders' && <RememberedScroll key="folders" scrollKey={routeKey(route)} positions={positions}><div className="dmex-mobile-section-title"><h2>Music sources</h2><button className="dmex-mobile-icon" aria-label="Add music folder" onClick={() => nav.sheet({ kind: 'folder' })}><Plus size={22} /></button></div>{folders.map(([folder, tracks]) => <button className="dmex-mobile-simple-row" key={folder} onClick={() => nav.navigate({ kind: 'folder', id: folder })}><Folder size={25} /><span><strong>{folder.split(/[\\/]/).slice(-1)[0] || folder}</strong><small>{countLabel(tracks.length)}</small></span><ChevronRight size={18} /></button>)}{!folders.length && empty('Choose your music', 'Add a music folder or scan your Android audio library.')}</RememberedScroll>}
      {root && tab === 'discover' && <RememberedScroll key="discover" scrollKey={routeKey(route)} positions={positions} className="dmex-mobile-discover"><CloudFetchView onPlayCloudTrack={p.onCloudPlay} /></RememberedScroll>}
      {route.kind === 'search' && <><label className="dmex-mobile-search"><Search size={20} /><input aria-label="Search library" autoFocus value={query} placeholder="Tracks, albums, artists, playlists" onChange={e => setQuery(e.target.value)} />{query && <button className="dmex-mobile-icon" aria-label="Clear search" onClick={() => setQuery('')}><X size={18} /></button>}</label>{query.trim() ? <><div className="dmex-mobile-search-entities">{searchAlbums.map(a => <button key={a.id} onClick={() => nav.navigate({ kind: 'album', id: a.id })}><Disc3 size={16} /><span>{a.name}</span></button>)}{searchArtists.map(a => <button key={a.id} onClick={() => nav.navigate({ kind: 'artist', id: a.id })}><Users size={16} /><span>{a.name}</span></button>)}{p.playlists.filter(pl => pl.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(pl => <button key={pl.id} onClick={() => nav.navigate({ kind: 'playlist', id: pl.id })}><ListMusic size={16} /><span>{pl.name}</span></button>)}</div><div className="dmex-mobile-list-toolbar"><span>{countLabel(searchTracks.length)}</span></div>{searchTracks.length ? trackList(searchTracks, `search:${query}`, 'Search results') : empty('No matching tracks', 'Try a song name, artist or album.')}</> : empty('Find your next listen', 'Search your local library. Online music stays in Discover.')}</>}
      {route.kind === 'queue' && <>
        <div className="dmex-mobile-queue-toolbar">
          <div><strong>{p.playback.queue.origin || 'Your queue'}</strong><span>{countLabel(p.playback.queue.entries.length)}{p.playback.queue.currentId ? ` · ${p.playback.queue.entries.findIndex(e => e.id === p.playback.queue.currentId) + 1} of ${p.playback.queue.entries.length}` : ''}</span></div>
          <button className="dmex-mobile-icon" aria-label="Save queue as playlist" disabled={!p.playback.queue.entries.length} onClick={() => openCreate(p.playback.queue.entries.map(e => e.track.path))}><ListPlus size={21} /></button>
          <button className="dmex-mobile-icon" aria-label="Clear upcoming tracks" disabled={!p.playback.queue.entries.length} onClick={() => { const snapshot = p.playback.queue; p.playback.clear(); setNotice('Upcoming tracks cleared'); setUndo(() => () => p.playback.replace(snapshot)); }}><Trash2 size={20} /></button>
        </div>
        <div className="dmex-mobile-queue-modes"><button aria-pressed={p.playback.queue.shuffle} onClick={p.playback.toggleShuffle}><Shuffle size={17} />Shuffle {p.playback.queue.shuffle ? 'on' : 'off'}</button><button onClick={p.playback.toggleRepeat}>Repeat: {p.playback.queue.repeat.toLocaleLowerCase()}</button></div>
        {p.playback.queue.entries.length ? <MobileQueueList playback={p.playback} tracks={byPath} onMenu={id => nav.sheet({ kind: 'queueEntry', queueId: id })} /> : empty('A little room for music', 'Play a track, or add something from its menu.')}
      </>}
      {route.kind === 'settings' && <SettingsPage p={p} notify={notify} />}
      {route.kind === 'activity' && <div className="dmex-mobile-page-scroll">
        <section className="dmex-mobile-settings-group"><h2>Library scan</h2><p role="status">{p.scanMessage || 'Your library is ready.'}</p><button className="dmex-mobile-primary" disabled={p.scanning} onClick={() => nav.sheet({ kind: 'folder' })}>Scan music</button>{p.scanMessage && <button className="dmex-mobile-text-button" onClick={p.onDismissScan}>Dismiss message</button>}</section>
        <section className="dmex-mobile-settings-group"><h2>Artist artwork</h2>
          <p>{artistArt.missing ? `${countLabel(artistArt.missing, 'artist')} missing artwork` : 'Artwork is up to date.'}</p>
          {artistArt.status.total > 0 && <p role="status">{artistArt.status.done} of {artistArt.status.total} checked{artistArt.status.failed ? ` · ${artistArt.status.failed} unavailable` : ''}</p>}
          <div className="dmex-mobile-inline-actions">
            <button disabled={!artistArt.status.running && !artistArt.missing} onClick={artistArt.status.running ? artistArt.pause : artistArt.start}>{artistArt.status.running ? 'Pause artwork sync' : artistArt.status.done < artistArt.status.total ? 'Resume artwork sync' : 'Sync missing artwork'}</button>
            <button disabled={artistArt.status.running || !Object.keys(artistImages).length} onClick={() => nav.sheet({ kind: 'clearArtistArt' })}>Clear artwork cache</button>
          </div>
        </section>
        <section className="dmex-mobile-settings-group"><h2>Audio profile analysis</h2><p className="dmex-mobile-secondary">Optional analysis. Your music plays without it.</p><p>{p.profileJob.active ? `${p.profileJob.done} of ${p.profileJob.total} analyzed` : countLabel(p.tracks.filter(t => !t.profile).length) + ' not analyzed'}</p>{p.profileJob.active ? <div className="dmex-mobile-inline-actions"><button onClick={p.profileJob.paused ? p.profileJob.resume : p.profileJob.pause}>{p.profileJob.paused ? 'Resume' : 'Pause'}</button><button onClick={p.profileJob.stop}>Stop</button></div> : <button className="dmex-mobile-text-button" onClick={p.profileJob.start}>Analyze audio profiles</button>}</section>
      </div>}
      </>}
    </main>
    {notice && <div className="dmex-mobile-snackbar" role="status"><span>{notice}</span>{undo && <button aria-label="Undo" onClick={() => { undo(); setNotice('Change undone'); setUndo(null); }}><Undo2 size={17} />Undo</button>}<button className="dmex-mobile-icon" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {sheet?.kind === 'folder' && <FolderModal onClose={nav.closeSheet} onScan={path => { void p.onScan(path); }} />}
    {sheet && sheet.kind !== 'folder' && sheet.kind !== 'replaceQueue' && <SheetFrame title={sheetTitle || (sheet.kind === 'track' ? track?.name || 'Track options' : sheet.kind === 'sort' ? 'Sort tracks' : sheet.kind === 'libraryMenu' ? 'Library options' : sheet.kind === 'addPlaylist' ? 'Add to playlist' : sheet.kind === 'createPlaylist' ? 'Create playlist' : sheet.kind === 'renamePlaylist' ? 'Rename playlist' : sheet.kind === 'deletePlaylist' ? 'Delete playlist?' : 'Playlist options')} close={nav.closeSheet}>
      {sheet.kind === 'libraryMenu' && <><Action icon={Plus} onClick={() => nav.replaceSheet({ kind: 'folder' })}>Add music</Action><Action icon={ListMusic} onClick={() => nav.fromSheet({ kind: 'queue' })}>Play queue</Action><Action icon={History} onClick={() => nav.fromSheet({ kind: 'activity' })}>Library activity</Action><Action icon={Settings} onClick={() => nav.fromSheet({ kind: 'settings' })}>Settings</Action></>}
      {sheet.kind === 'clearArtistArt' && <><p>Downloaded artist images will be removed. Music files and album covers will stay on this device.</p><Action icon={Trash2} danger disabled={saving} onClick={async () => { setSaving(true); try { await artistArt.clear(); nav.closeSheet(); notify('Artist artwork cache cleared'); } catch (error) { notify(error instanceof Error ? error.message : 'Artwork cache could not be cleared.'); } finally { setSaving(false); } }}>Clear artist artwork</Action></>}
      {sheet.kind === 'sort' && (['added', 'title', 'artist', 'duration'] as MobileSort[]).map(mode => <Action icon={sort === mode ? Check : undefined} key={mode} onClick={() => { setSort(mode); localStorage.setItem('dmex_mobile_sort', mode); nav.closeSheet(); }}>{mode === 'added' ? 'Date added, newest first' : mode === 'title' ? 'Title, A to Z' : mode === 'artist' ? 'Artist, A to Z' : 'Duration, longest first'}</Action>)}
      {sheet.kind === 'queueEntry' && <>
        <Action icon={ArrowUp} disabled={queueIndex <= currentQueueIndex + 1} onClick={() => { p.playback.move(sheet.queueId!, -1); nav.closeSheet(); }}>Move up</Action>
        <Action icon={ArrowDown} disabled={queueIndex <= currentQueueIndex || queueIndex === p.playback.queue.entries.length - 1} onClick={() => { p.playback.move(sheet.queueId!, 1); nav.closeSheet(); }}>Move down</Action>
        <Action icon={Trash2} disabled={sheet.queueId === p.playback.queue.currentId} onClick={() => {
          const snapshot = p.playback.queue; p.playback.remove(sheet.queueId!); nav.closeSheet();
          setNotice('Track removed from queue'); setUndo(() => () => p.playback.replace(snapshot));
        }}>Remove from queue</Action>
      </>}
      {sheet.kind === 'track' && track && <>
        <Action icon={SkipForward} onClick={() => add([track], true)}>Play next</Action>
        <Action icon={ListPlus} onClick={() => add([track], false)}>Add to queue</Action>
        <Action icon={Plus} onClick={() => nav.replaceSheet({ kind: 'addPlaylist', paths: [track.path] })}>Add to playlist</Action>
        <Action icon={Heart} onClick={async () => {
          const wasFavourite = p.favourites.has(track.path);
          try { await p.onFavourite(track, !wasFavourite); nav.closeSheet(); notify(wasFavourite ? 'Removed from favourites' : 'Added to favourites'); }
          catch { notify('Favourite could not be saved. Please retry.'); }
        }}>{p.favourites.has(track.path) ? 'Remove favourite' : 'Add favourite'}</Action>
        <Action icon={Disc3} onClick={() => { const album = albums.find(a => a.tracks.some(t => t.path === track.path)); if (album) nav.fromSheet({ kind: 'album', id: album.id }); }}>Go to album</Action>
        <Action icon={Users} onClick={() => { const artist = artists.find(a => a.trackIds.includes(track.path)); if (artist) nav.fromSheet({ kind: 'artist', id: artist.id }); }}>Go to artist</Action>
        {(route.kind === 'playlist' || route.kind === 'playlistEdit') && routePlaylist && <>
          {route.kind === 'playlistEdit' && <><Action icon={ArrowUp} disabled={list[0]?.path === track.path} onClick={() => { const index = list.findIndex(t => t.path === track.path); if (index > 0) void reorderPlaylistTrack(track, list[index - 1]); nav.closeSheet(); }}>Move up</Action><Action icon={ArrowDown} disabled={list[list.length - 1]?.path === track.path} onClick={() => { const index = list.findIndex(t => t.path === track.path); if (index + 1 < list.length) void reorderPlaylistTrack(track, list[index + 1]); nav.closeSheet(); }}>Move down</Action></>}
          <Action icon={Trash2} onClick={() => { const original = routePlaylist; void savePlaylist({ ...original, trackPaths: original.trackPaths.filter(path => path !== track.path) }, 'Removed from playlist'); }} danger>Remove from this playlist</Action>
        </>}
        <div className="dmex-mobile-track-details"><span>{track.artist}</span><span>{track.album}</span><span>{track.quality || 'Local audio'} · {formatTime(track.duration)}</span></div>
      </>}
      {sheet.kind === 'addPlaylist' && <><Action icon={Plus} onClick={() => { setDraftName(''); nav.replaceSheet({ kind: 'createPlaylist', paths: sheet.paths }); }}>Create and add</Action>{p.playlists.map(pl => <Action key={pl.id} icon={ListMusic} onClick={() => { void savePlaylist({ ...pl, trackPaths: [...new Set([...pl.trackPaths, ...(sheet.paths || [])])] }, `Added to ${pl.name}`); }} disabled={saving}>{pl.name}</Action>)}</>}
      {(sheet.kind === 'createPlaylist' || sheet.kind === 'renamePlaylist') && <form onSubmit={e => { e.preventDefault(); const name = draftName.trim(); if (!name || saving) return; const existing = p.playlists.find(pl => pl.id === sheet.playlistId); void savePlaylist({ id: existing?.id || crypto.randomUUID(), name, trackPaths: existing?.trackPaths || [...new Set(sheet.paths || [])] }, existing ? 'Playlist renamed' : 'Playlist created'); }}><label className="dmex-mobile-field">Playlist name<input autoFocus aria-label="Playlist name" value={draftName} maxLength={120} onChange={e => setDraftName(e.target.value)} placeholder="Give it a name" required /></label><button className="dmex-mobile-primary" type="submit" disabled={saving || !draftName.trim()}>{saving ? 'Saving...' : sheet.paths?.length ? 'Create and add' : 'Save playlist'}</button></form>}
      {sheet.kind === 'playlistMenu' && <><Action icon={GripVertical} onClick={() => nav.fromSheet({ kind: 'playlistEdit', id: sheet.playlistId! })}>Edit track order</Action><Action icon={ListMusic} onClick={() => { setDraftName(p.playlists.find(pl => pl.id === sheet.playlistId)?.name || ''); nav.replaceSheet({ kind: 'renamePlaylist', playlistId: sheet.playlistId }); }}>Rename playlist</Action><Action icon={Trash2} danger onClick={() => nav.replaceSheet({ kind: 'deletePlaylist', playlistId: sheet.playlistId })}>Delete playlist</Action></>}
      {sheet.kind === 'deletePlaylist' && <><p>Only the playlist is removed. Your music files stay on this device.</p><Action icon={Trash2} danger disabled={saving} onClick={async () => { setSaving(true); try { await p.onDeletePlaylist(sheet.playlistId!); nav.closeSheet(); notify('Playlist deleted'); } catch { notify('Playlist could not be deleted.'); } finally { setSaving(false); } }}>Delete playlist</Action></>}
    </SheetFrame>}
    {sheet?.kind === 'replaceQueue' && <SheetFrame title="Replace your queue?" close={nav.closeSheet}><p>Your upcoming tracks will be replaced by this collection.</p><Action icon={Play} onClick={() => { const value = replacePending.current; if (value) void p.playback.start(value.tracks, value.track, value.origin, value.shuffled); nav.closeSheet(); }}>Replace and play</Action><Action icon={ListPlus} onClick={() => { const value = replacePending.current; if (value) p.playback.add(value.tracks, false); nav.closeSheet(); notify('Added to your existing queue'); }}>Add to existing queue</Action></SheetFrame>}
  </div>;
}
export function MobileMiniPlayer({ isExpanded, onExpand, onQueue, track, title, artist, art, playing, busy, onPlayPause, onPrevious, onNext, time, duration }: { isExpanded: boolean; onExpand: () => void; onQueue: () => void; track: Track | null; title: string; artist: string; art: string | null; playing: boolean; busy: boolean; onPlayPause: () => void; onPrevious: () => void; onNext: () => void; time: number; duration: number }) {
  return <div className="dmex-mobile-mini" style={{ opacity: isExpanded ? 0 : 1, pointerEvents: isExpanded ? 'none' : 'auto' }}>
    {track && <MobilePaletteAmbient className="dmex-mobile-mini-ambient" />}
    <span className="dmex-mobile-mini-progress" style={{ width: `${Math.min(100, Math.max(0, duration ? time / duration * 100 : 0))}%` }} />
    <button className="dmex-mobile-mini-info" onClick={onExpand} disabled={!track} aria-label="Open expanded player"><Artwork src={art || undefined} /><span><strong>{track ? title : 'Your music, ready when you are'}</strong><small>{track ? artist : 'Choose a track to begin'}</small></span></button>
    <button className="dmex-mobile-icon dmex-mobile-mini-prev" aria-label="Previous track" disabled={!track} onClick={onPrevious}><SkipBack size={20} fill="currentColor" /></button>
    <button className="dmex-mobile-icon" aria-label={playing ? 'Pause' : 'Play'} disabled={!track || busy} onClick={onPlayPause}>{busy ? <LoaderCircle size={23} /> : playing ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}</button>
    <button className="dmex-mobile-icon" aria-label="Next track" disabled={!track} onClick={onNext}><SkipForward size={20} fill="currentColor" /></button>
    <button className="dmex-mobile-icon" aria-label="Open play queue" onClick={onQueue}><ListMusic size={23} /></button>
  </div>;
}
