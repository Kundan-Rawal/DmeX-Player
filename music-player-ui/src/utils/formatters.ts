import { LyricLine } from '../types/index'

export const formatTime = (seconds: number | undefined): string => {
  if (seconds === undefined || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const parseLRC = (lrc: string): LyricLine[] => {
  if (!lrc) return [];
  const lines = lrc.split('\n');
  const parsed: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const m = parseInt(match[1], 10);
      const s = parseFloat(match[2]);
      parsed.push({ time: m * 60 + s, text: match[3].trim() });
    }
  }
  return parsed;
};