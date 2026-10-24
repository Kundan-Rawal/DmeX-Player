import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
          playlistRef.current = saved;
          setPlaylist(saved);
          setFavorites(saved.filter(t => t.isFavorite).map(t => t.path));
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

};
