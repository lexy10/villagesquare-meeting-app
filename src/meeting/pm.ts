// The meeting PM: latecomer check-in, run by a "PM" participant the media
// server puts in the room.
//
// Someone joining after the start time + grace is checked in: at the next pause
// the PM cuts in (everyone else's open mic is paused), asks why they were late,
// listens until they stop talking, replies briefly, and hands back to whoever
// spoke last. Every app here only shows the PM's tile and follows its messages.

export interface PmSettings {
  enabled: boolean;
  /** Epoch ms of the meeting's start time. */
  startAt: number;
  graceMin: number;
}

export type PmPhase = 'asking' | 'listening' | 'thinking' | 'replying' | 'done';

/** What every client knows about the current check-in. */
export interface PmView {
  phase: PmPhase;
  /** The latecomer. */
  who: string;
  name: string;
  caption: string;
}

/** The PM's LiveKit identity (set by the media server). */
export const PM_IDENTITY = '__vs_meeting_pm__';

export type PmMsg =
  | { t: 'pm'; op: 'start'; who: string; name: string }
  | { t: 'pm'; op: 'phase'; phase: PmPhase; caption?: string }
  | { t: 'pm'; op: 'end'; speaker?: string }
  // Host → PM: check-in settings changed, read them again.
  | { t: 'pm'; op: 'settings' };

/** On, starting at the current time rounded down to five minutes, 5 minutes' grace. */
export function defaultPmSettings(now = Date.now()): PmSettings {
  const d = new Date(now);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5), 0, 0);
  return { enabled: true, startAt: d.getTime(), graceMin: 5 };
}

/** The meeting's settings as the API holds them ↔ the PM's own shape. */
export function pmFromWire(w: { latecomer_check_in: boolean; starts_at: string | null; grace_min: number }, fallbackStart = Date.now()): PmSettings {
  return { enabled: w.latecomer_check_in, startAt: w.starts_at ? Date.parse(w.starts_at) : fallbackStart, graceMin: w.grace_min };
}
export function pmToWire(s: PmSettings) {
  return {
    latecomer_check_in: s.enabled, starts_at: new Date(s.startAt).toISOString(), grace_min: s.graceMin,
    // The PM on the server tells the time as the host's clock would.
    time_zone: localTimeZone(),
  };
}

function localTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

export function lateCutoff(s: PmSettings): number {
  return s.startAt + s.graceMin * 60_000;
}

/** "9:41" (or "9:41 AM" where the host's locale uses a 12-hour clock). */
export function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
