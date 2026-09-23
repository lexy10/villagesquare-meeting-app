import { useSyncExternalStore } from 'react';

// A single app-wide toast. Kept as a tiny external store so anything — screens
// or the meeting store's LiveKit handlers — can raise one with a plain call.
interface ToastState { msg: string; visible: boolean }
let state: ToastState = { msg: '', visible: false };
const listeners = new Set<() => void>();
let timer: number | undefined;

const emit = () => listeners.forEach(l => l());

export function toast(msg: string, ms = 2600) {
  window.clearTimeout(timer);
  state = { msg, visible: true };
  emit();
  timer = window.setTimeout(() => { state = { ...state, visible: false }; emit(); }, ms);
}

export function useToast(): ToastState {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => state,
  );
}
