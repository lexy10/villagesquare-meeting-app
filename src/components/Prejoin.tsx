import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { toast } from '../app/toast';
import { usePreview } from '../hooks/usePreview';
import { api } from '../lib/api';
import { loadGuestName, saveGuestName } from '../lib/storage';
import { meeting } from '../meeting/store';
import { Icon, Logo, Wordmark } from './Brand';
import PreviewPane from './PreviewPane';

export default function Prejoin() {
  const app = useApp();
  const pv = usePreview();
  const [name, setName] = useState(loadGuestName);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const join = async () => {
    if (!trimmed || busy) return;
    saveGuestName(trimmed);
    setBusy(true);
    let seed: MediaStream | null = null;
    try {
      const d = await api.guestToken(app.pendingRoom, trimmed);
      if (!d.token || !d.livekit_url || !d.room_id) throw new Error('No media token returned');
      const micOn = pv.micOn, camOn = pv.camOn;
      // Hand the already-permitted preview tracks to LiveKit rather than stopping
      // them — re-acquiring the mic is what breaks on iOS.
      seed = pv.takeStream();
      await meeting.connect({ token: d.token, livekitUrl: d.livekit_url, title: 'Meeting', seed, role: 'guest', roomId: d.room_id, micOn, camOn });
      seed = null; // ownership transferred to LiveKit
      app.show('meeting');
    } catch (e) {
      seed?.getTracks().forEach(t => t.stop());
      setBusy(false);
      const msg = (e as Error).message || '';
      if (/not live|not found|room/i.test(msg)) { pv.stop(); app.show('notlive'); }
      else toast(`Could not join: ${msg}`, 4500);
    }
  };

  return (
    <div className="screen active" id="prejoin">
      <div className="pj-top">
        <button className="iconbtn" onClick={() => app.show('landing')}><Icon name="arrow_back" /></button>
        <Logo small />
        <Wordmark small />
      </div>
      <div className="pj-body">
        <PreviewPane pv={pv} name={trimmed || 'You'} tag={trimmed || 'You'} />
        <div className="pj-right">
          <div className="eyebrow">You're invited</div>
          <h2>{app.pendingTitle ? `Join “${app.pendingTitle}”` : 'Join the meeting'}</h2>
          <div className="rmeta">Room <b>{app.pendingRoom || '—'}</b></div>
          <input className="name" placeholder="What's your name?" value={name}
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void join(); }} />
          <button className="btn-primary" onClick={() => void join()} disabled={!trimmed || busy}>
            {busy ? <><Icon name="progress_activity" /> Joining…</> : <><Icon name="login" /> Join now</>}
          </button>
          <div className="pj-hint">Your camera and mic stay off until you’re in — you’re in control.</div>
        </div>
      </div>
    </div>
  );
}
