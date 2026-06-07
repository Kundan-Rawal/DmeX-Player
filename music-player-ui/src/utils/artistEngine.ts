export interface ArtistProfile {
  id: string;
  name: string;
  localImagePath: string | null;
  trackIds: string[];
}

// 1. OMNIDIRECTIONAL SPAM KEYWORDS
// 1. OMNIDIRECTIONAL SPAM KEYWORDS
const SPAM_KEYWORDS = /(pagalworld|pendujatt|mr-jatt|djmaza|songs\.pk|wapking|djpunjab|raag|mp3mad|download|kbps|audio|lyric|click|link|official)/gi;

export const cleanArtistString = (raw: string): string => {
  if (!raw) return 'Unknown Artist';

  // Step 1: Forcefully intercept any literal variations of "unknown" right away
  if (/unknown/i.test(raw) || raw.trim() === '') {
    return 'Unknown Artist';
  }

  // Step 2: Remove brackets/parentheses containing web domains or explicit spam keywords
  let cleaned = raw.replace(/\[.*?\]|\(.*?\)/g, (match) => {
    if (/\.[a-z]{2,6}/i.test(match) || SPAM_KEYWORDS.test(match)) return '';
    return match; 
  });

  // Step 3: THE PRE-VALIDATION SLICE (Wipes out web domains like .info or .click)
  cleaned = cleaned.replace(/\s*[-\|\s·•~]*\s*[a-z0-9\-]*\.[a-z]{2,6}\b/gi, '');

  // Step 4: Nuke any lingering spam keywords globally
  cleaned = cleaned.replace(SPAM_KEYWORDS, '');

  // ==========================================
  // Step 5: THE HYPHEN HEURISTIC (TITLE BLEED)
  // ==========================================
  
  // Pattern A: Space-Hyphen-Space (e.g., "Alan Walker - On My Way")
  // Safely splits and takes only the left side (the Artist)
  if (cleaned.includes(' - ')) {
      cleaned = cleaned.split(' - ')[0]; 
  }
  // Pattern B: All-Hyphens (e.g., "Alan-walker-On-My-Way")
  // WARNING: Hardcoded to exactly 2 words. Will break "Eminem" or "Swedish House Mafia"
  else if (cleaned.includes('-') && !cleaned.includes(' ')) {
      const words = cleaned.split('-');
      if (words.length >= 3) {
          cleaned = words.slice(0, 2).join(' '); 
      } else {
          cleaned = cleaned.replace(/-/g, ' '); 
      }
  }

  // Step 6: Final Polish - Trim and collapse multiple spaces
  return cleaned.trim().replace(/\s+/g, ' ');
};



export const splitArtists = (rawArtistString: string): string[] => {
  const sanitized = cleanArtistString(rawArtistString);
  if (sanitized === 'Unknown Artist') return ['Unknown Artist'];

  // THE YOUTUBE PIPE FIX: Added "\|" to the core symbol slicer character class.
  // This now breaks strings down on commas, ampersands, semicolons, plus signs, AND pipes with or without spaces.
  const delimiters = /(?:\s*[,&;\+\|]\s*)|(?:\s+\b(?:feat\.?|ft\.?|and|with)\b\s+)/i;
  const parts = sanitized.split(delimiters).map(a => a.trim()).filter(a => a.length > 0);

  return parts.length > 0 ? parts : ['Unknown Artist'];
};

export const buildArtistDictionary = (tracks: any[]): ArtistProfile[] => {
  const artistMap = new Map<string, ArtistProfile>();

  tracks.forEach(track => {
    const individualArtists = splitArtists(track.artist); 
    
    individualArtists.forEach(artistName => {
      // Generate the normalization ID to collapse spelling duplicates together
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