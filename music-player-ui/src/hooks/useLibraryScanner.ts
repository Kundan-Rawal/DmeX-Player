import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Track, CustomPlaylist } from '../types/index';
import { initVault, vaultGet } from '../services/vault';

export const useLibraryScanner = (
  setIsLoading: (v: boolean) => void,
  setScanProgress: (v: string) => void,
  setPlaylist: React.Dispatch<React.SetStateAction<Track[]>>,
  setFavorites: (v: string[]) => void,
  setCustomPlaylists: (v: CustomPlaylist[]) => void,
  setIsDarkMode: (v: boolean) => void,
  playlistRef: React.MutableRefObject<Track[]>
) => {

  // 1. THE BOOT SEQUENCE
  useEffect(() => {
    async function boot() {
      setIsLoading(true);
      setScanProgress('Waking up database...');
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        const saved = await invoke<Track[]>('fetch_library');
        if (saved && saved.length > 0) {
          // SELF-HEALING: Force the background enricher to rebuild RAM-only Blob URLs
          const cleanSaved = saved.map(t => ({
            ...t,
            thumb: undefined,
            metadataLoaded: false 
          }));
          
          playlistRef.current = cleanSaved;
          setPlaylist(cleanSaved);
          setFavorites(cleanSaved.filter(t => t.isFavorite).map(t => t.path));
        }
      } catch (err) { console.error("CRITICAL: SQLite fetch_library failed", err); }

      try {
        const savedPlaylists = await invoke<CustomPlaylist[]>('get_playlists');
        if (savedPlaylists) setCustomPlaylists(savedPlaylists);
      } catch (err) { console.error("CRITICAL: SQLite get_playlists failed", err); }

      try {
        await initVault();
        const savedDark = await vaultGet<boolean>("isDarkMode");
        if (savedDark !== undefined && savedDark !== null) setIsDarkMode(savedDark);
      } catch (err) { console.error("Non-critical: Vault load failed", err); }

      setIsLoading(false);
      setScanProgress('');
    }
    boot();
  }, []); // Run exactly once on mount

  // 2. THE BACKGROUND SCAN CHUNK LISTENER
  // 2. THE BACKGROUND SCAN CHUNK LISTENER
  useEffect(() => {
    const pending = { chunks: [] as any[] };

    const unlistenChunk = listen('metadata_chunk', (event) => {
      pending.chunks.push(...(event.payload as any[]));
      setScanProgress('Loading chunks from background scanner...');
    });

    const flushInterval = setInterval(() => {
      if (pending.chunks.length === 0) return;
      const batch = pending.chunks.splice(0);
      setPlaylist(prev => {
        const existingPaths = new Set(prev.map(t=>t.path));
        const fresh: Track[] = batch
          .map((c:any):Track => ({ name:c.title||'Unknown Title', path:c.file_path, artist:c.artist||'Unknown Artist', album:'Unknown Album', year:'-', quality:'-', duration:0, metadataLoaded:false, thumb:c.art_uri?convertFileSrc(c.art_uri):undefined }))
          .filter(t => !existingPaths.has(t.path));
          
        // THE FIX: Lock raw tracks into SQLite immediately so they aren't lost if the app closes
        for (const t of fresh) {
          invoke('add_to_library', { track: { ...t, thumb: undefined } }).catch(()=>{});
        }

        const merged = [...prev, ...fresh].sort((a,b) => {
          const A = String(a?.name||'Unknown').toUpperCase(), B = String(b?.name||'Unknown').toUpperCase();
          return A<B?-1:A>B?1:0;
        });
        playlistRef.current = merged;
        return merged;
      });
    }, 200);

    const unlistenComplete = listen('scan_complete', () => {
      if (pending.chunks.length > 0) {
        const batch = pending.chunks.splice(0);
        setPlaylist(prev => {
          const existingPaths = new Set(prev.map(t=>t.path));
          const fresh: Track[] = batch
            .map((c:any):Track => ({ name:c.title||'Unknown Title', path:c.file_path, artist:c.artist||'Unknown Artist', album:'Unknown Album', year:'-', quality:'-', duration:0, metadataLoaded:false, thumb:c.art_uri?convertFileSrc(c.art_uri):undefined }))
            .filter(t => !existingPaths.has(t.path));
            
          // THE FIX: Lock raw tracks into SQLite immediately
          for (const t of fresh) {
            invoke('add_to_library', { track: { ...t, thumb: undefined } }).catch(()=>{});
          }

          const merged = [...prev, ...fresh].sort((a,b)=>{ const A=String(a?.name||'Unknown').toUpperCase(),B=String(b?.name||'Unknown').toUpperCase(); return A<B?-1:A>B?1:0; });
          playlistRef.current = merged;
          return merged;
        });
      }
      clearInterval(flushInterval);
      setIsLoading(false);
      setScanProgress('');
    });

    return () => {
      clearInterval(flushInterval);
      unlistenChunk.then(f=>f());
      unlistenComplete.then(f=>f());
    };
  }, []);
};