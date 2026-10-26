import type { Track } from 'livekit-client';
import { clockLabel, type PmView } from '../../meeting/pm';
import { Icon } from '../Brand';
import MediaSlot from './MediaSlot';

interface Props {
  /** The check-in in progress, or null while the PM just sits in. */
  pm: PmView | null;
  /** When people start counting as late (epoch ms). */
  lateAfter: number | null;
  /** The PM's voice. */
  track: Track | null;
  gridColumn?: string;
}

// The meeting PM's tile: an orb that pulses while it talks, and a caption of
// what it's saying so nobody misses it in a noisy room. Between check-ins it
// shows from when it counts people as late.
export default function PmTile({ pm, lateAfter, track, gridColumn }: Props) {
  const talking = pm?.phase === 'asking' || pm?.phase === 'replying';
  let caption: React.ReactNode = null;
  if (!pm || pm.phase === 'done') caption = lateAfter ? <><Icon name="schedule" />Late after {clockLabel(lateAfter)}</> : null;
  else if (pm.phase === 'listening') caption = <><Icon name="hearing" />Listening to {pm.name}…</>;
  else if (pm.phase === 'thinking') caption = <span className="pm-dots"><i /><i /><i /></span>;
  else if (pm.caption) caption = pm.caption;

  return (
    <div className={talking ? 'tile pm-tile talking' : 'tile pm-tile'} style={{ gridColumn }}>
      {track && <MediaSlot track={track} />}
      <div className="pm-orb" aria-hidden="true"><span>PM</span></div>
      <div className="tname"><span className="nm">PM</span><span className="badge-ai">AI</span></div>
      {caption && <div className={pm && pm.phase !== 'done' ? 'pm-caption' : 'pm-caption idle'} role="status">{caption}</div>}
    </div>
  );
}
