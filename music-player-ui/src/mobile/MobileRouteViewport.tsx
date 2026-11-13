import { createContext, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MobileRoute } from './library';
import { haptic } from './haptics';

const tabs = ['favourites', 'playlists', 'tracks', 'albums', 'artists', 'folders', 'discover'];
export const MobilePageActiveContext = createContext(true);
interface Snapshot { key: string; route: MobileRoute; depth: number; children: ReactNode }
interface Gesture { x: number; y: number; offset: number; horizontal: boolean; rejected: boolean; lastX: number; time: number; velocity: number }
const translate = (x: number) => `translate3d(${x}px,0,0)`;
const xPosition = (element: HTMLElement) => {
  const transform = getComputedStyle(element).transform;
  return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
};

export function MobileRouteViewport({ route, depth, disabled, swipeEnabled, onSwipe, busy, children }: {
  route: MobileRoute; depth: number; disabled: boolean; swipeEnabled: boolean;
  onSwipe: (direction: -1 | 1) => boolean; busy: boolean; children: ReactNode;
}) {
  const key = JSON.stringify(route), viewport = useRef<HTMLElement>(null);
  const last = useRef<Snapshot>({ key, route, depth, children });
  const [renderedKey, setRenderedKey] = useState(key), [outgoing, setOutgoing] = useState<Snapshot | null>(null);
  const panes = useRef(new Map<string, HTMLDivElement>()), motions = useRef<Animation[]>([]);
  const handoff = useRef<{ offset: number; direction: number; velocity: number } | null>(null);
  const gesture = useRef<Gesture | null>(null), frame = useRef(0), suppressClick = useRef(false);
  const props = useRef({ key, disabled, swipeEnabled, onSwipe });
  props.current = { key, disabled, swipeEnabled, onSwipe };
  if (renderedKey !== key) { setRenderedKey(key); setOutgoing(last.current); }

  useLayoutEffect(() => { last.current = { key, route, depth, children }; });
  useLayoutEffect(() => {
    const element = viewport.current!, current = panes.current.get(key)!;
    let disposed = false;
    const old = outgoing && panes.current.get(outgoing.key);
    const transfer = handoff.current; handoff.current = null;
    const finish = () => {
      if (disposed) return;
      current.style.transform = ''; current.style.willChange = '';
      motions.current.forEach(animation => animation.cancel()); motions.current = [];
      element.dataset.motion = 'idle'; setOutgoing(null);
    };
    if (!old || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {
      const direction = transfer?.direction ?? (outgoing.route.kind === 'library' && route.kind === 'library'
        ? Math.sign(tabs.indexOf(route.tab) - tabs.indexOf(outgoing.route.tab)) || 1 : depth < outgoing.depth ? -1 : 1);
      const width = element.clientWidth, offset = transfer?.offset ?? xPosition(old);
      const remaining = Math.max(0, width - Math.abs(offset));
      const velocity = Math.max(.6, Math.min(1.8, Math.abs(transfer?.velocity || 0)));
      const duration = Math.max(180, Math.min(340, remaining / velocity));
      element.dataset.motion = 'settling';
      current.style.willChange = old.style.willChange = 'transform';
      const options: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'both' };
      motions.current = [
        old.animate([{ transform: translate(offset) }, { transform: translate(-direction * width) }], options),
        current.animate([{ transform: translate(direction * width + offset) }, { transform: translate(0) }], options),
      ];
      void motions.current[1].finished.then(finish, () => {});
    }
    const resize = () => finish();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true; window.removeEventListener('resize', resize);
      // A rapid tab tap starts from the displayed position, never a reset to zero.
      if (current.isConnected) current.style.transform = getComputedStyle(current).transform;
      motions.current.forEach(animation => animation.cancel()); motions.current = [];
    };
  }, [key]);

  useEffect(() => {
    const element = viewport.current!;
    const reset = (animate: boolean) => {
      cancelAnimationFrame(frame.current); frame.current = 0;
      const page = panes.current.get(props.current.key); if (!page) return;
      const from = xPosition(page); page.style.transform = '';
      if (animate && from && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        element.dataset.motion = 'settling';
        const motion = page.animate([{ transform: translate(from) }, { transform: translate(0) }], { duration: 220, easing: 'cubic-bezier(.2,.7,.25,1)' });
        motions.current = [motion];
        void motion.finished.then(() => {
          if (motions.current.includes(motion)) { motions.current = []; page.style.willChange = ''; element.dataset.motion = 'idle'; }
        }, () => {});
      } else { page.style.willChange = ''; element.dataset.motion = 'idle'; }
    };
    const start = (event: TouchEvent) => {
      const p = props.current, target = event.target as Element;
      suppressClick.current = false;
      if (!p.swipeEnabled || p.disabled || event.touches.length !== 1 || element.dataset.motion === 'settling'
        || target.closest('input,textarea,select,[role="slider"],.dmex-mobile-drag-handle,.custom-select')) { gesture.current = null; return; }
      const touch = event.touches[0];
      gesture.current = { x: touch.clientX, y: touch.clientY, offset: 0, horizontal: false, rejected: false, lastX: touch.clientX, time: performance.now(), velocity: 0 };
    };
    const move = (event: TouchEvent) => {
      const g = gesture.current; if (!g || g.rejected) return;
      if (event.touches.length !== 1) { gesture.current = null; reset(true); return; }
      const touch = event.touches[0], dx = touch.clientX - g.x, dy = touch.clientY - g.y;
      if (!g.horizontal && Math.max(Math.abs(dx), Math.abs(dy)) > 8) { g.horizontal = Math.abs(dx) > Math.abs(dy) * 1.4; g.rejected = !g.horizontal; }
      if (!g.horizontal) return;
      if (event.cancelable) event.preventDefault();
      suppressClick.current = true;
      const now = performance.now();
      g.velocity = .65 * g.velocity + .35 * (touch.clientX - g.lastX) / Math.max(1, now - g.time);
      g.lastX = touch.clientX; g.time = now;
      g.offset = Math.max(-element.clientWidth * .85, Math.min(element.clientWidth * .85, dx));
      element.dataset.motion = 'dragging';
      if (!frame.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (!gesture.current) return;
        const page = panes.current.get(props.current.key);
        if (page) { page.style.willChange = 'transform'; page.style.transform = translate(gesture.current.offset); }
      });
    };
    const end = (event: TouchEvent) => {
      const g = gesture.current; gesture.current = null;
      if (!g || !g.horizontal || g.rejected) return;
      if (props.current.disabled || !props.current.swipeEnabled) { reset(true); return; }
      cancelAnimationFrame(frame.current); frame.current = 0;
      const touch = event.changedTouches[0], dx = (touch?.clientX ?? g.lastX) - g.x;
      const direction = dx < 0 ? 1 : -1;
      const commit = Math.abs(dx) >= Math.min(72, element.clientWidth * .2) || (Math.abs(dx) >= 28 && Math.abs(g.velocity) > .45);
      if (!commit) { reset(true); return; }
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const page = panes.current.get(props.current.key);
      if (page && !reduced) page.style.transform = translate(g.offset);
      handoff.current = { offset: reduced ? 0 : g.offset, direction, velocity: g.velocity };
      if (props.current.onSwipe(direction)) haptic('selection');
      else { handoff.current = null; reset(true); }
    };
    const cancel = () => { if (gesture.current) { gesture.current = null; reset(true); } };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end); element.addEventListener('touchcancel', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      cancelAnimationFrame(frame.current); motions.current.forEach(animation => animation.cancel());
      element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  const render = (value: Snapshot, current: boolean) => <div key={value.key}
    ref={node => { if (node) panes.current.set(value.key, node); else panes.current.delete(value.key); }}
    className="dmex-mobile-route-page" data-current={current} inert={!current} aria-hidden={!current || undefined}>
    <MobilePageActiveContext.Provider value={current}>{value.children}</MobilePageActiveContext.Provider>
  </div>;
  return <main ref={viewport} className="dmex-mobile-main" data-motion="idle" inert={disabled} aria-hidden={disabled || undefined} aria-busy={busy}
    onClickCapture={event => {
      const native = event.nativeEvent as PointerEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } };
      if (suppressClick.current && (native.pointerType === 'touch' || native.sourceCapabilities?.firesTouchEvents)) { event.preventDefault(); event.stopPropagation(); }
      suppressClick.current = false;
    }}>
    {outgoing && outgoing.key !== key && render(outgoing, false)}
    {render({ key, route, depth, children }, true)}
  </main>;
}
