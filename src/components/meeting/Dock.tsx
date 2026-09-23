import { canShareScreen } from '../../lib/devices';
import { meeting, useMeeting } from '../../meeting/store';
import { Icon } from '../Brand';

interface Props {
  reactOpen: boolean;
  onToggleReact: () => void;
  onLeave: () => void;
}

export default function Dock({ reactOpen, onToggleReact, onLeave }: Props) {
  const s = useMeeting();
  const shareOk = canShareScreen();
  const btn = (base: string, flag: boolean, mod: string) => (flag ? `${base} ${mod}` : base);

  const nudge = s.mutedNudge && !s.micOn;

  return (
    <div className="mt-dock">
      {nudge && (
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
      <button className={btn('dbtn', reactOpen, 'accent')} onClick={onToggleReact} title="React"><Icon name="mood" /></button>
      <div className="dock-sep"></div>
      <button className={btn('dbtn rel', s.panel === 'people', 'accent')} onClick={() => meeting.openPanel('people')} title="People">
        <Icon name="group" /><span className="cnt">{s.participants.length}</span>
      </button>
      <button className={btn('dbtn rel', s.panel === 'chat', 'accent')} onClick={() => meeting.openPanel('chat')} title="Chat">
        <Icon name="chat" />{s.unread > 0 && <span className="cnt red">{s.unread}</span>}
      </button>
      <div className="dock-sep"></div>
      <button className="dbtn leave" onClick={e => { e.stopPropagation(); onLeave(); }} title="Leave"><Icon name="call_end" /></button>
    </div>
  );
}
