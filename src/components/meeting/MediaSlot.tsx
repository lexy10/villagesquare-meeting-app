import { useLayoutEffect, useRef } from 'react';
import type { Track } from 'livekit-client';
import { mediaElementFor } from '../../lib/mediaElements';

/**
 * Mounts the cached <video>/<audio> element for a track (see mediaElements.ts).
 * The wrapper is `display: contents`, so the element lays out as a direct child
 * of the tile exactly as before.
 */
export default function MediaSlot({ track }: { track: Track }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const el = mediaElementFor(track);
    if (el.parentNode !== host) host.appendChild(el);
    return () => { if (el.parentNode === host) host.removeChild(el); };
  }, [track]);
  return <span className="vsm-media" ref={ref} />;
}
