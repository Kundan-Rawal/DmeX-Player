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
  const regex = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  
  for (const line of lines) {
    const matches = [...line.matchAll(regex)];
    const text = line.replace(regex, '').trim();
    for (const match of matches) {
      const m = parseInt(match[1], 10);
      const s = parseFloat(match[2]);
      if (s < 60) parsed.push({ time: Math.max(0, m * 60 + s + offset), text });
    }
  }
  return parsed.sort((a, b) => a.time - b.time);
};
