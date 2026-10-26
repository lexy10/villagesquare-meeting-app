import { useCallback, useRef, useState } from 'react';
import { toast } from '../../app/toast';
import { useDismiss } from '../../hooks/useDismiss';
import { captureGrid, downloadBlob, photoFileName } from '../../lib/groupPhoto';
import { shutter } from '../../lib/sounds';
import { clockLabel, defaultPmSettings, lateCutoff } from '../../meeting/pm';
import { meeting, useMeeting } from '../../meeting/store';
import { Icon, Logo, ThemeButton } from '../Brand';
import Confetti from './Confetti';
import Dock from './Dock';
import { FloatingReactions, LeaveMenu, ReactionBar, TileMenu, type TileMenuTarget } from './Menus';
import SidePanel from './SidePanel';
import VideoGrid from './VideoGrid';

export default function Meeting() {
  const s = useMeeting();
  const [reactOpen, setReactOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [tileMenu, setTileMenu] = useState<TileMenuTarget | null>(null);
  const [flash, setFlash] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const tileMenuRef = useRef<HTMLDivElement>(null);
  const leaveMenuRef = useRef<HTMLDivElement>(null);
  const reactBarRef = useRef<HTMLDivElement>(null);
  const reactBtnRef = useRef<HTMLButtonElement>(null);
  const leaveBtnRef = useRef<HTMLButtonElement>(null);

  useDismiss(reactOpen, () => setReactOpen(false), () => [reactBarRef.current, reactBtnRef.current]);
  useDismiss(leaveOpen, () => setLeaveOpen(false), () => [leaveMenuRef.current, leaveBtnRef.current]);
  useDismiss(!!tileMenu, () => setTileMenu(null), () => [tileMenuRef.current, tileMenu?.anchor]);

  const openTileMenu = useCallback((identity: string, name: string, isLocal: boolean, anchor: HTMLElement) => {
    setTileMenu(cur => {
      if (cur?.identity === identity) return null; // same ⋮ again toggles it shut
      // Anchor under the button, then nudge back inside the viewport.
      const r = anchor.getBoundingClientRect();
      return { identity, name, isLocal, anchor, top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 232)) };
    });
  }, []);

  const onLeave = () => {
    if (s.role === 'host' && s.meetingId) setLeaveOpen(v => !v);
    else meeting.leave();
  };

  const takePhoto = async () => {
    const grid = document.querySelector<HTMLElement>('#meeting .mt-grid');
    if (!grid || snapping) return;
    setSnapping(true);
    try {
      const blob = await captureGrid(grid, s.title);
      shutter();
      setFlash(n => n + 1);
      downloadBlob(blob, photoFileName());
      meeting.announcePhoto();
      toast('Group photo saved 📸');
    } catch (e) {
      console.warn('group photo failed', e);
      toast(`Could not take the photo: ${(e as Error).message}`, 4000);
    } finally {
      setSnapping(false);
    }
  };

  const togglePm = async () => {
    const cur = s.pmSettings || defaultPmSettings();
    const next = { ...cur, enabled: !s.pmSettings?.enabled };
    if (await meeting.setPm(next)) {
      toast(next.enabled ? `Latecomer check-in on: anyone joining after ${clockLabel(lateCutoff(next))} is asked why` : 'Latecomer check-in off');
    }
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(s.shareUrl).then(() => toast('Invite link copied')).catch(() => toast(`Code: ${s.code}`));
  };

  return (
    <div className="screen active" id="meeting">
      <div className="mt-top">
        <Logo small />
        <div className="title">{s.title || 'Meeting'}</div>
        <span className="mt-live"><span className="d"></span> Live</span>
        <div className="sp"></div>
        {s.role === 'host' && s.pmAvailable && (
          <button className={s.pmSettings?.enabled ? 'pm-chip on' : 'pm-chip'} onClick={() => void togglePm()}
            title={s.pmSettings?.enabled ? 'Latecomer check-in is on. Click to turn it off.' : 'Turn on latecomer check-in'}>
            <Icon name="smart_toy" />
            <span>{s.pmSettings?.enabled ? `Late after ${clockLabel(lateCutoff(s.pmSettings))}` : 'PM off'}</span>
          </button>
        )}
        <button className="mt-topbtn" onClick={() => void takePhoto()} disabled={snapping} title="Take a group photo" aria-label="Take a group photo">
          <Icon name="photo_camera" />
        </button>
        <ThemeButton />
        <div className="codechip"><Icon name="tag" /><span id="mtCode">{s.code || '—'}</span>
          <button onClick={copyLink} title="Copy invite link"><Icon name="content_copy" /></button>
        </div>
      </div>

      <div className="mt-stage">
        <VideoGrid onMore={openTileMenu} />
        <SidePanel />
        <FloatingReactions />
        {flash > 0 && <div className="photo-flash" key={flash}></div>}
      </div>

      <Confetti />

      <ReactionBar ref={reactBarRef} open={reactOpen} />
      <TileMenu ref={tileMenuRef} target={tileMenu} onClose={() => setTileMenu(null)} />
      <LeaveMenu ref={leaveMenuRef} open={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <Dock reactOpen={reactOpen} onToggleReact={() => setReactOpen(v => !v)} onLeave={onLeave} reactBtnRef={reactBtnRef} leaveBtnRef={leaveBtnRef} />
    </div>
  );
}
