import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../../app/toast';
import { captureGrid, downloadBlob, photoFileName } from '../../lib/groupPhoto';
import { shutter } from '../../lib/sounds';
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

  // Click anywhere else closes the open menu.
  useEffect(() => {
    if (!tileMenu && !leaveOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element;
      if (tileMenu && !tileMenuRef.current?.contains(t) && !t.closest('.tmore')) setTileMenu(null);
      if (leaveOpen && !leaveMenuRef.current?.contains(t) && !t.closest('.dbtn.leave')) setLeaveOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [tileMenu, leaveOpen]);

  const openTileMenu = useCallback((identity: string, name: string, isLocal: boolean, anchor: HTMLElement) => {
    setTileMenu(cur => {
      if (cur?.identity === identity) return null; // same ⋮ again toggles it shut
      // Anchor under the button, then nudge back inside the viewport.
      const r = anchor.getBoundingClientRect();
      return { identity, name, isLocal, top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 232)) };
    });
  }, []);

  const onLeave = () => {
    if (s.role === 'host' && s.livestreamUuid) setLeaveOpen(v => !v);
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

  const copyLink = () => {
    navigator.clipboard?.writeText(s.shareUrl).then(() => toast('Invite link copied')).catch(() => toast(`Code: ${s.roomId}`));
  };

  return (
    <div className="screen active" id="meeting">
      <div className="mt-top">
        <Logo small />
        <div className="title">{s.title || 'Meeting'}</div>
        <span className="mt-live"><span className="d"></span> Live</span>
        <div className="sp"></div>
        <button className="mt-topbtn" onClick={() => void takePhoto()} disabled={snapping} title="Take a group photo" aria-label="Take a group photo">
          <Icon name="photo_camera" />
        </button>
        <ThemeButton />
        <div className="codechip"><Icon name="tag" /><span id="mtCode">{s.roomId || '—'}</span>
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

      <ReactionBar open={reactOpen} />
      <TileMenu ref={tileMenuRef} target={tileMenu} onClose={() => setTileMenu(null)} />
      <LeaveMenu ref={leaveMenuRef} open={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <Dock reactOpen={reactOpen} onToggleReact={() => setReactOpen(v => !v)} onLeave={onLeave} />
    </div>
  );
}
