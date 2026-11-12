import { CustomPlaylist, Track } from '../types';
import { artistIdentity, splitArtists } from '../utils/artistEngine';

export type MobileTab = 'favourites' | 'playlists' | 'tracks' | 'albums' | 'artists' | 'folders' | 'discover';
export type SmartCollection = 'recentlyAdded' | 'recentlyPlayed' | 'mostPlayed';
export type MobileRoute = { kind: 'library'; tab: MobileTab } | { kind: 'collection'; id: SmartCollection } |
  { kind: 'playlist' | 'playlistEdit' | 'album' | 'artist' | 'folder'; id: string } | { kind: 'search'; query?: string } |
  { kind: 'queue' | 'settings' | 'activity' };
export type MobileSort = 'title' | 'artist' | 'added' | 'duration';
export const SMART_TITLES: Record<SmartCollection, string> = { recentlyAdded: 'Recently added', recentlyPlayed: 'Recently played', mostPlayed: 'Most played' };
export const countLabel = (count: number, noun = 'track') => `${count} ${noun}${count === 1 ? '' : 's'}`;
export function isFeaturedAlbum(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash, 31) + id.charCodeAt(index) | 0;
  return (hash >>> 0) % 5 === 0;
}
export const albumId = (track: Track) => JSON.stringify([(track.album || 'Unknown Album').normalize('NFKC').trim().toLocaleLowerCase(), ((track as Track & { albumArtist?: string }).albumArtist || track.artist || 'Unknown Artist').normalize('NFKC').trim().toLocaleLowerCase()]);
export function sortTracks(tracks: Track[], sort: MobileSort): Track[] {
  return [...tracks].sort((a, b) => sort === 'added' ? (b.dateAdded || 0) - (a.dateAdded || 0) || a.name.localeCompare(b.name) : sort === 'duration' ? b.duration - a.duration : sort === 'artist' ? a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
}
export function smartTracks(id: SmartCollection, tracks: Track[], recent: Record<string, number>): Track[] {
  if (id === 'recentlyAdded') return sortTracks(tracks, 'added').slice(0, 100);
  if (id === 'recentlyPlayed') return tracks.filter(t => recent[t.path] || t.lastPlayed).sort((a, b) => (recent[b.path] || b.lastPlayed || 0) - (recent[a.path] || a.lastPlayed || 0)).slice(0, 100);
  return tracks.filter(t => (t.playCount || 0) > 0 || (t.totalSecondsListened || 0) > 0).sort((a, b) => (b.playCount || 0) - (a.playCount || 0) || (b.totalSecondsListened || 0) - (a.totalSecondsListened || 0)).slice(0, 50);
}
export function albumGroups(tracks: Track[]) {
  const groups = new Map<string, { id: string; name: string; artist: string; thumb?: string; tracks: Track[] }>();
  for (const track of tracks) { const id = albumId(track); let group = groups.get(id); if (!group) { group = { id, name: track.album || 'Unknown Album', artist: track.artist || 'Unknown Artist', thumb: track.thumb, tracks: [] }; groups.set(id, group); } group.tracks.push(track); group.thumb ||= track.thumb; }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function routeTracks(route: MobileRoute, tracks: Track[], favourites: Set<string>, playlists: CustomPlaylist[], recent: Record<string, number>): Track[] {
  if (route.kind === 'library' && route.tab === 'favourites') return tracks.filter(t => favourites.has(t.path));
  if (route.kind === 'collection') return smartTracks(route.id, tracks, recent);
  if (route.kind === 'playlist' || route.kind === 'playlistEdit') { const byPath = new Map(tracks.map(t => [t.path, t])); return (playlists.find(p => p.id === route.id)?.trackPaths || []).map(path => byPath.get(path)).filter((t): t is Track => !!t); }
  if (route.kind === 'album') return tracks.filter(t => albumId(t) === route.id).sort((a, b) => (a.discNumber || 0) - (b.discNumber || 0) || (a.trackNumber || 0) - (b.trackNumber || 0) || a.name.localeCompare(b.name));
  if (route.kind === 'artist') return tracks.filter(t => splitArtists(t.artist).some(name => {
    const id = artistIdentity(name);
    return (!id || id === 'unknown' || id === 'unknownartist' ? 'unknown-artist' : id) === route.id;
  }));
  if (route.kind === 'folder') return tracks.filter(t => folderPath(t) === route.id);
  return tracks;
}
export function folderPath(track: Track) { return track.path.startsWith('content://') ? 'Android audio library' : track.path.replace(/[\\/][^\\/]+$/, '') || 'Music'; }
