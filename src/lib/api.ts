import { API_BASE } from '../config';

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Bearer token; omit for public endpoints. */
  token?: string;
  multipart?: boolean;
}

/** An API error with its HTTP status (401 = the host's sign-in is no good). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Calls the VillageSquare API and unwraps the `{ data }` envelope. */
export async function apiFetch<T = any>(path: string, { method = 'GET', body, token, multipart = false }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload: BodyInit | undefined;
  if (multipart) payload = body as FormData;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const resp = await fetch(API_BASE + path, { method, headers, body: payload });
  let json: any = {};
  try { json = await resp.json(); } catch { /* empty or non-JSON body */ }
  if (!resp.ok) throw new ApiError(json.message || `${resp.status} ${resp.statusText}`, resp.status);
  return (json.data !== undefined ? json.data : json) as T;
}

// ---------- host session ----------
// The host's tokens live in memory only. Access tokens last an hour, so host
// calls refresh a minute before expiry, and once more if the API still says 401.

const SIGN_IN_AGAIN = 'Your sign-in has expired. Please sign in again.';
let session = { access: '', refresh: '' };
let refreshing: Promise<string> | null = null;
let onSignedOut: () => void = () => {};

export function setHostSession(access: string, refresh: string) {
  session = { access, refresh };
}

export function hasHostSession(): boolean {
  return !!session.access;
}

/** Called when the session can no longer be refreshed. */
export function onHostSignedOut(fn: () => void) {
  onSignedOut = fn;
}

function clearHostSession() {
  session = { access: '', refresh: '' };
  onSignedOut();
}

function expiresAtMs(jwt: string): number {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).exp * 1000 || 0;
  } catch {
    return 0; // unreadable: rely on the 401 retry instead
  }
}

async function doRefresh(): Promise<string> {
  if (!session.refresh) throw new ApiError(SIGN_IN_AGAIN, 401);
  try {
    const d = await apiFetch<{ access_token?: string; refresh_token?: string }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refresh },
    });
    if (!d.access_token) throw new Error('No access token in refresh response');
    session = { access: d.access_token, refresh: d.refresh_token || session.refresh };
    return session.access;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      clearHostSession();
      throw new ApiError(SIGN_IN_AGAIN, 401);
    }
    throw e; // network trouble: keep the session and let the caller retry
  }
}

/** One refresh at a time; concurrent host calls share it. */
function refreshHostSession(): Promise<string> {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function hostToken(): Promise<string> {
  if (!session.access) throw new ApiError('Sign in to continue.', 401);
  const exp = expiresAtMs(session.access);
  return !exp || exp - Date.now() > 60_000 ? session.access : refreshHostSession();
}

/** apiFetch as the signed-in host. */
async function hostFetch<T = any>(path: string, opts: Omit<ApiOptions, 'token'> = {}): Promise<T> {
  const token = await hostToken();
  try {
    return await apiFetch<T>(path, { ...opts, token });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    return apiFetch<T>(path, { ...opts, token: await refreshHostSession() });
  }
}

const enc = encodeURIComponent;

export interface MeetingStatus { live?: boolean; code?: string | null; title?: string | null }
export interface MeetingSettingsWire { latecomer_check_in: boolean; starts_at: string | null; grace_min: number; time_zone?: string }
/** Everything needed to enter a meeting (host or guest). */
export interface MeetingSession {
  uuid: string;
  code: string;
  title: string;
  role: 'host' | 'guest';
  identity: string;
  name: string;
  token: string;
  livekit_url: string;
  /** Host only. */
  settings?: MeetingSettingsWire;
  assistant_available?: boolean;
}
export interface Hosting { can_host: boolean; assistant_available: boolean; default_grace_min: number }

export const api = {
  login: (emailOrUsername: string, password: string) =>
    apiFetch<{ access_token?: string; accessToken?: string; token?: string; refresh_token?: string }>('/auth/login', {
      method: 'POST',
      body: {
        email_or_username: emailOrUsername, password, login_type: 'password',
        audience: 'web', device: 'browser', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }),
  // Meetings. A guest holds a share code (or the old "vs-meeting" link); the
  // host's actions use the meeting's uuid.
  meetingStatus: (code: string) =>
    apiFetch<MeetingStatus>(`/meetings/${enc(code)}/status`),
  hosting: () =>
    hostFetch<Hosting>('/meetings/hosting'),
  start: (body: { title: string } & Partial<MeetingSettingsWire>) =>
    hostFetch<MeetingSession>('/meetings', { method: 'POST', body }),
  hostJoin: (uuid: string) =>
    hostFetch<MeetingSession>(`/meetings/${enc(uuid)}/join`, { method: 'POST' }),
  guestJoin: (code: string, name: string) =>
    apiFetch<MeetingSession>(`/meetings/${enc(code)}/guest-token`, { method: 'POST', body: { name } }),
  moderate: (uuid: string, identity: string, action: string) =>
    hostFetch(`/meetings/${enc(uuid)}/moderate`, { method: 'POST', body: { identity, action } }),
  updateSettings: (uuid: string, body: Partial<MeetingSettingsWire>) =>
    hostFetch<MeetingSettingsWire>(`/meetings/${enc(uuid)}/settings`, { method: 'PATCH', body }),
  end: (uuid: string) =>
    hostFetch(`/meetings/${enc(uuid)}/end`, { method: 'POST' }),
};
