import { useEffect, useState, type CSSProperties } from 'react';
import type { Track } from 'livekit-client';
import type { Theme } from '../../lib/storage';
import { avatarStyle, initials } from '../../lib/format';
import { peekMediaElement } from '../../lib/mediaElements';
import { displayName, type TileSpec, type VideoSel } from '../../lib/participants';
import { Icon } from '../Brand';
import MediaSlot from './MediaSlot';

export interface Aspect { w: number; h: number }

interface Props {
  spec: TileSpec;
  video: VideoSel | null;
  audio: Track | null;
  isLocal: boolean;
  isPinned: boolean;
  isHost: boolean;
  speaking: boolean;
  handUp: boolean;
  micOn: boolean;
  theme: Theme;
  gridColumn?: string;
  onMore: (identity: string, name: string, isLocal: boolean, anchor: HTMLElement) => void;
  onPinAspect?: (a: Aspect) => void;
}

export default function Tile({ spec, video, audio, isLocal, isPinned, isHost, speaking, handUp, micOn, theme, gridColumn, onMore, onPinAspect }: Props) {
  const { p, screen } = spec;
  const person = displayName(p);
  const name = screen ? (isLocal ? 'Your presentation' : `${person}'s presentation`) : person;
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const videoTrack = video?.track ?? null;

  // The spotlight follows the sender's real aspect ratio, re-checked on rotate.
  useEffect(() => {
    if (!isPinned || !video || !videoTrack) { setAspect(null); return; }
    const d = video.pub.dimensions;
    if (d?.width && d?.height) setAspect({ w: d.width, h: d.height });
    const el = peekMediaElement(videoTrack);
    if (!(el instanceof HTMLVideoElement)) return;
    const read = () => { if (el.videoWidth && el.videoHeight) setAspect({ w: el.videoWidth, h: el.videoHeight }); };
    read();
    el.addEventListener('loadedmetadata', read);
    el.addEventListener('resize', read);
    return () => { el.removeEventListener('loadedmetadata', read); el.removeEventListener('resize', read); };
    // `video` is rebuilt every render; the track is what identifies it.
  }, [isPinned, videoTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isPinned && aspect) onPinAspect?.(aspect);
  }, [isPinned, aspect?.w, aspect?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const style: CSSProperties = { gridColumn };
  if (isPinned && aspect) (style as Record<string, string>)['--pin-ar'] = `${aspect.w}/${aspect.h}`;

  const cls = ['tile'];
  if (screen) cls.push('screen');
  if (isLocal && !screen) cls.push('local');
  if (!screen && speaking) cls.push('speaking');
  if (isPinned) cls.push('pin');
  // Screen publication announced but not subscribed yet: show a waiting state so
  // the tile (and the spotlight) exist while the track arrives.
  if (screen && !video) cls.push('waiting');

  const showAvatar = !video && !screen;

  return (
    <div className={cls.join(' ')} style={style}>
      {videoTrack && <MediaSlot track={videoTrack} />}
      <div className="tav" style={showAvatar ? avatarStyle(p.identity, theme) : { display: 'none' }}>{initials(person)}</div>
      {/* Material icon rather than the ✋ emoji: the emoji's own yellow vanished on the yellow badge. */}
      <div className={!screen && handUp ? 'thand show' : 'thand'}><Icon name="front_hand" /></div>
      <div className="tname">
        {screen ? (
          <><Icon name="present_to_all" /><span className="nm">{name}</span></>
        ) : (
          <>{!micOn && <Icon name="mic_off" />}<span className="nm">{name}</span>{isLocal && <span className="badge-you">YOU</span>}</>
        )}
      </div>
      {audio && <MediaSlot track={audio} />}
      {isPinned && <div className="tpin"><Icon name="push_pin" /></div>}
      {isHost && !screen && (
        <button className="tmore" title="Participant options"
          onClick={e => { e.stopPropagation(); onMore(p.identity, name, isLocal, e.currentTarget); }}>
          <Icon name="more_vert" />
        </button>
      )}
    </div>
  );
}
