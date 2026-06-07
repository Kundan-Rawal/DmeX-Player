import { Track } from '../types';


export function sanitizeForLyricsAPI(track: Track) {
    // 1. TRUST THE LIBRARY FIRST: Grab what the artistEngine already figured out
    let queryArtist = (track.artist && track.artist !== "Unknown") ? track.artist : "";
    
    // 2. FILENAME FALLBACK EXTRACTOR: Since you only have 'path', we slice the filename out of it
    // This handles both Windows (\) and Unix (/) path separators safely
    const fallbackName = track.path ? track.path.split(/[/\\]/).pop() || "" : "";

    // 3. USE TRACK.NAME (Your interface does not have track.title)
    let queryTitle = (track.name && track.name !== "Unknown") ? track.name : fallbackName;

    // 4. NUKE THE TITLE TRASH: Always clean piracy tags and brackets from the title
    queryTitle = queryTitle.replace(/\s*[\[\(\{].*?[\]\)\}]\s*/g, ' ')
                           .replace(/pagalworld(\.com|\.io|\.pw)?|djmaza|webmusic/gi, '')
                           .replace(/\.mp3|\.flac|\.wav|\.m4a/gi, '')
                           .trim();

    // 5. THE FALLBACK HEURISTIC: Only parse hyphens if the database failed to find an artist
    if (!queryArtist) {
        if (queryTitle.includes(' - ')) {
            const parts = queryTitle.split(' - ');
            queryArtist = parts[0].trim();
            queryTitle = parts[1].trim();
        } 
        else if (queryTitle.includes('-') && !queryTitle.includes(' ')) {
            const words = queryTitle.split('-');
            // Your strict 2-word artist heuristic
            if (words.length >= 3) {
                queryArtist = words.slice(0, 2).join(' ').trim();
                queryTitle = words.slice(2).join(' ').trim();
            } else {
                queryTitle = queryTitle.replace(/-/g, ' ').trim();
            }
        }
    } else {
        // If the library DID find the artist, just replace remaining hyphens in the title with spaces
        queryTitle = queryTitle.replace(/-/g, ' ').trim();
    }

    // 6. FINAL POLISH: Collapse extra spaces
    queryTitle = queryTitle.replace(/\s+/g, ' ').trim();
    queryArtist = queryArtist.replace(/\s+/g, ' ').trim();

    return { queryArtist, queryTitle };
}