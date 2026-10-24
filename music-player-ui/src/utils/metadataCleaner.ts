import { Track } from '../types';

export const cleanMusicText = (value: string) => value
  .replace(/[\[(][^\])]*(?:pagalworld|pagalnew|mp3mad|djpunjab|mr-jatt|\.(?:com|mobi|net|in))[^\])]*[\])]/gi, ' ')
  .replace(/\b(?:pagalworld|pagalnew|mp3mad|djpunjab|mr-jatt)(?:\.(?:com|mobi|net|in))?\b/gi, ' ')
  .replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|aiff?)$/i, '')
  .replace(/\s+/g, ' ').trim();

export function sanitizeForLyricsAPI(track: Track) {
  let queryArtist = /^(?:unknown(?: artist)?|<unknown>|-)$/i.test(track.artist?.trim() || '') ? '' : cleanMusicText(track.artist || '');
  let queryTitle = cleanMusicText(track.name || track.path.split(/[/\\]/).pop() || '');
  if (!queryArtist && queryTitle.includes(' - ')) {
    const split = queryTitle.indexOf(' - ');
    queryArtist = queryTitle.slice(0, split).trim();
    queryTitle = queryTitle.slice(split + 3).trim();
  }
  return { queryTitle, queryArtist };
}
export const normalizeMusicIdentity = (text: string) => cleanMusicText(text).normalize('NFKC').toLocaleLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

export interface LyricsCandidate { trackName: string; artistName: string; duration: number; syncedLyrics?: string; plainLyrics?: string }
export function chooseLyricsMatch(results: LyricsCandidate[], title: string, artist: string, duration: number): LyricsCandidate | undefined {
  const t = normalizeMusicIdentity(title), a = normalizeMusicIdentity(artist);
  return results.filter(result => {
    if (normalizeMusicIdentity(result.trackName || '') !== t) return false;
    const candidateArtist = normalizeMusicIdentity(result.artistName || '');
    if (a && candidateArtist !== a && !candidateArtist.startsWith(a + ' ')) return false;
    return !!result.syncedLyrics && (!(duration > 0) || Math.abs(result.duration - duration) <= Math.max(5, duration * 0.02));
  }).sort((x, y) => Math.abs(x.duration - duration) - Math.abs(y.duration - duration))[0];
}
