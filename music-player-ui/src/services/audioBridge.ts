import { invoke } from '@tauri-apps/api/core';

let pending: Promise<unknown> = Promise.resolve();
let snapshot: { values: number[]; operation: Promise<void> } | undefined;
export function sendAudioCommand(cmd: string): Promise<void> {
  snapshot = undefined;
  const operation = pending.catch(() => {}).then(() => invoke<void>('audio_command', { cmd: cmd.trim() }));
  pending = operation;
  operation.then(() => { window.dispatchEvent(new CustomEvent('dmex-audio-error', { detail: '' }));
    window.dispatchEvent(new Event('dmex-audio-changed')); },
    error => { window.dispatchEvent(new CustomEvent('dmex-audio-error', { detail: String(error) }));
      window.dispatchEvent(new Event('dmex-audio-changed')); });
  return operation;
}
export async function applyAudioSettings(values: number[]): Promise<void> {
  if (snapshot) { snapshot.values = values; return snapshot.operation; }
  const batch = { values, operation: Promise.resolve() };
  batch.operation = pending.catch(() => {}).then(async () => {
    if (snapshot === batch) snapshot = undefined;
    await invoke<void>('audio_apply_settings', { values: batch.values });
    window.dispatchEvent(new Event('dmex-audio-changed'));
  });
  snapshot = batch;
  pending = batch.operation;
  return batch.operation;
}
