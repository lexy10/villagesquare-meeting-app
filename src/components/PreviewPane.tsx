import type { Preview } from '../hooks/usePreview';
import { initials } from '../lib/format';
import { Icon } from './Brand';

interface Props {
  pv: Preview;
  /** Name the avatar initials come from when the camera is off. */
  name: string;
  tag: string;
  /** Host setup shows tooltips on the toggles; the guest pre-join doesn't. */
  titles?: boolean;
}

export default function PreviewPane({ pv, name, tag, titles = false }: Props) {
  return (
    <div className="pj-preview">
      <video ref={pv.videoRef} autoPlay playsInline muted />
      <div className={pv.camOn ? 'pj-off' : 'pj-off show'}>
        <div className="av">{initials(name)}</div>
        <div>Camera is off</div>
      </div>
      <div className="pj-tag">{tag}</div>
      <div className="pj-ctrls">
        <button className={pv.micOn ? 'pj-cbtn' : 'pj-cbtn off'} onClick={pv.toggleMic} title={titles ? 'Microphone' : undefined}>
          <Icon name={pv.micOn ? 'mic' : 'mic_off'} />
        </button>
        <button className={pv.camOn ? 'pj-cbtn' : 'pj-cbtn off'} onClick={() => void pv.toggleCam()} disabled={pv.camBusy} title={titles ? 'Camera' : undefined}>
          <Icon name={pv.camOn ? 'videocam' : 'videocam_off'} />
        </button>
      </div>
    </div>
  );
}
