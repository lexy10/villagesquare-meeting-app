import { useRef } from 'react';
import { useApp } from '../app/AppContext';
import { toast, useToast } from '../app/toast';
import { meeting, useMeeting } from '../meeting/store';
import { Icon } from './Brand';

export function Toast() {
  const t = useToast();
  return <div id="toast" className={t.visible ? 'show' : undefined}>{t.msg}</div>;
}

/** Shown while the browser's autoplay policy is blocking remote audio (audio fix "a"). */
export function AudioGate() {
  const s = useMeeting();
  const show = s.status === 'connected' && !s.canPlaybackAudio;
  return (
    <button id="audioGate" className={show ? 'audio-gate show' : 'audio-gate'} onClick={() => void meeting.enableAudio()}>
      <Icon name="volume_up" /> Tap to enable sound
    </button>
  );
}

export function ShareModal() {
  const { shareOpen, setShareOpen } = useApp();
  const s = useMeeting();
  const linkRef = useRef<HTMLInputElement>(null);
  const copy = () => {
    linkRef.current?.select();
    navigator.clipboard?.writeText(s.shareUrl).then(() => toast('Link copied — share it!')).catch(() => {});
  };
  return (
    <div className={shareOpen ? 'modalback open' : 'modalback'} id="shareModal">
      <div className="sharecard">
        <div className="ok"><Icon name="check" /></div>
        <h2>Your meeting is live</h2>
        <p>Share this link — anyone who opens it just types their name to join.</p>
        <div className="linkbox"><input ref={linkRef} readOnly value={s.shareUrl} /><button onClick={copy}>Copy link</button></div>
        <div className="codebig">Meeting code · <b>{s.roomId || '—'}</b></div>
        <button className="btn-primary enter" onClick={() => setShareOpen(false)}><Icon name="meeting_room" /> Enter meeting</button>
      </div>
    </div>
  );
}
