import { forwardRef } from 'react';
import { Track } from 'livekit-client';
import { meeting, STATUSES, useMeeting, type StatusId } from '../../meeting/store';
import { Icon } from '../Brand';

export interface TileMenuTarget { identity: string; name: string; isLocal: boolean; top: number; left: number }

interface TileMenuProps { target: TileMenuTarget | null; onClose: () => void }

// Host moderation for one participant, anchored under their tile's ⋮ button.
export const TileMenu = forwardRef<HTMLDivElement, TileMenuProps>(function TileMenu({ target, onClose }, ref) {
  const s = useMeeting();
  const p = target ? s.participants.find(x => x.identity === target.identity) : undefined;
  if (!target || !p) return <div id="tileMenu" ref={ref}></div>;

  const mic = p.getTrackPublication(Track.Source.Microphone);
  const cam = p.getTrackPublication(Track.Source.Camera);
  const micMuted = !mic?.track || mic.isMuted;
  const camOff = !cam?.track || cam.isMuted;
  const isPinned = s.pinned === target.identity;
  const act = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div id="tileMenu" className="open" ref={ref} style={{ top: target.top, left: target.left }}>
      <div className="tm-head">{target.name}</div>
      <button onClick={act(() => meeting.setPin(target.identity))}><Icon name="push_pin" />{isPinned ? 'Unpin' : 'Pin for everyone'}</button>
      {/* Mute and stop-video are one-way: only the person themselves can reopen
          their mic/camera (the browser needs their gesture), so once done the row
          is disabled rather than offering an "unmute" that cannot work. You can't
          mute or remove yourself here — that's what your own dock is for. */}
      {!target.isLocal && (
        <>
          <button disabled={micMuted} onClick={act(() => void meeting.moderate(target.identity, 'mute', `Muted ${target.name}`))}>
            <Icon name="mic_off" />{micMuted ? 'Already muted' : 'Mute'}
          </button>
          <button disabled={camOff} onClick={act(() => void meeting.moderate(target.identity, 'stop_video', `Stopped video for ${target.name}`))}>
            <Icon name="videocam_off" />{camOff ? 'Video already off' : 'Pause video'}
          </button>
          <button className="danger" onClick={act(() => void meeting.moderate(target.identity, 'remove', `Removed ${target.name}`))}>
            <Icon name="person_remove" />Remove from meeting
          </button>
        </>
      )}
    </div>
  );
});

interface LeaveMenuProps { open: boolean; onClose: () => void }

// Host gets a choice (leave vs end for everyone); guests just leave.
export const LeaveMenu = forwardRef<HTMLDivElement, LeaveMenuProps>(function LeaveMenu({ open, onClose }, ref) {
  return (
    <div id="leaveMenu" className={open ? 'open' : undefined} ref={ref}>
      <button onClick={() => { onClose(); meeting.leave(); }}>
        <Icon name="logout" /><div className="lm-txt"><b>Leave meeting</b><span>Others stay in the room</span></div>
      </button>
      <button className="danger" onClick={() => { onClose(); void meeting.end(); }}>
        <Icon name="call_end" /><div className="lm-txt"><b>End for everyone</b><span>Takes the room offline for all</span></div>
      </button>
    </div>
  );
});

const EMOJIS = ['👍', '❤️', '🎉', '👏', '😂', '😮', '🔥', '🙌'];

export function ReactionBar({ open }: { open: boolean }) {
  const s = useMeeting();
  const mine = s.room ? s.statuses.get(s.room.localParticipant.identity) : undefined;
  return (
    <div id="reactBar" className={open ? 'open' : undefined}>
      {EMOJIS.map(e => <button key={e} onClick={() => meeting.react(e)}>{e}</button>)}
      <div className="rb-status">
        {(Object.keys(STATUSES) as StatusId[]).map(id => (
          <button key={id} className={mine === id ? 'on' : undefined} onClick={() => meeting.setStatus(mine === id ? '' : id)}>
            {STATUSES[id].emoji} {STATUSES[id].label}
          </button>
        ))}
        {mine && <button className="clear" onClick={() => meeting.setStatus('')}>Clear</button>}
      </div>
    </div>
  );
}

export function FloatingReactions() {
  const s = useMeeting();
  return (
    <>
      {s.reactions.map(r => (
        <div className="floatemoji" key={r.id} style={{ left: `${r.left}%` }}>
          <span className="fe-emoji">{r.emoji}</span>
          {r.name && <span className="fe-name">{r.name}</span>}
        </div>
      ))}
    </>
  );
}
