import type { RefObject } from 'react';
import { canShareScreen } from '../../lib/devices';
import { meeting, useMeeting } from '../../meeting/store';
import { Icon } from '../Brand';

interface Props {
  reactOpen: boolean;
  onToggleReact: () => void;
  onLeave: () => void;
  reactBtnRef: RefObject<HTMLButtonElement>;
  leaveBtnRef: RefObject<HTMLButtonElement>;
}

export default function Dock({ reactOpen, onToggleReact, onLeave, reactBtnRef, leaveBtnRef }: Props) {
  const s = useMeeting();
  const shareOk = canShareScreen();
  const btn = (base: string, flag: boolean, mod: string) => (flag ? `${base} ${mod}` : base);

  const nudge = s.mutedNudge && !s.micOn;
  const me = s.room?.localParticipant.identity || 'me';
  const askedMe = !!s.pm && s.pm.who === me && (s.pm.phase === 'asking' || s.pm.phase === 'listening');
  // Leading: the PM has handed me the floor and my mic is still off.
  const myTurn = !askedMe && s.pmLead && s.pmTurn?.who === me && !s.micOn;

  return (
    <div className="mt-dock">
      {askedMe ? (
        <div className="muted-nudge pm-prompt" role="status">
          <Icon name="smart_toy" /><span>{s.micOn ? 'The PM is asking you. Go ahead.' : 'The PM is asking why you joined late.'}</span>
          {!s.micOn && <button onClick={() => void meeting.toggleMic()}>Unmute to answer</button>}
        </div>
      ) : myTurn ? (
        <div className="muted-nudge pm-prompt" role="status">
          <Icon name="smart_toy" /><span>The PM is asking for your update.</span>
          <button onClick={() => void meeting.toggleMic()}>Unmute to answer</button>
        </div>
      ) : s.pmPausedMe ? (
        <div className="muted-nudge pm-prompt" role="status">
          <Icon name="pause_circle" /><span>Paused while {s.pm?.name || 'a latecomer'} checks in</span>
        </div>
      ) : nudge && (
        <div className="muted-nudge" role="status">
          <Icon name="mic_off" /><span>You’re muted</span>
          <button onClick={() => { meeting.dismissNudge(); void meeting.toggleMic(); }}>Unmute</button>
          <button className="mn-x" onClick={meeting.dismissNudge} aria-label="Dismiss"><Icon name="close" /></button>
        </div>
      )}
      <button className={btn(nudge ? 'dbtn nudge' : 'dbtn', !s.micOn, 'off')} onClick={() => void meeting.toggleMic()} title="Microphone">
        <Icon name={s.micOn ? 'mic' : 'mic_off'} />
      </button>
      <button className={btn('dbtn', !s.camOn, 'off')} onClick={() => void meeting.toggleCam()} title="Camera">
        <Icon name={s.camOn ? 'videocam' : 'videocam_off'} />
      </button>
      {/* Unsupported on mobile browsers — shown greyed rather than pretending. */}
      <button className={btn('dbtn', s.sharing, 'accent')} onClick={() => void meeting.toggleShare()} disabled={!shareOk}
        title={shareOk ? (s.sharing ? 'Stop presenting' : 'Present') : 'Screen sharing isn’t supported on mobile browsers'}>
        <Icon name={s.sharing ? 'cancel_presentation' : 'present_to_all'} />
      </button>
      <button className={btn('dbtn', s.handRaised, 'accent')} onClick={meeting.toggleHand} title="Raise hand"><Icon name="front_hand" /></button>
      <button ref={reactBtnRef} className={btn('dbtn', reactOpen, 'accent')} onClick={onToggleReact} title="React"><Icon name="mood" /></button>
      <div className="dock-sep"></div>
      <button className={btn('dbtn rel', s.panel === 'people', 'accent')} onClick={() => meeting.togglePanel('people')} title="People">
        <Icon name="group" /><span className="cnt">{s.participants.length}</span>
      </button>
      <button className={btn('dbtn rel', s.panel === 'chat', 'accent')} onClick={() => meeting.togglePanel('chat')} title="Chat">
        <Icon name="chat" />{s.unread > 0 && <span className="cnt red">{s.unread}</span>}
      </button>
      <div className="dock-sep"></div>
      <button ref={leaveBtnRef} className="dbtn leave" onClick={onLeave} title="Leave"><Icon name="call_end" /></button>
    </div>
  );
}
