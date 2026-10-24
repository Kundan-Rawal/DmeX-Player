export interface ArtistProfile {
  id: string;
  name: string;
  localImagePath: string | null;
  trackIds: string[];
}

import { cleanMusicText } from './metadataCleaner';

// Preserve existing ASCII cache names; encode Unicode rather than collapsing every artist to underscores.
export const artistCacheKey = (name: string) => Array.from(name).map(char => {
  if (/[a-zA-Z0-9]/.test(char)) return char;
  return char.codePointAt(0)! > 127 ? `u${char.codePointAt(0)!.toString(16)}_` : '_';
}).join('');
export const artistIdentity = (name: string) => name.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

export const cleanArtistString = (raw: string): string => {
  const decoded = (raw || '').replace(/&#(\d+);/g, (_, code) => {
    const value = Number(code);
    return value <= 0x10ffff ? String.fromCodePoint(value) : '';
  }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const cleaned = cleanMusicText(decoded);
  return !cleaned || /^(?:unknown(?: artist)?|<unknown>)$/i.test(cleaned) ? 'Unknown Artist' : cleaned;
};

export const splitArtists = (rawArtistString: string): string[] => {
  const sanitized = cleanArtistString(rawArtistString);
  if (sanitized === 'Unknown Artist') return ['Unknown Artist'];

  // Splits on , & ; + | and words like feat, ft, and, with
  const delimiters = /(?:\s*[,&;\+\|]\s*)|(?:\s+\b(?:feat\.?|ft\.?|and|with|starring|vs\.?)\b\s+)/i;
  let parts = sanitized.split(delimiters).map(a => a.trim()).filter(a => a.length > 0);

  // Additional sanity check to remove empty quotes or dangling chars
  parts = parts.map(p => p.replace(/^["']|["']$/g, '').trim()).filter(p => p.length > 0);

  return parts.length > 0 ? parts : ['Unknown Artist'];
};

export const buildArtistDictionary = (tracks: any[]): ArtistProfile[] => {
  const artistMap = new Map<string, ArtistProfile>();

  tracks.forEach(track => {
    const individualArtists = splitArtists(track.artist || 'Unknown Artist'); 
    
    individualArtists.forEach(artistName => {
      let artistId = artistIdentity(artistName);
      
      if (!artistId || artistId === 'unknown' || artistId === 'unknownartist') {
        artistId = 'unknown-artist';
        artistName = 'Unknown Artist';
      }

      if (!artistMap.has(artistId)) {
        artistMap.set(artistId, {
          id: artistId,
          name: artistName, 
          localImagePath: null, 
          trackIds: [track.path] 
        });
      } else {
        const profile = artistMap.get(artistId)!;
        if (!profile.trackIds.includes(track.path)) {
          profile.trackIds.push(track.path);
        }
      }
    });
  });

  return Array.from(artistMap.values());
};
