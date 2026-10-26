import type { Track } from 'livekit-client';
import { clockLabel, type PmView } from '../../meeting/pm';
import { Icon } from '../Brand';
import MediaSlot from './MediaSlot';

interface Props {
  /** The check-in in progress, or null. */
  pm: PmView | null;
  /** When people start counting as late (epoch ms). */
  lateAfter: number | null;
  /** Leading: what the PM is saying now, and who has the floor. */
  leading: boolean;
  saying: string | null;
  turnName: string | null;
  /** The PM's voice. */
  track: Track | null;
  gridColumn?: string;
}

// The meeting PM's tile: an orb that pulses while it talks, and a caption of
// what it's saying so nobody misses it in a noisy room. Between times it shows
// who has the floor (when leading) or from when it counts people as late.
export default function PmTile({ pm, lateAfter, leading, saying, turnName, track, gridColumn }: Props) {
  const checkingIn = !!pm && pm.phase !== 'done';
  const talking = checkingIn ? pm.phase === 'asking' || pm.phase === 'replying' : saying !== null;
  let caption: React.ReactNode = null;
  let idle = false;
  if (checkingIn) {
    if (pm.phase === 'listening') caption = <><Icon name="hearing" />Listening to {pm.name}…</>;
    else if (pm.phase === 'thinking') caption = <span className="pm-dots"><i /><i /><i /></span>;
    else if (pm.caption) caption = pm.caption;
  } else if (saying) {
    caption = saying;
  } else if (leading) {
    idle = true;
    caption = turnName
      ? <><Icon name="record_voice_over" />{turnName === 'You' ? 'You have' : `${turnName} has`} the floor</>
      : <><Icon name="groups" />Leading the meeting</>;
  } else if (lateAfter) {
    idle = true;
    caption = <><Icon name="schedule" />Late after {clockLabel(lateAfter)}</>;
  }

  return (
    <div className={talking ? 'tile pm-tile talking' : 'tile pm-tile'} style={{ gridColumn }}>
      {track && <MediaSlot track={track} />}
      <div className="pm-orb" aria-hidden="true"><span>PM</span></div>
      <div className="tname"><span className="nm">PM</span><span className="badge-ai">AI</span></div>
      {caption && <div className={idle ? 'pm-caption idle' : 'pm-caption'} role="status">{caption}</div>}
    </div>
  );
}
