import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/AppContext';
import { useClock } from '../hooks/useClock';
import { api } from '../lib/api';
import { initials, normalizeRoom } from '../lib/format';
import { proverbOfTheDay } from '../lib/proverbs';
import { forgetHostMeeting, recallHostMeeting } from '../lib/storage';
import { Icon, Logo, ThemeButton, Wordmark } from './Brand';

/** A meeting this browser started and never ended — offered back if it's still live. */
function useRejoinCard() {
  const [label, setLabel] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const m = recallHostMeeting();
    if (!m?.uuid || !m.roomId) { setLabel(null); return; }
    try {
      const d = await api.meetingStatus(m.roomId);
      if (d && d.live === false) { forgetHostMeeting(); setLabel(null); return; }
    } catch { /* status unavailable — still offer it; the rejoin call decides */ }
    setLabel(m.title ? `${m.title} · ${m.roomId}` : m.roomId);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { label, refresh };
}

export default function Landing() {
  const app = useApp();
  const clock = useClock();
  const rejoin = useRejoinCard();
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const proverb = proverbOfTheDay();

  const join = async () => {
    const v = code.trim();
    if (!v || checking) return;
    setChecking(true);
    try { await app.checkAndProceed(normalizeRoom(v)); } finally { setChecking(false); }
  };

  const startMeeting = () => app.show(app.token ? 'hostSetup' : 'hostSignin');

  const doRejoin = async () => {
    setRejoining(true);
    try { await app.rejoinAsHost(); } finally { setRejoining(false); void rejoin.refresh(); }
  };

  return (
    <div className="screen active" id="landing">
      <div className="lp-top">
        <Logo />
        <Wordmark />
        <div className="sp"></div>
        <span className="clock">{clock}</span>
        <ThemeButton />
        <div className="lp-avatar">{app.email ? initials(app.email) : 'VS'}</div>
      </div>

      <div className="lp-body">
        <div className="lp-left">
          <div className="lp-badge"><span className="dot"></span> Live meetings on VillageSquare</div>
          <h1>Gather your <em>village</em>, wherever you are</h1>
          <p className="sub">Start a room, share one link, and everyone hops in with just their name. Real-time video, chat and reactions — powered by VillageSquare.</p>
          <div className="lp-actions">
            {rejoin.label !== null && (
              <div className="rejoin">
                <Icon name="sensors" className="rj-ico" />
                <div className="rj-txt"><b>Your meeting is still running</b><span>{rejoin.label}</span></div>
                <button className="rj-btn" onClick={() => void doRejoin()} disabled={rejoining}>{rejoining ? 'Rejoining…' : 'Rejoin'}</button>
              </div>
            )}
            <div className="act-row">
              <button className="btn-primary" onClick={startMeeting}><Icon name="video_call" /> Start a meeting</button>
            </div>
            <div className="act-row">
              <div className="join-field">
                <Icon name="keyboard" />
                <input placeholder="Enter a meeting code" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void join(); }} />
              </div>
              <button className="btn-ghost" onClick={() => void join()} disabled={!code.trim() || checking}>{checking ? 'Checking…' : 'Join'}</button>
            </div>
            <p className="lp-note">Got a link from a host? Open it and just type your name.</p>
          </div>
          <figure className="lp-proverb">
            <Icon name="format_quote" className="pv-mark" />
            <div>
              {proverb.native && <div className="pv-native">{proverb.native}</div>}
              <blockquote>{proverb.text}</blockquote>
              <figcaption>{proverb.origin} · proverb of the day</figcaption>
            </div>
          </figure>
        </div>
        <div className="lp-right">
          <svg className="hero" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1560d8" /><stop offset="1" stopColor="#00d4ff" />
              </linearGradient>
              <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2b7cf0" /><stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <circle cx="210" cy="210" r="180" className="hero-bg" />
            <circle cx="210" cy="210" r="180" fill="none" stroke="url(#g1)" strokeWidth="2" strokeDasharray="4 10" opacity=".5" />
            <rect x="96" y="120" width="228" height="150" rx="20" fill="url(#g1)" />
            <rect x="112" y="136" width="196" height="118" rx="12" fill="#0a1424" />
            <rect x="122" y="146" width="88" height="46" rx="8" fill="url(#g2)" />
            <rect x="218" y="146" width="80" height="46" rx="8" fill="#1560d8" opacity=".85" />
            <rect x="122" y="200" width="80" height="44" rx="8" fill="#22d3ee" opacity=".8" />
            <rect x="210" y="200" width="88" height="44" rx="8" fill="url(#g2)" />
            <circle cx="166" cy="169" r="13" fill="#fff" opacity=".95" />
            <circle cx="258" cy="169" r="13" fill="#fff" opacity=".75" />
            <circle cx="162" cy="222" r="12" fill="#fff" opacity=".8" />
            <circle cx="254" cy="222" r="12" fill="#fff" opacity=".95" />
            <rect x="150" y="292" width="120" height="34" rx="17" fill="#0a1424" />
            <circle cx="176" cy="309" r="9" fill="#22d3ee" />
            <circle cx="210" cy="309" r="9" fill="#eaf1ff" />
            <circle cx="244" cy="309" r="9" fill="#ea4b5a" />
          </svg>
        </div>
      </div>
      <div className="lp-foot">Connected to the VillageSquare live media network</div>
    </div>
  );
}
