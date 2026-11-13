import { ReactNode, RefObject, useLayoutEffect, useRef } from 'react';

export function PlayerFrame({ mobile, expanded, mini, miniRef, children }: {
  mobile: boolean; expanded: boolean; mini: ReactNode; miniRef: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const footer = <footer ref={miniRef} className={`bottom-player ${expanded ? 'expanded' : ''}`}>{mini}{!mobile && children}</footer>;
  return mobile ? <>{footer}{children}</> : footer;
}

export function useMobilePlayerMotion(mobile: boolean, expanded: boolean, miniRef: RefObject<HTMLElement | null>, sheetRef: RefObject<HTMLDivElement | null>, setReady: (ready: boolean) => void) {
  const initialized = useRef(false), wasOpen = useRef(false);
  const presentation = useRef<{ art?: { source: string; width: number; transform: string; borderRadius: string }; opacity?: Record<string, string> }>({});
  useLayoutEffect(() => {
    if (!mobile) { setReady(expanded); return; }
    const sheet = sheetRef.current, mini = miniRef.current;
    if (!sheet || !mini) return;
    const host = sheet.closest<HTMLElement>('.app-layout')!;
    let disposed = false, paint = 0, nextPaint = 0;
    let motion: Animation | undefined, miniMotion: Animation | undefined;
    const decorations: HTMLElement[] = [], supporting: Animation[] = [];
    const cleanupDecorations = () => { supporting.forEach(value => value.cancel()); decorations.forEach(value => value.remove()); };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = !initialized.current;
    initialized.current = true;
    const phase = (value: string) => { sheet.dataset.phase = value; host.dataset.playerPhase = value; };
    const finish = () => {
      if (disposed) return;
      sheet.style.transform = expanded ? 'translate3d(0,0,0)' : 'translate3d(0,100%,0)';
      sheet.style.visibility = expanded ? 'visible' : 'hidden';
      sheet.style.clipPath = '';
      cleanupDecorations();
      presentation.current = {};
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
    const previousClip = getComputedStyle(sheet).clipPath;
    const current = getComputedStyle(sheet).transform;
    const y = current === 'none' ? sheet.clientHeight : new DOMMatrixReadOnly(current).m42;
    const from = expanded && sheet.style.visibility === 'hidden' ? mini.getBoundingClientRect().top : y;
    if (expanded && !wasOpen.current) setReady(false);
    sheet.style.visibility = 'visible';
    phase(expanded ? 'opening' : 'closing');
    const target = expanded ? 0 : sheet.clientHeight;
    const duration = Math.max(160, Math.min(expanded ? 380 : 300, Math.abs(target - from) * .48));
    const timing: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' };
    if (CSS.supports('clip-path', 'inset(0 round 1px)')) {
      const pill = mini.getBoundingClientRect(), width = sheet.clientWidth, height = sheet.clientHeight;
      const pillClip = `inset(${pill.top}px ${Math.max(0, width - pill.right)}px ${Math.max(0, height - pill.bottom)}px ${pill.left}px round ${pill.height / 2}px)`;
      const fullClip = 'inset(0px 0px 0px 0px round 0px)';
      const startClip = previousClip !== 'none' ? previousClip : expanded ? pillClip : fullClip;
      sheet.style.transform = 'translate3d(0,0,0)';
      motion = sheet.animate([{ clipPath: startClip }, { clipPath: expanded ? fullClip : pillClip }], timing);
      const cover = sheet.querySelector<HTMLElement>('.mep-art');
      const thumbnail = mini.querySelector<HTMLImageElement>('.dmex-artwork img');
      if (cover && thumbnail?.complete && thumbnail.naturalWidth) {
        const destination = cover.getBoundingClientRect(), origin = thumbnail.getBoundingClientRect();
        const image = document.createElement('img'); image.src = thumbnail.currentSrc || thumbnail.src;
        image.dataset.playerSharedArt = 'true';
        image.alt = ''; image.setAttribute('aria-hidden', 'true');
        Object.assign(image.style, { position: 'fixed', left: '0', top: '0', width: `${destination.width}px`, height: `${destination.height}px`,
          objectFit: 'cover', transformOrigin: '0 0', pointerEvents: 'none', zIndex: '2100', willChange: 'transform' });
        host.appendChild(image); decorations.push(image);
        const small = { transform: `translate3d(${origin.x}px,${origin.y}px,0) scale(${origin.width / destination.width})`, borderRadius: `${5 * destination.width / origin.width}px` };
        const large = { transform: `translate3d(${destination.x}px,${destination.y}px,0) scale(1)`, borderRadius: '16px' };
        const previousArt = presentation.current.art;
        const artStart = previousArt?.source === image.src && previousArt.width === destination.width
          ? { transform: previousArt.transform, borderRadius: previousArt.borderRadius } : expanded ? small : large;
        supporting.push(image.animate([artStart, expanded ? large : small], timing));
        supporting.push(cover.animate([{ opacity: 0 }, { opacity: 0 }], { duration, fill: 'both' }));
      }
      for (const selector of ['.mep-topbar', '.mep-body']) {
        const content = sheet.querySelector<HTMLElement>(selector);
        if (content) supporting.push(content.animate([{ opacity: presentation.current.opacity?.[selector] ?? (expanded ? 0 : 1) }, { opacity: expanded ? 1 : 0 }],
          { duration: expanded ? duration * .65 : duration * .35, delay: expanded ? duration * .25 : 0, fill: 'both', easing: 'ease-out' }));
      }
    } else {
      motion = sheet.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${target}px,0)` }], timing);
    }
    miniMotion = mini.animate([{ opacity: Number(getComputedStyle(mini).opacity) }, { opacity: expanded ? 0 : 1 }],
      { duration: expanded ? 100 : 140, delay: expanded ? 0 : Math.max(0, duration - 140), fill: 'both' });
    void motion.finished.then(finish, () => {});
    const resize = () => finish();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true; cancelAnimationFrame(paint); cancelAnimationFrame(nextPaint);
      // Preserve the rendered position before cancelling, including rapid reversals.
      if (motion?.playState === 'running') {
        sheet.style.transform = getComputedStyle(sheet).transform;
        sheet.style.clipPath = getComputedStyle(sheet).clipPath;
        const image = decorations[0] as HTMLImageElement | undefined;
        const opacity: Record<string, string> = {};
        for (const selector of ['.mep-topbar', '.mep-body']) {
          const content = sheet.querySelector<HTMLElement>(selector);
          if (content) opacity[selector] = getComputedStyle(content).opacity;
        }
        presentation.current = { opacity, art: image ? { source: image.src, width: image.width, transform: getComputedStyle(image).transform, borderRadius: getComputedStyle(image).borderRadius } : undefined };
      }
      if (miniMotion?.playState === 'running') mini.style.opacity = getComputedStyle(mini).opacity;
      motion?.cancel(); miniMotion?.cancel(); cleanupDecorations(); window.removeEventListener('resize', resize);
    };
  }, [mobile, expanded, miniRef, sheetRef, setReady]);
}
