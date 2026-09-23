import type { CSSProperties } from 'react';
import type { Theme } from './storage';

export function initials(n: string): string {
  n = (n || '').trim();
  if (!n) return '?';
  const p = n.split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

export const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Curated hue/saturation pairs rather than evenly spaced hues: equal steps put
// near-identical golds and greens next to each other, so neighbours here are
// deliberately far apart in both hue and intensity.
const AV_COLORS: [number, number][] = [
  [354, 62], [22, 72], [45, 78], [96, 42], [152, 44], [174, 52], [190, 64],
  [212, 58], [236, 52], [264, 44], [292, 42], [322, 52], [18, 26], [206, 18],
];

// FNV-1a: short ids like "g1"/"g2" collide into neighbouring buckets with a
// simple *31 hash, which is exactly when colours look repetitive.
function hashOf(s: string): number {
  s = String(s || '?');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Stable per-identity avatar colours, so a person is the same colour for everyone. */
export function avatarStyle(identity: string, theme: Theme): CSSProperties {
  const [h, s] = AV_COLORS[hashOf(identity) % AV_COLORS.length];
  const vars = theme === 'light'
    ? { '--av-bg': `hsl(${h} ${s}% 72%)`, '--av-ink': `hsl(${h} ${Math.min(s + 10, 90)}% 15%)` }
    : { '--av-bg': `hsl(${h} ${s}% 42%)`, '--av-ink': '#fff' };
  return vars as CSSProperties;
}

/** A pasted invite link or a bare meeting code → the room id. */
export function normalizeRoom(v: string): string {
  try { if (v.startsWith('http')) { const u = new URL(v); return u.searchParams.get('room') || v; } } catch { /* not a URL */ }
  return v.trim();
}
