import { useEffect } from 'react';
import { IS_ANDROID } from '../types';
import { haptic } from './haptics';

export function useMobileFeedback() {
  useEffect(() => {
    if (!IS_ANDROID) return;
    const buckets = new WeakMap<HTMLInputElement, number>();
    const click = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      const control = (event.target as Element).closest<HTMLElement>('button,[role="option"]');
      if (!control || control.matches(':disabled,[aria-disabled="true"],[data-haptic="off"]')) return;
      haptic(control.matches('[role="switch"],[role="option"],.dmex-mobile-tabs button') ? 'selection' : 'tap');
    };
    const input = (event: Event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement) || control.type !== 'range' || !event.isTrusted) return;
      const min = Number(control.min) || 0, max = Number(control.max) || 100;
      const bucket = Math.round((control.valueAsNumber - min) / Math.max(1, max - min) * 20);
      if (bucket !== buckets.get(control)) { buckets.set(control, bucket); haptic('selection'); }
    };
    document.addEventListener('click', click, true); document.addEventListener('input', input, true);
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('input', input, true); };
  }, []);
}
