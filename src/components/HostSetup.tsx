import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppContext';
import { toast } from '../app/toast';
import { usePreview } from '../hooks/usePreview';
import { api, type Hosting } from '../lib/api';
import { rememberHostMeeting } from '../lib/storage';
import { clockLabel, defaultPmSettings, lateCutoff, pmFromWire, pmToWire, type PmSettings } from '../meeting/pm';
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
  const [pm, setPm] = useState<PmSettings>(() => defaultPmSettings());
  // Whether this account may host, and whether the AI PM is on platform-wide.
  const [hosting, setHosting] = useState<Hosting | null>(null);
  const startHHMM = new Date(pm.startAt).toTimeString().slice(0, 5);
  const setStart = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    setPm(p => ({ ...p, startAt: d.getTime() }));
  };

  useEffect(() => { const t = setTimeout(() => titleRef.current?.select(), 50); return () => clearTimeout(t); }, []);
  useEffect(() => {
    api.hosting()
      .then(h => { setHosting(h); setPm(p => ({ ...p, graceMin: h.default_grace_min })); })
      .catch(e => console.warn('hosting check failed', e));
  }, []);
  const canHost = hosting?.can_host !== false;
  const pmAvailable = !!hosting?.assistant_available;
  const leadAvailable = pmAvailable && !!hosting?.lead_available;

  const start = async () => {
    if (busy || !canHost) return;
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
      const d = await api.start({
        title: t,
        ...pmToWire({ ...pm, enabled: pm.enabled && pmAvailable, lead: pm.lead && leadAvailable }),
      });
      if (!d.token || !d.livekit_url || !d.code) throw new Error('Meeting started but no media token was returned');
      rememberHostMeeting({ uuid: d.uuid, code: d.code, title: d.title });
      await meeting.connect({
        token: d.token, livekitUrl: d.livekit_url, title: d.title, seed, role: 'host', code: d.code, meetingId: d.uuid,
        micOn, camOn, pm: d.settings ? pmFromWire(d.settings) : undefined, pmAvailable: !!d.assistant_available,
        leadAvailable: !!d.lead_available,
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
          {pmAvailable && <div className="pm-setup">
            <label className="pm-switch">
              <input type="checkbox" checked={pm.enabled} onChange={e => setPm(p => ({ ...p, enabled: e.target.checked }))} />
              <span className="sw" aria-hidden="true"></span>
              <span className="pm-st"><b>Latecomer check-in</b><span>The AI PM asks anyone who joins late why, then hands back to the speaker.</span></span>
            </label>
            {pm.enabled && (
              <div className="pm-times">
                <label>Starts at<input type="time" value={startHHMM} onChange={e => setStart(e.target.value)} /></label>
                <label>Grace
                  <select value={pm.graceMin} onChange={e => setPm(p => ({ ...p, graceMin: Number(e.target.value) }))}>
                    {[0, 5, 10, 15].map(g => <option key={g} value={g}>{g} min</option>)}
                  </select>
                </label>
                <span className="pm-cut">Late after <b>{clockLabel(lateCutoff(pm))}</b></span>
              </div>
            )}
            {leadAvailable && <>
              <label className="pm-switch pm-lead">
                <input type="checkbox" checked={pm.lead} onChange={e => setPm(p => ({ ...p, lead: e.target.checked }))} />
                <span className="sw" aria-hidden="true"></span>
                <span className="pm-st"><b>PM leads the meeting</b><span>Runs a round of updates, answers when spoken to, keeps time and writes the notes.</span></span>
              </label>
              {pm.lead && (
                <div className="pm-times">
                  {!pm.enabled && <label>Starts at<input type="time" value={startHHMM} onChange={e => setStart(e.target.value)} /></label>}
                  <label>Per person
                    <select value={pm.minutesPerPerson} onChange={e => setPm(p => ({ ...p, minutesPerPerson: Number(e.target.value) }))}>
                      {[1, 2, 3, 5, 10].map(m => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </label>
                  <textarea className="pm-agenda" rows={2} maxLength={1000} value={pm.agenda}
                    placeholder="Topics to cover (optional), one per line"
                    onChange={e => setPm(p => ({ ...p, agenda: e.target.value }))} />
                </div>
              )}
            </>}
          </div>}
          {!canHost && <div className="err show">Your account can't host meetings yet. Ask an admin to turn hosting on for you.</div>}
          <div className={err ? 'err show' : 'err'}>{err}</div>
          <button className="btn-primary" onClick={() => void start()} disabled={busy || !canHost}>
            {busy ? <><Icon name="progress_activity" /> Starting…</> : <><Icon name="rocket_launch" /> Start meeting</>}
          </button>
          <p className="pj-hint">You’ll join with the camera and mic settings you pick here.</p>
        </div>
      </div>
    </div>
  );
}
