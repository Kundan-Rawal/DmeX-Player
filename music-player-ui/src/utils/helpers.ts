import { IPicture } from 'music-metadata';
import { IS_ANDROID } from '../types';

// ─── Shared HSL conversion ────────────────────────────────────────────────────
const hue2rgb = (p: number, q: number, t: number) => {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
};

const hslToHex = (h: number, s: number, l: number): string => {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rN = r/255, gN = g/255, bN = b/255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
      case gN: h = (bN - rN) / d + 2; break;
      case bN: h = (rN - gN) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
};

const hexToRgb = (hex: string): [number, number, number] => {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────

export const isHexDark = (hex: string): boolean => {
  const [r, g, b] = hexToRgb(hex);
  return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 145;
};

export const trackAccentColor = (name: string): string => {
  let h = 0;
  for (const c of name) h = (h << 5) - h + c.charCodeAt(0);
  return ['#c8222a','#1565c0','#2e7d32','#e65100','#6a1b9a','#00838f','#c62828','#4527a0'][Math.abs(h) % 8];
};

// ─── getPalette — faithful weighted median-cut extraction ─────────────────────
//
// Strategy:
//   1. Sample at 80×80 (6400 pixels) — 4× more data than the old 40×40
//   2. Quantize each pixel to a 16-step hue bucket × 4-step lightness band
//      → 64 slots total.  Track both PIXEL COUNT and the ACTUAL raw RGB
//      of the most-saturated pixel seen in that slot (representative color).
//   3. Reject only true black/white/transparent and near-greyscale pixels
//      (s < 0.08).  Old code rejected s < 0.12 AND l > 0.95, which was
//      throwing away pale-gold and near-white pinks common in pop covers.
//   4. Sort by pixel count (population), not saturation.
//      The most-populated slots ARE the dominant visual colors.
//   5. De-duplicate: skip any candidate whose hue is within 15° of an
//      already-accepted color, to ensure variety in the final palette.
//   6. Return up to 5 raw hex colors — NO vibrancy manipulation.
//      The caller decides what to do with them.

export const getPalette = (imgUrl: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imgUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(['#c8222a', '#8a1520', '#6a1018']); return; }

      canvas.width = 64;
      canvas.height = 64;
      ctx.drawImage(img, 0, 0, 64, 64);

      try {
        const data = ctx.getImageData(0, 0, 64, 64).data;
        // 8 Hue Directional Lanes
        const buckets = Array.from({ length: 8 }, () => ({ hex: "#000000", saturation: -1, population: 0 }));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a < 200) continue;

          const rN = r/255, gN = g/255, bN = b/255;
          const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
          let h = 0, s = 0, l = (max + min) / 2;

          if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
              case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
              case gN: h = (bN - rN) / d + 2; break;
              case bN: h = (rN - gN) / d + 4; break;
            }
            h /= 6;
          }

          // NOISE FILTER: Reject absolute black, blinding white, and flat greys
          if (l < 0.05 || l > 0.95 || s < 0.08) continue;

          const bucketIdx = Math.floor((h * 360) / 45) % 8;
          buckets[bucketIdx].population++;

          // SALIENCY OVERRIDE: The most saturated pixel in this lane dictates the final hex
          if (s > buckets[bucketIdx].saturation) {
            buckets[bucketIdx].saturation = s;
            const toHex = (x: number) => Math.round(x).toString(16).padStart(2, '0');
            buckets[bucketIdx].hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          }
        }

        const validBuckets = buckets.filter(b => b.saturation > -1);
        validBuckets.sort((a, b) => b.population - a.population);

        const palette: string[] = [];
        
        if (validBuckets.length > 0) {
          palette.push(validBuckets[0].hex);

          const domIdx = buckets.findIndex(b => b.hex === validBuckets[0].hex);
          let accent = "", maxDist = -1;

          for (let i = 1; i < validBuckets.length; i++) {
            const curIdx = buckets.findIndex(b => b.hex === validBuckets[i].hex);
            const dist = Math.min(Math.abs(curIdx - domIdx), 8 - Math.abs(curIdx - domIdx));
            if (dist > maxDist && validBuckets[i].saturation > 0.25) {
              maxDist = dist;
              accent = validBuckets[i].hex;
            }
          }

          if (accent) palette.push(accent);
          validBuckets.forEach(b => {
            if (!palette.includes(b.hex) && palette.length < 5) palette.push(b.hex);
          });
        }

        while (palette.length < 3) palette.push(palette[0] || '#c8222a');
        resolve(palette);
      } catch {
        resolve(['#c8222a', '#8a1520', '#6a1018']);
      }
    };
    img.onerror = () => resolve(['#c8222a', '#8a1520', '#6a1018']);
  });
};
// ─── getMime / stripExt ───────────────────────────────────────────────────────

export const getMime = (p: string) =>
  p.endsWith('.wav')  ? 'audio/wav'  :
  p.endsWith('.flac') ? 'audio/flac' :
  p.endsWith('.ogg')  ? 'audio/ogg'  :
  (p.endsWith('.aac') || p.endsWith('.m4a')) ? 'audio/aac' : 'audio/mpeg';

export const stripExt = (n: string) => n.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i, '');

// ─── generateThumbnail ────────────────────────────────────────────────────────

export async function generateThumbnail(picture: IPicture): Promise<string | null> {
  if (!picture || !picture.data) return null;
  try {
    if (!IS_ANDROID) {
      // Desktop: lossless binary extraction — fast, no quality loss
      let binary = '';
      const bytes = new Uint8Array(picture.data);
      const len   = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      return `data:${picture.format};base64,${btoa(binary)}`;
    }

    // Android: canvas crush to 300×300 JPEG to avoid OOM
    const blob   = new Blob([new Uint8Array(picture.data)], { type: picture.format });
    const imgUrl = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(imgUrl);
        const MAX = 300;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
        else        { if (h > MAX) { w *= MAX / h; h = MAX; } }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(imgUrl); resolve(null); };
      img.src = imgUrl;
    });
  } catch (e) {
    console.error('generateThumbnail failed:', e);
    return null;
  }
}

// ─── enforceLightModeContrast ─────────────────────────────────────────────────
//
// Light mode only — we need text to be readable over the background.
// Rule: only touch LIGHTNESS (cap at 42%). Hue and saturation are
// PRESERVED exactly as the album art gave them.
// Old code was forcing s ≥ 0.75 which is what turned everything neon.

export const enforceLightModeContrast = (hexColor: string): string => {
  const [r, g, b]  = hexToRgb(hexColor);
  const [h, s, l]  = rgbToHsl(r, g, b);

  // Only crush lightness if too pale to read against white
  const newL = Math.min(l, 0.42);

  return hslToHex(h, s, newL);
};

// ─── nudgeVibrancy ────────────────────────────────────────────────────────────
//
// Gentle nudge only — NEVER destroys the album's actual hue or character.
//   • s ≥ 0.30  → return exactly as-is. The color is the color.
//   • s < 0.30  → bump s up to 0.45 max. Never force-saturate beyond that.
//   • isMonochrome flag is IGNORED for blob colors (caller should pass false).
//     It only remains for the rare case of a truly black-and-white cover
//     where you want a silver/slate aesthetic instead of random hue artifacts.

export const nudgeVibrancy = (hexColor: string, isMonochrome: boolean = false): string => {
  if (!hexColor) return '#c8222a';
  const [r, g, b] = hexToRgb(hexColor);
  const [h, s, l] = rgbToHsl(r, g, b);

  // True monochrome art (caller explicitly confirmed, e.g. a greyscale photo)
  // → keep the slate/silver feel, just put lightness in a visible range.
  if (isMonochrome) {
    const newL = Math.max(0.22, Math.min(l, 0.48));
    return hslToHex(h, Math.min(s, 0.12), newL);
  }

  // Already has enough colour identity → return pixel-perfect
  if (s >= 0.30) return hexColor;

  // Genuinely washed-out → tiny lift, preserve hue and lightness
  return hslToHex(h, Math.min(0.45, s + 0.15), Math.max(0.22, Math.min(l, 0.72)));
};

// ─── Keep forceVibrancy as a compile-safe alias ───────────────────────────────
export const forceVibrancy = nudgeVibrancy;

// ─── checkIsMonochrome ────────────────────────────────────────────────────────
//
// Uses HSL saturation, not RGB channel delta — far more accurate.
// A warm golden-sky image has s ≈ 0.40 in HSL; the old RGB-delta method
// would return (max-min) ≈ 30 on such pixels and falsely call it "monochrome".
// Now: only images whose DOMINANT color has s < 0.12 are truly monochrome
// (think B&W photos, silver album covers).

export const checkIsMonochrome = (hexColor: string): boolean => {
  if (!hexColor) return true;
  const [r, g, b] = hexToRgb(hexColor);
  const [, s]     = rgbToHsl(r, g, b);
  // s < 0.12 = genuinely grey/silver. Anything above is a real colour.
  return s < 0.12;
};

// ─── triggerHapticClick ───────────────────────────────────────────────────────

export const triggerHapticClick = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);
};