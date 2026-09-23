export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Screen capture is desktop-only: iOS exposes no web API for it and Chrome for
// Android doesn't implement getDisplayMedia. Detect it up front instead of
// failing with a misleading "cancelled".
export const canShareScreen = () => !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

/** Human-readable reason a camera/mic call failed, with the fix the user can apply. */
export function deviceError(e: unknown, kind: 'Camera' | 'Microphone', on: boolean): string {
  const n = (e as { name?: string } | null)?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    // iOS grants camera/mic to the browser app itself, so a denial can't be
    // undone from the page — point at the setting that actually controls it.
    return IS_IOS
      ? `${kind} blocked — turn on ${kind} for your browser in iOS Settings, then reload`
      : `${kind} blocked — allow access from the padlock in the address bar, then tap again`;
  }
  if (n === 'NotFoundError') return `No ${kind.toLowerCase()} found on this device`;
  if (n === 'NotReadableError') return `${kind} is in use by another app — close it and tap again`;
  return `Could not turn ${kind.toLowerCase()} ${on ? 'on' : 'off'} — tap to retry`;
}
