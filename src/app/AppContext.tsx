import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { forgetHostMeeting, loadTheme, recallHostMeeting, saveTheme, type Theme } from '../lib/storage';
import { meeting } from '../meeting/store';
import { toast } from './toast';

export type ScreenId = 'landing' | 'hostSignin' | 'hostSetup' | 'prejoin' | 'notlive' | 'meeting';

interface AppValue {
  screen: ScreenId;
  show: (s: ScreenId) => void;
  theme: Theme;
  toggleTheme: () => void;
  /** Host bearer token ('' = not signed in). Only ever held in memory. */
  token: string;
  email: string;
  /** Display name for the host: the local part of their sign-in email. */
  hostName: string;
  setAuth: (token: string, email: string) => void;
  /** Room a guest is about to join (from a code, a link, or meeting-status). */
  pendingRoom: string;
  pendingTitle: string;
  /** Gate on live status before asking for a name: not live → branded notice. */
  checkAndProceed: (room: string) => Promise<void>;
  pendingRejoin: boolean;
  setPendingRejoin: (v: boolean) => void;
  rejoinAsHost: (tokenOverride?: string) => Promise<void>;
  shareOpen: boolean;
  setShareOpen: (v: boolean) => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

function initialTheme(): Theme {
  return loadTheme() || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<ScreenId>('landing');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [auth, setAuthState] = useState({ token: '', email: '' });
  // Actions that run right after sign-in must see the new token before React
  // re-renders, so it is mirrored into a ref.
  const tokenRef = useRef('');
  const [pendingRoom, setPendingRoom] = useState('');
  const [pendingTitle, setPendingTitle] = useState('');
  const [pendingRejoin, setPendingRejoin] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const show = useCallback((s: ScreenId) => setScreen(s), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f1f3f4' : '#202124');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => { const next = t === 'light' ? 'dark' : 'light'; saveTheme(next); return next; });
  }, []);

  const setAuth = useCallback((token: string, email: string) => {
    tokenRef.current = token;
    setAuthState({ token, email });
  }, []);

  const checkAndProceed = useCallback(async (raw: string) => {
    const room = (raw || '').trim();
    if (!room) return;
    setPendingRoom(room);
    setPendingTitle('');
    try {
      const d = await api.meetingStatus(room);
      // Fail open: only block on a DEFINITIVE not-live. guest-token is the source
      // of truth and reports "not live" itself if the room really isn't.
      if (d && d.live === false) { setScreen('notlive'); return; }
      if (d?.room_id) setPendingRoom(d.room_id);
      if (d?.title) setPendingTitle(d.title);
      setScreen('prejoin');
    } catch (e) {
      console.warn('meeting-status check unavailable, proceeding to join:', (e as Error).message);
      setScreen('prejoin');
    }
  }, []);

  const hostName = auth.email.split('@')[0] || 'Host';

  const rejoinAsHost = useCallback(async (tokenOverride?: string) => {
    const m = recallHostMeeting();
    if (!m?.uuid) return;
    const token = tokenOverride || tokenRef.current;
    // Rejoining as host is authenticated — route through sign-in and come back.
    if (!token) {
      setPendingRejoin(true);
      setScreen('hostSignin');
      toast('Sign in to rejoin as host');
      return;
    }
    let seed: MediaStream | null = null;
    let micOn = true, camOn = true;
    try {
      try { seed = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
      catch { micOn = false; camOn = false; }
      const d = await api.hostJoin(m.uuid, token);
      if (!d.token || !d.livekit_url) throw new Error('No media token returned');
      await meeting.connect({
        token: d.token, livekitUrl: d.livekit_url, title: m.title || 'Meeting', seed, role: 'host',
        roomId: d.room_id || m.roomId, livestreamUuid: m.uuid, micOn, camOn, authToken: token,
      });
      seed = null; // ownership transferred to LiveKit
      setScreen('meeting');
    } catch (e) {
      seed?.getTracks().forEach(t => t.stop());
      const msg = (e as Error).message || '';
      // A meeting that has since ended shouldn't keep offering a dead button.
      if (/not live|not found|ended|denied/i.test(msg)) forgetHostMeeting();
      toast(`Could not rejoin: ${msg}`, 4500);
    }
  }, []);

  // When the meeting ends (left, ended, removed, dropped) go home.
  useEffect(() => {
    meeting.setHandlers({
      onEnded: () => {
        setShareOpen(false);
        setScreen('landing');
        toast('You left the meeting');
      },
    });
  }, []);

  // Deep link: ?room=<code> goes straight to the live check.
  useEffect(() => {
    const r = new URLSearchParams(location.search).get('room');
    if (r) void checkAndProceed(r);
  }, [checkAndProceed]);

  useEffect(() => {
    const onUnload = () => { meeting.leave(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const value = useMemo<AppValue>(() => ({
    screen, show, theme, toggleTheme, token: auth.token, email: auth.email, hostName, setAuth,
    pendingRoom, pendingTitle, checkAndProceed, pendingRejoin, setPendingRejoin, rejoinAsHost,
    shareOpen, setShareOpen,
  }), [screen, show, theme, toggleTheme, auth, hostName, setAuth, pendingRoom, pendingTitle, checkAndProceed,
    pendingRejoin, rejoinAsHost, shareOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
