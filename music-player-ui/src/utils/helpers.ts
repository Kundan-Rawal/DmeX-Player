import { IPicture } from 'music-metadata';
import { IS_ANDROID } from '../types';


export const isHexDark = (hex:string) => {
  const h=hex.replace('#','');
  const r=parseInt(h.substring(0,2),16),g=parseInt(h.substring(2,4),16),b=parseInt(h.substring(4,6),16);
  return ((r*299)+(g*587)+(b*114))/1000 < 145;
};

export const trackAccentColor = (name:string): string => {
  let h=0; for (const c of name) h=(h<<5)-h+c.charCodeAt(0);
  return ['#c8222a','#1565c0','#2e7d32','#e65100','#6a1b9a','#00838f','#c62828','#4527a0'][Math.abs(h)%8];
};

export const getPalette = (imgUrl:string): Promise<string[]> =>
  new Promise(resolve => {
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement("canvas"); c.width=img.width; c.height=img.height;
      const ctx=c.getContext("2d"); if(!ctx) return resolve(['#c8222a','#8a1520','#6a1018']);
      ctx.drawImage(img,0,0);
      const hex=(x:number,y:number)=>{const d=ctx.getImageData(x,y,1,1).data;return "#"+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');};
      resolve([hex(Math.floor(img.width*0.2),Math.floor(img.height*0.2)),hex(Math.floor(img.width*0.5),Math.floor(img.height*0.5)),hex(Math.floor(img.width*0.8),Math.floor(img.height*0.8))]);
    };
    img.onerror=()=>resolve(['#c8222a','#8a1520','#6a1018']);
    img.src=imgUrl;
  });

export const getMime = (p:string) => p.endsWith('.wav')?'audio/wav':p.endsWith('.flac')?'audio/flac':p.endsWith('.ogg')?'audio/ogg':(p.endsWith('.aac')||p.endsWith('.m4a'))?'audio/aac':'audio/mpeg';

export const stripExt = (n:string) => n.replace(/\.(mp3|wav|flac|ogg|aac|m4a)$/i,'');

export async function generateThumbnail(picture: IPicture): Promise<string | null> {
  if (!picture || !picture.data) return null;

  try {
    // ---------------------------------------------------------
    // 1. DESKTOP / LAPTOP: Lossless Binary Extraction
    // ---------------------------------------------------------
    if (!IS_ANDROID) {
      let binary = '';
      const bytes = new Uint8Array(picture.data);
      const len = bytes.byteLength;
      
      // Loop prevents max call stack size exceeded on massive 1080p arrays
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      return `data:${picture.format};base64,${base64}`;
    }

    // ---------------------------------------------------------
    // 2. ANDROID: Canvas Crushing (Anti-OOM)
    // ---------------------------------------------------------
    const safeData = new Uint8Array(picture.data);
    const blob = new Blob([safeData], { type: picture.format });
    const imgUrl = URL.createObjectURL(blob);
    
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(imgUrl);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Crush the image down to a maximum of 300x300
        const MAX_SIZE = 300;
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Output as a 70% quality JPEG string to save database space
        resolve(canvas.toDataURL('image/jpeg', 0.7)); 
      };
      img.onerror = () => {
        URL.revokeObjectURL(imgUrl);
        resolve(null);
      };
      img.src = imgUrl;
    });

  } catch (error) {
    console.error("Failed to extract image:", error);
    return null;
  }
}