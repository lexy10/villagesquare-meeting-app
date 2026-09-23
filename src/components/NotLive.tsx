import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { Icon, Logo, Wordmark } from './Brand';

export default function NotLive() {
  const app = useApp();
  const [checking, setChecking] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    try { await app.checkAndProceed(app.pendingRoom); } finally { setChecking(false); }
  };
  return (
    <div className="screen cardscreen active" id="notlive">
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="brandrow" style={{ justifyContent: 'center' }}><Logo small /><Wordmark small /></div>
        <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#eef3fb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px auto 18px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '38px', color: '#9fb0c7' }}>bedtime</span>
        </div>
        <h2>This room isn’t live</h2>
        <p className="csub" style={{ maxWidth: '320px', margin: '8px auto 0' }}>Nobody has this meeting running right now. Once the host starts it, this same link will let you straight in.</p>
        <div className="rmeta" style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '16px', fontFamily: "'Inter'" }}>Room <b style={{ color: 'var(--ink)' }}>{app.pendingRoom || '—'}</b></div>
        <button className="btn-primary" onClick={() => void checkAgain()} disabled={checking} style={{ width: '100%', marginTop: '24px' }}>
          {checking ? <><Icon name="progress_activity" /> Checking…</> : <><Icon name="refresh" /> Check again</>}
        </button>
        <div className="back"><button onClick={() => app.show('landing')}>← Back to home</button></div>
      </div>
    </div>
  );
}
