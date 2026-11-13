import React, { useEffect, useRef } from 'react';

export const Android8BRipples: React.FC<{ spatialData: React.MutableRefObject<any>, isPlaying: boolean }> = ({ spatialData, isPlaying }) => {
  const r1 = useRef<HTMLDivElement>(null);
  const r2 = useRef<HTMLDivElement>(null);
  const r3 = useRef<HTMLDivElement>(null);

  const rippleState = useRef([
    { active: false, triggerTime: 0 },
    { active: false, triggerTime: 0 },
    { active: false, triggerTime: 0 }
  ]);
  const lastRippleTime = useRef(0);
  const lastBassLevel = useRef(0);
  const rippleThreshold = useRef(0.35);

  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!isPlaying) return;

      const d = spatialData.current;
      if (!d) return;
      const lvl = d.bLvl;
      
      // Decay threshold slowly down to 0.1
      rippleThreshold.current = Math.max(0.1, rippleThreshold.current - 0.001);
      
      // Cleanup expired ripples inside the loop (no setTimeouts!)
      rippleState.current.forEach(r => {
        if (r.active && now - r.triggerTime > 1800) {
          r.active = false;
        }
      });
      
      // Dynamic spike detection: 
      // 1. Must be above the dynamically decaying threshold
      // 2. Must be on the rising edge of the wave
      const isRising = lvl > lastBassLevel.current;
      const isSpike = lvl > rippleThreshold.current && isRising;
      
      if (isSpike && now - lastRippleTime.current > 330) { 
        const rIdx = rippleState.current.findIndex(r => !r.active);
        if (rIdx !== -1) {
          const r = rippleState.current[rIdx];
          const ref = [r1, r2, r3][rIdx];
          r.active = true;
          r.triggerTime = now;
          lastRippleTime.current = now;
          
          // Artificially bump the threshold to prevent immediate double-triggers,
          // but strictly cap it at 0.35 so loud songs always trigger.
          rippleThreshold.current = Math.min(0.35, rippleThreshold.current + 0.15);
          
          if (ref.current) {
            ref.current.style.animation = 'none';
            // Avoid synchronous reflow stutter by waiting for next paint frame
            requestAnimationFrame(() => {
              if (ref.current) ref.current.style.animation = 'mep-neon-expand 1.8s linear forwards';
            });
          }
        }
      }
      lastBassLevel.current = lvl;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, spatialData]);

  return (
    <>
      <div ref={r1} className="mep-neon-ripple" />
      <div ref={r2} className="mep-neon-ripple" />
      <div ref={r3} className="mep-neon-ripple" />
    </>
  );
};

export const Android8BDustCanvas: React.FC<{ isExpanded?: boolean; isDarkMode: boolean }> = ({ isExpanded = true, isDarkMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(isDarkMode);
  useEffect(() => { darkRef.current = isDarkMode; }, [isDarkMode]);
  
  const motes = useRef(Array.from({ length: 40 }).map(() => ({
    x: Math.random() * (window.innerWidth || 500),
    y: Math.random() * (window.innerHeight || 800),
    // Enforce exactly 1px, 2px, 3px, 4px, or 5px distinct sizes
    size: Math.floor(Math.random() * 5) + 1,
    opacity: 1.0, // 100% visible, no fading
    vy: -(Math.random() * 1.5 + 1.0), // Much faster upward movement
    vx: (Math.random() - 0.5) * 0.8 // Faster horizontal drift
  })));

  // Use a mutable ref to track isExpanded inside the RAF without recreating the function
  const isExpandedRef = useRef(isExpanded);
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;
    
    cvs.width = window.innerWidth;
    cvs.height = window.innerHeight;

    let rafId: number;
    let previous = 0;
    const draw = (now: number) => {
      const step = previous ? Math.min((now - previous) / (1000 / 60), 3) : 1;
      previous = now;
      // Pause battery-draining math when UI is minimized
      if (!isExpandedRef.current || document.hidden) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, cvs.width, cvs.height);
      
      // Use pure white/black without any background washing out the color
      ctx.fillStyle = darkRef.current ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
      
      motes.current.forEach(m => {
        m.x += m.vx * step;
        m.y += m.vy * step;
        if (m.y < -10) m.y = cvs.height + 10;
        if (m.x < -10) m.x = cvs.width + 10;
        if (m.x > cvs.width + 10) m.x = -10;
        
        ctx.globalAlpha = m.opacity;
        
        // Render perfect circles instead of squares
        ctx.beginPath();
        // m.size is the diameter, so radius is m.size / 2
        ctx.arc(m.x, m.y, m.size / 2, 0, Math.PI * 2);
        ctx.fill();
      });
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    const handleResize = () => {
      const scaleX = window.innerWidth / Math.max(1, cvs.width);
      const scaleY = window.innerHeight / Math.max(1, cvs.height);
      // Reproject positions on rotation without changing fixed particle sizes or speed.
      motes.current.forEach(m => { m.x *= scaleX; m.y *= scaleY; });
      cvs.width = window.innerWidth;
      cvs.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }} />;
};
