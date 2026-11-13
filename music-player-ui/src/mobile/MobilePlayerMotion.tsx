import { ReactNode, RefObject, useLayoutEffect, useRef } from 'react';

export function PlayerFrame({ mobile, expanded, mini, miniRef, children }: {
  mobile: boolean; expanded: boolean; mini: ReactNode; miniRef: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const footer = <footer ref={miniRef} className={`bottom-player ${expanded ? 'expanded' : ''}`}>{mini}{!mobile && children}</footer>;
  return mobile ? <>{footer}{children}</> : footer;
}

export function useMobilePlayerMotion(mobile: boolean, expanded: boolean, miniRef: RefObject<HTMLElement | null>, sheetRef: RefObject<HTMLDivElement | null>, setReady: (ready: boolean) => void) {
  const initialized = useRef(false), wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (!mobile) { setReady(expanded); return; }
    const sheet = sheetRef.current, mini = miniRef.current;
    if (!sheet || !mini) return;
    const host = sheet.closest<HTMLElement>('.app-layout')!;
    let disposed = false, paint = 0, nextPaint = 0;
    let motion: Animation | undefined, miniMotion: Animation | undefined;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = !initialized.current;
    initialized.current = true;
    const phase = (value: string) => { sheet.dataset.phase = value; host.dataset.playerPhase = value; };
    const finish = () => {
      if (disposed) return;
      sheet.style.transform = expanded ? 'translate3d(0,0,0)' : 'translate3d(0,100%,0)';
      sheet.style.visibility = expanded ? 'visible' : 'hidden';
      mini.style.opacity = expanded ? '0' : '1';
      motion?.cancel(); miniMotion?.cancel();
      phase(expanded ? 'open' : 'closed');
      if (!expanded) { wasOpen.current = false; setReady(false); }
      else if (reduced) { wasOpen.current = true; setReady(true); }
      else {
        // Let the settled sheet paint before starting visualizer and marquee work.
        paint = requestAnimationFrame(() => { nextPaint = requestAnimationFrame(() => {
          if (!disposed) { wasOpen.current = true; setReady(true); }
        }); });
      }
    };
    if (first || reduced) { finish(); return () => { disposed = true; cancelAnimationFrame(paint); cancelAnimationFrame(nextPaint); }; }
    const current = getComputedStyle(sheet).transform;
    const y = current === 'none' ? sheet.clientHeight : new DOMMatrixReadOnly(current).m42;
    const from = expanded && sheet.style.visibility === 'hidden' ? mini.getBoundingClientRect().top : y;
    if (expanded && !wasOpen.current) setReady(false);
    sheet.style.visibility = 'visible';
    phase(expanded ? 'opening' : 'closing');
    const target = expanded ? 0 : sheet.clientHeight;
    const duration = Math.max(160, Math.min(expanded ? 380 : 300, Math.abs(target - from) * .48));
    motion = sheet.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${target}px,0)` }],
      { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    miniMotion = mini.animate([{ opacity: Number(getComputedStyle(mini).opacity) }, { opacity: expanded ? 0 : 1 }],
      { duration: expanded ? 100 : 140, delay: expanded ? 0 : Math.max(0, duration - 140), fill: 'both' });
    void motion.finished.then(finish, () => {});
    const resize = () => finish();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true; cancelAnimationFrame(paint); cancelAnimationFrame(nextPaint);
      // Preserve the rendered position before cancelling, including rapid reversals.
      if (motion?.playState === 'running') sheet.style.transform = getComputedStyle(sheet).transform;
      if (miniMotion?.playState === 'running') mini.style.opacity = getComputedStyle(mini).opacity;
      motion?.cancel(); miniMotion?.cancel(); window.removeEventListener('resize', resize);
    };
  }, [mobile, expanded, miniRef, sheetRef, setReady]);
}
