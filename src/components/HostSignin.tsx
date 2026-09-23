import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { api } from '../lib/api';
import { Icon, Logo, Wordmark } from './Brand';

export default function HostSignin() {
  const app = useApp();
  const [email, setEmail] = useState(app.email);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => emailRef.current?.focus(), 50); return () => clearTimeout(t); }, []);

  const signIn = async () => {
    const e = email.trim();
    if (!e || !password) { setErr('Enter your email and password.'); return; }
    if (busy) return;
    setErr('');
    setBusy(true);
    try {
      const d = await api.login(e, password);
      const token = d.access_token || d.accessToken || d.token || '';
      if (!token) throw new Error('No access token in response');
      app.setAuth(token, e);
      if (app.pendingRejoin) {
        app.setPendingRejoin(false);
        app.show('landing');
        await app.rejoinAsHost(token);
        return;
      }
      app.show('hostSetup');
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="screen cardscreen active" id="hostSignin">
      <div className="card">
        <div className="brandrow"><Logo small /><Wordmark small /></div>
        <h2>Sign in to host</h2>
        <p className="csub">Only the host signs in. Everyone you invite joins with just their name.</p>
        <div className="field"><label>Email or username</label>
          <input ref={emailRef} placeholder="you@villagesquare.io" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field"><label>Password</label>
          <input type="password" placeholder="••••••••" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void signIn(); }} />
        </div>
        <div className={err ? 'err show' : 'err'}>{err}</div>
        <button className="btn-primary" onClick={() => void signIn()} disabled={busy}>
          {busy ? <><Icon name="progress_activity" /> Signing in…</> : <><Icon name="login" /> Sign in</>}
        </button>
        <div className="back"><button onClick={() => app.show('landing')}>← Back</button></div>
      </div>
    </div>
  );
}
