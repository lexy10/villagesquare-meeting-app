import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { toast } from '../app/toast';
import { MEETING_CATEGORY_ID } from '../config';
import { usePreview } from '../hooks/usePreview';
import { api } from '../lib/api';
import { rememberHostMeeting } from '../lib/storage';
import { meeting } from '../meeting/store';
import { Icon, Logo, Wordmark } from './Brand';
import PreviewPane from './PreviewPane';

// Host setup mirrors the guest pre-join: see yourself, set mic/camera, then
// enter with exactly those settings.
export default function HostSetup() {
  const app = useApp();
  const pv = usePreview();
  const [title, setTitle] = useState('VillageSquare Meeting');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => titleRef.current?.select(), 50); return () => clearTimeout(t); }, []);

  const start = async () => {
    if (busy) return;
    const t = title.trim() || 'VillageSquare Meeting';
    setErr('');
    setBusy(true);
    let micOn = pv.micOn, camOn = pv.camOn;
    let seed = pv.takeStream();
    try {
      if (!seed) {
        // No preview stream (denied, or stopped): capture now, still inside the
        // click gesture so iOS will show the prompt.
        try { seed = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
        catch (e) {
          console.warn('host media capture failed', e);
          micOn = false; camOn = false;
          toast('Starting without camera/mic — you can enable them in the meeting.', 4000);
        }
      }
      const form = new FormData();
      form.append('title', t);
      form.append('category_id', MEETING_CATEGORY_ID);
      form.append('privacy', 'everyone');
      const d = await api.start(form, app.token);
      if (d.uuid && d.room_id) rememberHostMeeting({ uuid: d.uuid, roomId: d.room_id, title: t });
      if (!d.token || !d.livekit_url || !d.room_id) throw new Error('Meeting started but no media token was returned');
      await meeting.connect({
        token: d.token, livekitUrl: d.livekit_url, title: t, seed, role: 'host', roomId: d.room_id,
        livestreamUuid: d.uuid, micOn, camOn, authToken: app.token,
      });
      seed = null; // ownership transferred to LiveKit
      app.setShareOpen(true);
      app.show('meeting');
    } catch (e) {
      // Don't leave the camera light on if we never made it into the room.
      seed?.getTracks().forEach(tr => tr.stop());
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="screen active" id="hostSetup">
      <div className="pj-top">
        <button className="iconbtn" onClick={() => app.show('landing')}><Icon name="arrow_back" /></button>
        <Logo small />
        <Wordmark small />
      </div>
      <div className="pj-body">
        <PreviewPane pv={pv} name={app.hostName} tag="You (host)" titles />
        <div className="pj-right">
          <div className="eyebrow">Start a meeting</div>
          <h2>Name your meeting</h2>
          <div className="rmeta">You’ll get a shareable link right after</div>
          <input className="name" ref={titleRef} placeholder="e.g. Village Standup" value={title}
            onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void start(); }} />
          <div className={err ? 'err show' : 'err'}>{err}</div>
          <button className="btn-primary" onClick={() => void start()} disabled={busy}>
            {busy ? <><Icon name="progress_activity" /> Starting…</> : <><Icon name="rocket_launch" /> Start meeting</>}
          </button>
          <p className="pj-hint">You’ll join with the camera and mic settings you pick here.</p>
        </div>
      </div>
    </div>
  );
}
