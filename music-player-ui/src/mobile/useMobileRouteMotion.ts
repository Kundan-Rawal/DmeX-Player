import { RefObject, useLayoutEffect, useRef } from 'react';
import { MobileRoute } from './library';

const tabs = ['favourites', 'playlists', 'tracks', 'albums', 'artists', 'folders', 'discover'];
export function useMobileRouteMotion(surface: RefObject<HTMLElement | null>, route: MobileRoute, depth: number, expanded: boolean) {
  const previous = useRef({ route, depth }), animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const old = previous.current; previous.current = { route, depth };
    if (JSON.stringify(old.route) === JSON.stringify(route) || expanded || !surface.current) return;
    const element = surface.current;
    animation.current?.cancel(); element.style.transform = ''; element.style.opacity = '';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const direction = old.route.kind === 'library' && route.kind === 'library'
      ? Math.sign(tabs.indexOf(route.tab) - tabs.indexOf(old.route.tab)) || 1 : depth < old.depth ? -1 : 1;
    const distance = Math.min(96, Math.max(48, element.clientWidth * .16));
    element.style.willChange = 'transform, opacity';
    const motion = element.animate([{ transform: `translate3d(${direction * distance}px,0,0)`, opacity: .35 }, { transform: 'translate3d(0,0,0)', opacity: 1 }],
      { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
    animation.current = motion;
    void motion.finished.catch(() => {}).then(() => { if (animation.current === motion) element.style.willChange = ''; });
    return () => { motion.cancel(); element.style.willChange = ''; };
  }, [surface, route, depth, expanded]);
}
