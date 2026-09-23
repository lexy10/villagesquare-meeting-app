import { API_BASE } from '../config';

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Bearer token; omit for public endpoints. */
  token?: string;
  multipart?: boolean;
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
  if (!resp.ok) throw new Error(json.message || `${resp.status} ${resp.statusText}`);
  return (json.data !== undefined ? json.data : json) as T;
}

const enc = encodeURIComponent;

export interface MeetingStatus { live?: boolean; room_id?: string; title?: string }
export interface MediaGrant { token?: string; livekit_url?: string; room_id?: string; uuid?: string }

export const api = {
  login: (emailOrUsername: string, password: string) =>
    apiFetch<{ access_token?: string; accessToken?: string; token?: string }>('/auth/login', {
      method: 'POST',
      body: {
        email_or_username: emailOrUsername, password, login_type: 'password',
        audience: 'web', device: 'browser', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }),
  meetingStatus: (room: string) =>
    apiFetch<MeetingStatus>(`/livestreams/${enc(room)}/meeting-status`, { method: 'POST' }),
  start: (form: FormData, token: string) =>
    apiFetch<MediaGrant>('/livestreams/start', { method: 'POST', multipart: true, body: form, token }),
  hostJoin: (uuid: string, token: string) =>
    apiFetch<MediaGrant>(`/livestreams/${enc(uuid)}/join`, { method: 'POST', token }),
  guestToken: (room: string, name: string) =>
    apiFetch<MediaGrant>(`/livestreams/${enc(room)}/guest-token`, { method: 'POST', body: { name } }),
  moderate: (roomId: string, identity: string, action: string, token: string) =>
    apiFetch(`/livestreams/${enc(roomId)}/moderate`, { method: 'POST', body: { identity, action }, token }),
  end: (uuid: string, token: string) =>
    apiFetch(`/livestreams/${enc(uuid)}/end-livestream`, { token }),
};
