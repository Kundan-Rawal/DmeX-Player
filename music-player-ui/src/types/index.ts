// src/types.ts

export interface Track {
  path: string;
  name: string;
  artist: string;
  album: string;
  year?: string;
  quality?: string;
  duration: number;
  thumb?: string;
  lyrics?: any;
  metadataLoaded?: boolean;
  genre?: string;
  // MISSING PROPERTIES RESTORED BELOW:
  profile?: string; 
  playCount?: number; 
  totalSecondsListened?: number;
  isFavorite?: boolean;
}

export type NavView = 'ALL' | 'FAVORITES' | 'ALBUMS' | 'TOPTRACKS' | 'PLAYLIST_GALLERY' | string;

export type Taste = 'ORIGINAL' | 'DEFAULT' | 'QUALITY' | 'IMMERSIVE' | 'BASS' | 'ELECTRONIC' | 'HIPHOP' | 'AMBIENT' | 'POP' | 'CLASSICAL'| 'CHILL';


export interface DSPSettings {
  drive: number;
  widen: number;
  spatial: number;
  reverb: number;
  compress: boolean;
  remaster: boolean;
}

export interface CustomPlaylist {
  id: string;
  name: string;
  trackPaths: string[]; // Fixed: Changed from 'tracks' to 'trackPaths' to match your app logic
}

// Environment Constants
export const IS_ANDROID = /Android/i.test(navigator.userAgent);
export const IS_MOBILE  = /Android|iPhone|iPad/i.test(navigator.userAgent);

export interface LyricLine {
  time: number;
  text: string;
}