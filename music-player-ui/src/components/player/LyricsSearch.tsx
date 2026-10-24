import { useEffect, useRef, useState } from 'react';
import { Search, LoaderCircle } from 'lucide-react';
import { Track } from '../../types';
import { fetchLyricsOnline } from '../../services/lyricsFetcher';
import { extractTrackMetadata } from '../../services/metadata';
import { sanitizeForLyricsAPI } from '../../utils/metadataCleaner';
import './LyricsSearch.css';

export function LyricsSearch({ track, onLyrics }: { track: Track; onLyrics: (track: Track, lyrics: string) => Promise<void> }) {
  const identity = sanitizeForLyricsAPI(track);
  const [title, setTitle] = useState(identity.queryTitle);
  const [artist, setArtist] = useState(identity.queryArtist);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return <form className="lyrics-search" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setStatus('Reading song details...');
    try {
      const metadata = failed ? {} : await extractTrackMetadata(track).catch(() => ({}));
      if (controller.signal.aborted) return;
      const searchTrack = failed ? { ...track, name: title.trim(), artist: artist.trim() } : { ...track, ...metadata };
      const lyrics = await fetchLyricsOnline(searchTrack, setStatus, controller.signal);
      if (controller.signal.aborted) return;
      if (lyrics) await onLyrics(track, lyrics);
      else {
        if (!failed) { const clean = sanitizeForLyricsAPI(searchTrack); setTitle(clean.queryTitle); setArtist(clean.queryArtist); }
        setFailed(true);
      }
    } catch { if (!controller.signal.aborted) { setStatus('Could not save lyrics. Please retry.'); setFailed(true); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }}>
    <p>No synced lyrics available.</p>
    {failed && <>
      <label>Song name<input required value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" /></label>
      <label>Singer name<input value={artist} onChange={e => setArtist(e.target.value)} autoComplete="off" /></label>
    </>}
    <button type="submit" className="mep-fetch-btn" disabled={busy || (failed && !title.trim())}>
      {busy ? <LoaderCircle size={16} /> : <Search size={16} />}{busy ? 'Searching...' : failed ? 'Search Again' : 'Fetch Lyrics Online'}
    </button>
    <span role="status">{status}</span>
  </form>;
}
