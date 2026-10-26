import { useEffect, useRef } from 'react';

const HOVER_GRACE_MS = 1000;

/**
 * Closes a popover the way Google Meet does: a click or tap anywhere outside
 * it, Escape, or (with a mouse) the pointer staying away from it for a second.
 * `zone` is the popover plus the button that opened it; that button keeps its
 * own toggle, so pressing it again still closes rather than reopens.
 */
export function useDismiss(open: boolean, onClose: () => void, zone: () => (Element | null | undefined)[]) {
  const close = useRef(onClose);
  const getZone = useRef(zone);
  close.current = onClose;
  getZone.current = zone;

  useEffect(() => {
    if (!open) return;
    const inZone = (t: EventTarget | null) => t instanceof Node && getZone.current().some(el => el?.contains(t));
    let timer = 0;

    const onDown = (e: PointerEvent) => { if (!inZone(e.target)) close.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (inZone(e.target)) { window.clearTimeout(timer); timer = 0; }
      else if (!timer) timer = window.setTimeout(() => close.current(), HOVER_GRACE_MS);
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointermove', onMove);
    };
  }, [open]);
}
