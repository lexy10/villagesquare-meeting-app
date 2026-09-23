import type { Track } from 'livekit-client';

// One attached <video>/<audio> element per track, kept outside React.
//
// Tiles move between parents — into the `.filmstrip` when someone is pinned or
// presents, back out when the spotlight ends — and React remounts a component
// whenever its parent changes. If each tile rendered its own <video>, every
// move would detach and re-attach the stream and blink everyone's tile. Instead
// a tile borrows the cached element for its track (see MediaSlot), so moving a
// tile just moves the same playing element.
const cache = new Map<Track, HTMLMediaElement>();

export function mediaElementFor(track: Track): HTMLMediaElement {
  let el = cache.get(track);
  if (!el) {
    el = track.attach();
    if (el instanceof HTMLVideoElement) {
      el.autoplay = true; el.playsInline = true; el.muted = true;
    } else {
      el.style.display = 'none';
    }
    cache.set(track, el);
  }
  return el;
}

export const peekMediaElement = (track: Track) => cache.get(track) || null;

function release(track: Track, el: HTMLMediaElement) {
  try { track.detach(el); } catch { /* already detached */ }
  try { el.srcObject = null; } catch { /* ignore */ }
  el.remove();
  cache.delete(track);
}

/** Release elements for tracks no longer on screen (left, muted, unpublished). */
export function pruneMediaElements(live: ReadonlySet<Track>) {
  cache.forEach((el, track) => { if (!live.has(track)) release(track, el); });
}

export function releaseAllMediaElements() {
  cache.forEach((el, track) => release(track, el));
}

/** Nudge every element to play again (after autoplay unblock / tab restore / reconnect). */
export function replayMediaElements() {
  cache.forEach(el => { el.play().catch(() => { /* still blocked; the audio gate handles it */ }); });
}
