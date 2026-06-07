import { Track } from '../types'; // Adjust path if needed
import { invoke } from '@tauri-apps/api/core';

const geminiMetadataCleaner = async (track: Track) => {
  let API_KEY = "AIzaSyBHgD7iM5hqWEGw1bUv3u35bUjgL2TF6pY"; 
  try {
    const customKey = await invoke<string | null>('get_setting', { key: 'gemini_api_key' });
    if (customKey) API_KEY = customKey;
  } catch (e) {}
  const formattedDuration = `${Math.floor(track.duration / 60)}:${Math.floor(track.duration % 60).toString().padStart(2, '0')}`;

  const prompt = `
    You are an expert music metadata researcher.
    Input: "${track.name}" by "${track.artist}"
    Context: Duration ${formattedDuration}, Year ${track.year}
    
    RULES:
    1. YOU MUST USE THE GOOGLE SEARCH TOOL to find the exact real-world song matching this input. Do not guess.
    2. "Shometyle", "Celebnob", "NewDjSongRemix", "Remix", "Pagalworld", website domains (.com, .in), and uploader tags are FAKE. Ignore them.
    3. Identify the TRUE, OFFICIAL track title and the TRUE primary artist(s).
    4. STRIP OUT ALBUM AND MOVIE NAMES from the title. If the input is "Movie - Song" or "Album - Track" (e.g. "Dil Bechara- Taare Ginn"), the clean title is ONLY "Taare Ginn".
    5. First, briefly explain your search results and reasoning.
    6. Then, output EXACTLY this JSON format in a markdown block:
    \`\`\`json
    {"title": "Clean Title", "artists": ["Actual Artist 1"]}
    \`\`\`
  `;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.2 } 
      })
    });

    if (res.status === 429) {
      console.error("AI RATE LIMITED (429)");
      return null; 
    }

    const data = await res.json();
    if (!res.ok || !data.candidates) return null;

    const text = data.candidates[0].content.parts[0].text;
    const match = text.match(/```json([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim());
    } else {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        return JSON.parse(text.slice(start, end + 1));
      }
    }
    return null;
  } catch (e) {
    return null;
  }
};

export const fetchLyricsOnline = async (track: Track, onProgress: (msg: string) => void): Promise<string | null> => {
  if (!track.name || track.name === 'Unknown Title') return null;

  const clean = (str: string, isArtist = false) => {
    let val = str.replace(/\[.*?\]|\(.*?\)/g, '')
      .replace(/-?\s*(PagalNew|Pagalworld|Mp3Mad|Mp3 Song|Remix|DjPunjab|Mr-Jatt)\.?(com|co|in|org|mobi)?/gi, '')
      .replace(/\.co(m)?\s*$/gi, '')
      .replace(/\s\s+/g, ' ').trim();
    if (isArtist) val = val.split(/,|;|&|feat\.|ft\./i)[0];
    return val.trim();
  };

  const t = clean(track.name);
  const artistsToTry = track.artist === 'Unknown Artist' 
    ? [''] 
    : track.artist.split(/,|;|&|feat\.|ft\./i).map(x => clean(x, true)).filter(Boolean);

  let desperateFallbackLrc: string | null = null;

  try {
    // 1. THE LOCAL BRUTE-FORCE LOOP (Tier 1 & Tier 2)
    for (let i = 0; i < artistsToTry.length; i++) {
      const a = artistsToTry[i];
      console.log(`%c[Lyrics] Testing Artist ${i+1}/${artistsToTry.length}: "${a}"`, "color: #2196f3;");
      onProgress(`Testing artist ${i+1}/${artistsToTry.length}: ${a || 'Unknown'}...`);

      const res1 = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`);
      if (res1.ok) {
        const data = await res1.json();
        if (data.syncedLyrics) {
          if (Math.abs(data.duration - track.duration) < 5) {
            console.log("%c[Lyrics] SUCCESS: Perfect Tier 1 match found.", "color: #00e676;");
            return data.syncedLyrics;
          } else if (!desperateFallbackLrc) {
            desperateFallbackLrc = data.syncedLyrics;
          }
        }
      }

      const res2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${t} ${a}`)}`);
      if (res2.ok) {
        const results = await res2.json();
        const bestMatch = results.find((r: any) => r.syncedLyrics && Math.abs(r.duration - track.duration) < 5);
        
        if (bestMatch) {
          console.log("%c[Lyrics] SUCCESS: Perfect Tier 2 match found.", "color: #00e676;");
          return bestMatch.syncedLyrics;
        } else if (!desperateFallbackLrc && results.length > 0 && results[0].syncedLyrics) {
           desperateFallbackLrc = results[0].syncedLyrics;
        }
      }
    }

    // 2. TIER 3: THE AI ARRAY GENERATOR
    console.log("%c[Lyrics] T3: Local loop failed. Waking AI...", "color: #f44336; font-weight: bold;");
    onProgress('Standard search failed. Engaging AI...');
    
    const aiData = await geminiMetadataCleaner(track);
    
    if (aiData && aiData.artists && Array.isArray(aiData.artists)) {
      for (const aiArtist of aiData.artists) {
         onProgress(`AI Testing: ${aiArtist}...`);
         const res3 = await fetch(`https://lrclib.net/api/get?track_name=${encodeURIComponent(aiData.title)}&artist_name=${encodeURIComponent(aiArtist)}`);
         if (res3.ok) {
           const data = await res3.json();
           if (data.syncedLyrics) {
              if (Math.abs(data.duration - track.duration) < 5) {
                console.log("%c[Lyrics] SUCCESS: Perfect AI match found.", "color: #00e676;");
                return data.syncedLyrics;
              } else if (!desperateFallbackLrc) {
                desperateFallbackLrc = data.syncedLyrics;
              }
           }
         }
      }
    }

    // 3. TIER 4: THE DESPERATION FALLBACK
    if (desperateFallbackLrc) {
      console.log("%c[Lyrics] T4: Duration constraint failed. Falling back to closest text match.", "color: #ff9800; font-weight: bold;");
      onProgress('Duration mismatch. Using closest lyrics found...');
      return desperateFallbackLrc;
    }

    onProgress('No lyrics found. All attempts exhausted.');
    setTimeout(() => onProgress(''), 3000);
    return null;
  } catch (e) {
    onProgress('Network error.');
    setTimeout(() => onProgress(''), 3000);
    return null;
  }
};