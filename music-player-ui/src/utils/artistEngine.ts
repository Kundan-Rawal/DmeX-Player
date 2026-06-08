export interface ArtistProfile {
  id: string;
  name: string;
  localImagePath: string | null;
  trackIds: string[];
}

const SPAM_KEYWORDS = /(pagalworld|pendujatt|mr-jatt|djmaza|songs\.pk|wapking|djpunjab|raag|mp3mad|download|kbps|audio|lyric|click|link|official|exclusive|music|video)/gi;

function decodeHtmlEntities(str: string): string {
  return str.replace(/&#([0-9]{1,3});/gi, (match, numStr) => {
    return String.fromCharCode(parseInt(numStr, 10));
  }).replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}

export const cleanArtistString = (raw: string): string => {
  if (!raw) return 'Unknown Artist';

  let cleaned = decodeHtmlEntities(raw);

  if (/^unknown/i.test(cleaned) || cleaned.trim() === '') {
    return 'Unknown Artist';
  }

  // Remove brackets/parentheses containing web domains or explicit spam keywords
  cleaned = cleaned.replace(/\[.*?\]|\(.*?\)/g, (match) => {
    if (/\.[a-z]{2,6}/i.test(match) || SPAM_KEYWORDS.test(match)) return '';
    return match; 
  });

  // Wipes out web domains like .info or .click
  cleaned = cleaned.replace(/\s*[-\|\sA-Z]*\s*[a-z0-9\-]*\.[a-z]{2,6}\b/gi, '');

  // Nuke lingering spam keywords globally
  cleaned = cleaned.replace(SPAM_KEYWORDS, '');

  // THE HYPHEN HEURISTIC (TITLE BLEED)
  if (cleaned.includes(' - ')) {
      cleaned = cleaned.split(' - ')[0]; 
  } else if (cleaned.includes('-') && !cleaned.includes(' ')) {
      const words = cleaned.split('-');
      if (words.length >= 3) {
          cleaned = words.slice(0, 2).join(' '); 
      }
  }

  return cleaned.trim().replace(/\s+/g, ' ');
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
    const individualArtists = splitArtists(track.artist || track.albumArtist || 'Unknown Artist'); 
    
    individualArtists.forEach(artistName => {
      let artistId = artistName.toLowerCase().replace(/[^a-z0-9]/g, '');
      
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