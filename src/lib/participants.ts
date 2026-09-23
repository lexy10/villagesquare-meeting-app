import { Track, type Participant, type TrackPublication } from 'livekit-client';
import { SCREEN_SUFFIX } from '../config';

export interface TileSpec { key: string; p: Participant; screen: boolean }
export interface VideoSel { pub: TrackPublication; track: Track; isScr: boolean }

export const isScreenKey = (k: string) => k.endsWith(SCREEN_SUFFIX);
export const displayName = (p: Participant) => p.name || p.identity;

// Enumerate video publications and classify them by their own `source`, rather
// than asking getTrackPublication(Source.X): remote participants don't always
// resolve that lookup, and when it missed a presentation fell into the camera
// slot — remote viewers saw the presenter *replaced* by their screen.
function videoPubs(p: Participant): TrackPublication[] {
  const out: TrackPublication[] = [];
  const add = (pub: TrackPublication) => {
    if (!pub) return;
    const kind = pub.kind || pub.track?.kind;
    if (kind && String(kind).toLowerCase() !== 'video') return;
    if (!kind && !pub.source) return;
    out.push(pub);
  };
  const anyP = p as any;
  for (const m of [anyP.videoTrackPublications, anyP.trackPublications, anyP.tracks, anyP.videoTracks]) {
    if (m && typeof m.forEach === 'function') { m.forEach(add); if (out.length) break; }
  }
  return out;
}

const pubIsScreen = (pub: TrackPublication) => String(pub.source || pub.track?.source || '').toLowerCase().includes('screen');

/** A screen publication exists (maybe not subscribed yet) — enough to show its tile. */
export function screenPubAny(p: Participant): TrackPublication | null {
  const found = videoPubs(p).find(pubIsScreen);
  if (found) return found;
  try { return p.getTrackPublication(Track.Source.ScreenShare) || null; } catch { return null; }
}

// Only renderable if the track is actually alive: mid-unpublish a publication
// can linger with a dead track, and attaching that paints a black tile.
function isPlayable(pub: TrackPublication | null | undefined): pub is TrackPublication & { track: Track } {
  if (!pub || !pub.track || pub.isMuted) return false;
  const mst = pub.track.mediaStreamTrack;
  return !(mst && mst.readyState !== 'live');
}

export function screenPub(p: Participant): VideoSel | null {
  const pub = screenPubAny(p);
  return isPlayable(pub) ? { pub, track: pub.track, isScr: true } : null;
}

export function cameraPub(p: Participant): VideoSel | null {
  let pub: TrackPublication | undefined = videoPubs(p).find(x => !pubIsScreen(x));
  if (!pub) { try { pub = p.getTrackPublication(Track.Source.Camera); } catch { /* ignore */ } }
  return isPlayable(pub) ? { pub, track: pub.track, isScr: false } : null;
}

/** Live (unmuted, published) microphone track, if any. */
export function micLive(p: Participant): boolean {
  const mic = p.getTrackPublication(Track.Source.Microphone);
  return !!(mic && mic.track && !mic.isMuted);
}

export function micTrack(p: Participant): Track | null {
  const mic = p.getTrackPublication(Track.Source.Microphone);
  return mic && mic.track && !mic.isMuted ? mic.track : null;
}

/**
 * One entry per tile. A presentation is its own tile, not a replacement for the
 * presenter's camera — you keep seeing their face while their screen is up.
 */
export function renderables(parts: Participant[]): TileSpec[] {
  const out: TileSpec[] = [];
  parts.forEach(p => {
    if (screenPubAny(p)) out.push({ key: p.identity + SCREEN_SUFFIX, p, screen: true });
    out.push({ key: p.identity, p, screen: false });
  });
  return out;
}
