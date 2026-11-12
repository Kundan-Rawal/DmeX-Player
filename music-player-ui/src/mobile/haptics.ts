import { invoke } from '@tauri-apps/api/core';
import { IS_ANDROID } from '../types';

export type HapticKind = 'tap' | 'selection' | 'confirm' | 'longPress' | 'dragStart' | 'dragTick' | 'reject';
const KEY = 'dmex_haptics_enabled';
let lastFeedback = -Infinity;
export function hapticsEnabled() {
  try { return localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}
export function setHapticsEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, String(enabled)); } catch {}
}
export function haptic(kind: HapticKind = 'tap') {
  if (!IS_ANDROID || !hapticsEnabled() || document.visibilityState === 'hidden') return;
  const now = performance.now(), interval = kind === 'dragTick' || kind === 'selection' ? 70 : 35;
  if (now - lastFeedback < interval) return;
  lastFeedback = now;
  void invoke('mobile_haptic', { kind }).catch(() => {});
}
