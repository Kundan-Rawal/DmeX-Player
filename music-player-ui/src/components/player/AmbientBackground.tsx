import React, { useEffect, useRef } from 'react';
import { IS_ANDROID } from '../../types'; // Adjust path if needed

interface AmbientBackgroundProps {
  isExpandedRef: React.MutableRefObject<boolean>;
  audioLevelRef: React.MutableRefObject<number>;
  spatialData: React.MutableRefObject<any>;
  visMode: 'ORBIT' | 'RADAR';
  themeColor: string;
  isDarkMode: boolean;
  audioLevel: number;
}

export const AmbientBackground = ({
  isExpandedRef, audioLevelRef, spatialData, visMode, themeColor, isDarkMode, audioLevel
}: AmbientBackgroundProps) => {
  const visModeRef = useRef(visMode);
  useEffect(() => { visModeRef.current = visMode; }, [visMode]);
  
  const themeColorRef = useRef(themeColor);
  useEffect(() => { themeColorRef.current = themeColor; }, [themeColor]);

  const isDarkModeRef = useRef(isDarkMode);
  useEffect(() => { isDarkModeRef.current = isDarkMode; }, [isDarkMode]);

  const bassRef    = useRef<HTMLDivElement>(null);
  const midLRef    = useRef<HTMLDivElement>(null);
  const midRRef    = useRef<HTMLDivElement>(null);
  const trebLRef   = useRef<HTMLDivElement>(null);
  const trebRRef   = useRef<HTMLDivElement>(null);
  const otherLRef  = useRef<HTMLDivElement>(null);
  const otherRRef  = useRef<HTMLDivElement>(null);
  const cornerTLRef = useRef<HTMLDivElement>(null);
  const cornerBRRef = useRef<HTMLDivElement>(null);
  const cornerTRRef = useRef<HTMLDivElement>(null);
  const cornerBLRef = useRef<HTMLDivElement>(null);
  const blob5Ref = useRef<HTMLDivElement>(null);
  const blob6Ref = useRef<HTMLDivElement>(null);
  const blob7Ref = useRef<HTMLDivElement>(null);
  const blob8Ref = useRef<HTMLDivElement>(null);
  const ripple1Ref = useRef<HTMLDivElement>(null);
  const ripple2Ref = useRef<HTMLDivElement>(null);
  const ripple3Ref = useRef<HTMLDivElement>(null);
  const dustCanvasRef   = useRef<HTMLCanvasElement>(null);
  const artifactRefs    = useRef<(HTMLDivElement|null)[]>([]);

  const rippleState = useRef([
    { active:false, scale:0, opacity:0 },
    { active:false, scale:0, opacity:0 },
    { active:false, scale:0, opacity:0 }
  ]);
  const lastRippleTime  = useRef(0);
  const rippleThreshold = useRef(0.55);
  const lastBassLevel   = useRef(0);
  const dustThreshold   = useRef(0.05);
  const lastTrebleLevel = useRef(0);
  const artifactState   = useRef([...Array(6)].map(()=>({ active:false,x:0,y:0,scale:0,opacity:0 })));

  const DUST_COUNT = IS_ANDROID ? 0 : 500;

  const blobState = useRef([
    { px:Math.random()*10, py:Math.random()*10, sx:0.15, sy:0.11 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.12, sy:0.16 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.17, sy:0.13 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.14, sy:0.18 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.11, sy:0.14 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.16, sy:0.12 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.13, sy:0.17 },
    { px:Math.random()*10, py:Math.random()*10, sx:0.18, sy:0.15 },
  ]);
  const dustState = useRef([...Array(DUST_COUNT)].map(()=>({ active:false,x:0,y:0,vx:0,vy:0,scale:0,opacity:0,isLeft:true })));

  useEffect(() => {
    const resize = () => { if (dustCanvasRef.current) { dustCanvasRef.current.width=window.innerWidth; dustCanvasRef.current.height=window.innerHeight; } };
    window.addEventListener('resize', resize); resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const rBx={v:0},rBs={v:0},rMx={v:0},rMw={v:0},rMs={v:0},rTx={v:0},rTw={v:0},rTs={v:0},rOx={v:0},rOw={v:0},rOs={v:0};
    const glowSpriteDark  = document.createElement('canvas'); glowSpriteDark.width=64;  glowSpriteDark.height=64;
    const glowSpriteLight = document.createElement('canvas'); glowSpriteLight.width=64; glowSpriteLight.height=64;
    let lastSpriteColor = '';

    let rafId: number;
    const tick = (timestamp: number) => {
      if (IS_ANDROID && !isExpandedRef.current) { 
        rafId = requestAnimationFrame(tick); 
        return; 
      }

      const now = timestamp * 0.001;
      const wallTime = Date.now();   
      const lvl = audioLevelRef.current;
      const speedMult = IS_ANDROID ? 3.5 : 1.0;
      const activeLvl = IS_ANDROID ? 0 : lvl; 

      const cRefs = [cornerTLRef, cornerBRRef, cornerTRRef, cornerBLRef, blob5Ref, blob6Ref, blob7Ref, blob8Ref];
      blobState.current.forEach((b, i) => {
        const x = Math.sin(now * (b.sx * speedMult) + b.px) * 15 + Math.sin(now * (b.sx * 0.8 * speedMult) + b.py) * 8;
        const y = Math.cos(now * (b.sy * speedMult) + b.py) * 15 + Math.cos(now * (b.sy * 0.7 * speedMult) + b.px) * 8;
        if (cRefs[i].current) {
          cRefs[i].current!.style.transform = `translate(${x}vw, ${y}vh) scale(${1.0 + activeLvl * 0.15}) translateZ(0)`;
        }
      });

      if (!IS_ANDROID && visModeRef.current === 'RADAR') {
        const d = spatialData.current;
        const lerp = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k;
        const K_fast = 0.15, K_slow = 0.035;

        if (themeColorRef.current !== lastSpriteColor) {
          lastSpriteColor = themeColorRef.current;
          const dCtx = glowSpriteDark.getContext('2d');
          if (dCtx) { dCtx.clearRect(0, 0, 64, 64); dCtx.shadowBlur = 16; dCtx.shadowColor = lastSpriteColor; dCtx.fillStyle = '#ffffff'; dCtx.beginPath(); dCtx.arc(32, 32, 5, 0, Math.PI * 2); dCtx.fill(); dCtx.shadowBlur = 0; }
          const lCtx = glowSpriteLight.getContext('2d');
          if (lCtx) { lCtx.clearRect(0, 0, 64, 64); lCtx.shadowBlur = 12; lCtx.shadowColor = 'rgba(0,0,0,0.2)'; lCtx.fillStyle = lastSpriteColor; lCtx.beginPath(); lCtx.arc(32, 32, 5, 0, Math.PI * 2); lCtx.fill(); lCtx.shadowBlur = 0; }
        }

        rBx.v = lerp(rBx.v, d.bPan * 3, K_fast); rBs.v = lerp(rBs.v, d.bLvl, K_fast);
        if (bassRef.current) bassRef.current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${1.0 + rBs.v * 0.8})`;

        rippleThreshold.current = Math.max(0.12, rippleThreshold.current - 0.001);
        const isSpike = d.bLvl > rippleThreshold.current && (d.bLvl - lastBassLevel.current) > 0.035;
        if (isSpike && wallTime - lastRippleTime.current > 350) {
          const r = rippleState.current.find(r => !r.active);
          if (r) { r.active = true; r.scale = 0.5; r.opacity = 1.0; lastRippleTime.current = wallTime; rippleThreshold.current = Math.min(0.8, d.bLvl + 0.15); }
        }
        lastBassLevel.current = d.bLvl;

        [ripple1Ref, ripple2Ref, ripple3Ref].forEach((ref, idx) => {
          const rip = rippleState.current[idx];
          if (rip.active) {
            rip.scale += 0.06; rip.opacity -= 0.006;
            if (rip.opacity <= 0) { rip.active = false; rip.opacity = 0; }
            if (ref.current) {
              ref.current.style.transform = `translate(calc(-50% + ${rBx.v}vw), -50%) scale(${rip.scale})`;
              ref.current.style.opacity = `${rip.opacity}`;
            }
          }
        });

        rMx.v = lerp(rMx.v, d.mPan * 12, K_slow); rMw.v = lerp(rMw.v, Math.max(0, (1.0 - d.mPhs)) * 8 + 6, K_slow); rMs.v = lerp(rMs.v, d.mLvl, K_slow);
        if (midLRef.current) midLRef.current.style.transform = `translate(calc(-50% + ${rMx.v - rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;
        if (midRRef.current) midRRef.current.style.transform = `translate(calc(-50% + ${rMx.v + rMw.v}vw), -50%) scale(${0.9 + rMs.v * 0.2})`;

        rTx.v = lerp(rTx.v, d.tPan * 25, K_slow); rTw.v = lerp(rTw.v, Math.max(0, (1.0 - d.tPhs)) * 14 + 15, K_slow); rTs.v = lerp(rTs.v, d.tLvl, K_slow);
        if (trebLRef.current) trebLRef.current.style.transform = `translate(calc(-50% + ${rTx.v - rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;
        if (trebRRef.current) trebRRef.current.style.transform = `translate(calc(-50% + ${rTx.v + rTw.v}vw), -50%) scale(${0.9 + rTs.v * 0.25})`;

        const isWide3D = d.tPhs < -0.1 ? Math.abs(d.tPhs) : 0;
        rOx.v = lerp(rOx.v, d.tPan * 35, K_slow); rOw.v = lerp(rOw.v, isWide3D * 15 + 32, K_slow); rOs.v = lerp(rOs.v, isWide3D * d.tLvl, K_slow);
        if (otherLRef.current) { otherLRef.current.style.transform = `translate(calc(-50% + ${rOx.v - rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`; otherLRef.current.style.opacity = `${isWide3D * 0.8}`; }
        if (otherRRef.current) { otherRRef.current.style.transform = `translate(calc(-50% + ${rOx.v + rOw.v}vw), -50%) scale(${1.0 + rOs.v * 0.3})`; otherRRef.current.style.opacity = `${isWide3D * 0.8}`; }

        dustThreshold.current = Math.max(0.04, dustThreshold.current - 0.003);
        const isTrebleSpike = d.tLvl > dustThreshold.current && (d.tLvl - lastTrebleLevel.current) > 0.008;
        if (isTrebleSpike) {
          for (let i = 0; i < 18; i++) {
            const p = dustState.current.find(p => !p.active);
            if (p) {
              p.active = true; p.isLeft = Math.random() > 0.5; p.y = (Math.random() - 0.5) * 60;
              const yN = p.y / 35, arc = 11 * Math.sqrt(Math.max(0, 1 - yN * yN));
              p.isLeft ? (p.x = (rTx.v - rTw.v) - arc, p.vx = -(Math.random() * 0.6 + 0.2)) : (p.x = (rTx.v + rTw.v) + arc, p.vx = (Math.random() * 0.6 + 0.2));
              p.vy = (Math.random() - 0.5) * 0.4 - 0.15; p.scale = Math.random() * 0.5 + 0.3; p.opacity = 1.0;
            }
          }
          dustThreshold.current = Math.min(0.5, d.tLvl + 0.08);
        }
        lastTrebleLevel.current = d.tLvl;

        const canvas = dustCanvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1, dw = canvas.clientWidth, dh = canvas.clientHeight;
          if (canvas.width !== dw * dpr || canvas.height !== dh * dpr) { canvas.width = dw * dpr; canvas.height = dh * dpr; }
          const ctx = canvas.getContext('2d', { alpha: true });
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const cx = canvas.width / 2, cy = canvas.height / 2, vw = canvas.width / 100, vh = canvas.height / 100;
            ctx.globalCompositeOperation = isDarkModeRef.current ? 'screen' : 'source-over';
            const sprite = isDarkModeRef.current ? glowSpriteDark : glowSpriteLight;
            dustState.current.forEach(p => {
              if (p.active) {
                p.vx += (Math.random() - 0.5) * 0.08; p.vy -= 0.015; p.vx *= 0.96; p.vy *= 0.96; p.x += p.vx; p.y += p.vy; p.opacity -= 0.008;
                if (p.opacity <= 0) { p.active = false; } else { ctx.globalAlpha = p.opacity; const ds = (p.scale * dpr) * 70; ctx.drawImage(sprite, (cx + p.x * vw) - ds / 2, (cy + p.y * vh) - ds / 2, ds, ds); }
              }
            });
          }
        }

        if (d.tPhs < 0.05 && Math.random() > 0.6) {
          const art = artifactState.current.find(a => !a.active);
          if (art) { art.active = true; art.x = (Math.random() - 0.5) * 80; art.y = (Math.random() - 0.5) * 80; art.scale = 0; art.opacity = 1.0; }
        }
        artifactState.current.forEach((art, i) => {
          if (art.active) {
            art.scale += 0.025; const as = 0.5 + Math.sin(art.scale) * 0.6; art.opacity = Math.max(0, 1.0 - (art.scale / 3.14));
            if (art.scale >= 3.14) { art.active = false; art.opacity = 0; }
            const el = artifactRefs.current[i]; if (el) { el.style.transform = `translate(calc(-50% + ${art.x}vw), calc(-50% + ${art.y}vh)) scale(${as})`; el.style.opacity = `${art.opacity}`; }
          }
        });
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="ambient-background">
      {(visMode === 'ORBIT' || (IS_ANDROID && visMode === 'RADAR')) ? (
        <>
          <div className="blob blob-1" style={{transform:`scale(${1 + (IS_ANDROID ? audioLevel * 0.5 : audioLevel * 2.0)})`, transition: IS_ANDROID ? 'none' : 'transform 0.12s ease-out'}}/>
          <div className="blob blob-2" style={{transform:`scale(${1 + (IS_ANDROID ? audioLevel * 0.4 : audioLevel * 1.3)})`, transition: IS_ANDROID ? 'none' : 'transform 0.18s ease-out'}}/>
          <div className="blob blob-3" style={{transform:`scale(${1 + (IS_ANDROID ? audioLevel * 0.3 : audioLevel * 0.9)})`, transition: IS_ANDROID ? 'none' : 'transform 0.22s ease-out'}}/>
          <div className="blob blob-4" style={{transform:`scale(${1 + (IS_ANDROID ? audioLevel * 0.2 : audioLevel * 0.6)})`, transition: IS_ANDROID ? 'none' : 'transform 0.25s ease-out'}}/>
        </>
      ):(
        <div style={{position:'absolute',inset:0,'--ring-core':isDarkMode?'rgba(255,255,255,0.9)':'var(--theme-color)'} as React.CSSProperties}>
          <div ref={cornerTLRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,top:'5%',left:'5%',width:'50vw',height:'50vw',background:'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={cornerBRRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,bottom:'5%',right:'5%',width:'45vw',height:'45vw',background:'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={cornerTRRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,top:'5%',right:'5%',width:'35vw',height:'35vw',background:'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={cornerBLRef} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?1.0:0.85,zIndex:0,bottom:'5%',left:'5%',width:'40vw',height:'45vw',background:'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={blob5Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,top:'20%',left:'30%',width:'35vw',height:'35vw',background:'radial-gradient(circle, var(--blob-2) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={blob6Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,bottom:'20%',right:'30%',width:'40vw',height:'40vw',background:'radial-gradient(circle, var(--blob-1) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={blob7Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,top:'35%',right:'15%',width:'38vw',height:'38vw',background:'radial-gradient(circle, var(--theme-color) 0%, transparent 65%)',willChange:'transform'}}/>
          <div ref={blob8Ref} style={{position:'absolute',mixBlendMode:isDarkMode?'normal':'multiply',opacity:isDarkMode?0.8:0.65,zIndex:0,bottom:'35%',left:'15%',width:'50vw',height:'50vw',background:'radial-gradient(circle, var(--blob-3) 0%, transparent 65%)',willChange:'transform'}}/>
          
          {!IS_ANDROID && (
            <>
              <div style={{position:'absolute',inset:0,background:isDarkMode?'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)':'radial-gradient(circle at center, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.4) 100%)',zIndex:1}}/>
              <div style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden',zIndex:2}}>
                <div ref={ripple1Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                <div ref={ripple2Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                <div ref={ripple3Ref} style={{position:'absolute',top:'50%',left:'50%',width:'15vw',height:'15vw',borderRadius:'50%',border:'3px solid var(--ring-core)',boxShadow:'0 0 15px 2px var(--theme-color), inset 0 0 15px 2px var(--theme-color)',opacity:0,willChange:'transform, opacity'}}/>
                <canvas ref={dustCanvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:3,pointerEvents:'none'}}/>
                <div ref={bassRef} style={{position:'absolute',top:'50%',left:'50%',width:'2.5vw',height:'2.5vw',borderRadius:'50%',background:'var(--ring-core)',boxShadow:'0 0 30px 8px var(--theme-color)',willChange:'transform'}}/>
                <div ref={midLRef} style={{position:'absolute',top:'50%',left:'50%',width:'12vw',height:'45vh',borderRadius:'50%',borderLeft:'4px solid var(--ring-core)',filter:'drop-shadow(-4px 0 8px var(--blob-1)) drop-shadow(-4px 0 16px var(--theme-color))',willChange:'transform'}}/>
                <div ref={midRRef} style={{position:'absolute',top:'50%',left:'50%',width:'12vw',height:'45vh',borderRadius:'50%',borderRight:'4px solid var(--ring-core)',filter:'drop-shadow(4px 0 8px var(--blob-1)) drop-shadow(4px 0 16px var(--theme-color))',willChange:'transform'}}/>
                <div ref={trebLRef} style={{position:'absolute',top:'50%',left:'50%',width:'22vw',height:'70vh',borderRadius:'50%',borderLeft:'3px solid var(--ring-core)',filter:'drop-shadow(-6px 0 10px var(--blob-2)) drop-shadow(-6px 0 20px var(--theme-color))',willChange:'transform'}}/>
                <div ref={trebRRef} style={{position:'absolute',top:'50%',left:'50%',width:'22vw',height:'70vh',borderRadius:'50%',borderRight:'3px solid var(--ring-core)',filter:'drop-shadow(6px 0 10px var(--blob-2)) drop-shadow(6px 0 20px var(--theme-color))',willChange:'transform'}}/>
                <div ref={otherLRef} style={{position:'absolute',top:'50%',left:'50%',width:'35vw',height:'95vh',borderRadius:'50%',borderLeft:'2px solid var(--ring-core)',filter:'drop-shadow(-10px 0 15px var(--blob-3))',willChange:'transform, opacity'}}/>
                <div ref={otherRRef} style={{position:'absolute',top:'50%',left:'50%',width:'35vw',height:'95vh',borderRadius:'50%',borderRight:'2px solid var(--ring-core)',filter:'drop-shadow(10px 0 15px var(--blob-3))',willChange:'transform, opacity'}}/>
                {[...Array(6)].map((_,i)=>(<div key={`art${i}`} ref={el=>{artifactRefs.current[i]=el;}} style={{position:'absolute',top:'50%',left:'50%',width:'2vw',height:'2vw',borderRadius:'50%',background:'var(--blob-3)',filter:'blur(3px)',opacity:0,willChange:'transform, opacity'}}/>))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};