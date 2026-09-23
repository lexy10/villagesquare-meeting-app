// localStorage can throw (private mode, blocked site data), so every access is
// guarded and degrades to "nothing stored".
function read(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }
function remove(key: string) { try { localStorage.removeItem(key); } catch { /* ignore */ } }

export type Theme = 'light' | 'dark';
const THEME_KEY = 'vsm_theme';
export const loadTheme = (): Theme | null => { const t = read(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; };
export const saveTheme = (t: Theme) => write(THEME_KEY, t);

const NAME_KEY = 'vsm_name';
export const loadGuestName = () => read(NAME_KEY) || '';
export const saveGuestName = (n: string) => write(NAME_KEY, n);

// A meeting this browser started and left without ending. Leaving only
// disconnects this client — the room stays live until the host ends it — so
// remember it and offer a host-powered rejoin. Only identifiers are stored;
// the bearer token never touches disk.
export interface HostMeeting { uuid: string; roomId: string; title?: string }
const HOST_MEETING_KEY = 'vsm_host_meeting';
export const rememberHostMeeting = (m: HostMeeting) => write(HOST_MEETING_KEY, JSON.stringify(m));
export const forgetHostMeeting = () => remove(HOST_MEETING_KEY);
export function recallHostMeeting(): HostMeeting | null {
  try { return JSON.parse(read(HOST_MEETING_KEY) || 'null'); } catch { return null; }
}
