import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '../app/toast';
import { deviceError } from '../lib/devices';

export interface Preview {
  videoRef: RefObject<HTMLVideoElement>;
  camOn: boolean;
  micOn: boolean;
  camBusy: boolean;
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  /**
   * Hand the live preview stream to the caller (to publish into the meeting)
   * without stopping it. On iOS, stopping and re-capturing the mic is exactly
   * what breaks it, so the same granted tracks go straight to LiveKit.
   */
  takeStream: () => MediaStream | null;
  /** Stop and discard the preview (e.g. the room turned out not to be live). */
  stop: () => void;
}

/** Local camera/mic preview shown before entering a meeting (host setup and guest pre-join). */
export function usePreview(): Preview {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const camOnRef = useRef(true);
  const [camOn, setCamOnState] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camBusy, setCamBusy] = useState(false);

  const setCamOn = (v: boolean) => { camOnRef.current = v; setCamOnState(v); };

  // Point the <video> at the stream; with no tracks left, clear it so the last
  // painted frame doesn't linger behind the "camera off" overlay.
  const paint = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    const s = streamRef.current;
    v.srcObject = s && s.getTracks().length ? s : null;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    paint();
  }, [paint]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = s;
        paint();
      })
      .catch(() => {
        if (cancelled) return;
        setCamOn(false);
        setMicOn(false);
        toast('Camera/mic unavailable — you can still continue.');
      });
    return () => { cancelled = true; mounted.current = false; stop(); };
  }, [paint, stop]);

  // Mirror the toggles onto the tracks. Muting a track here is enough for the
  // preview; the choice itself is carried into the meeting by the caller.
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    s.getVideoTracks().forEach(t => { t.enabled = camOn; });
    s.getAudioTracks().forEach(t => { t.enabled = micOn; });
  }, [camOn, micOn]);

  // The mic stays a plain enable/disable: silencing it needs no device release,
  // and re-acquiring audio is what iOS refuses to re-prompt for.
  const toggleMic = useCallback(() => setMicOn(v => !v), []);

  // The camera is different — disabling a video track only blanks the frames
  // and keeps the device light on. Off stops and drops the track; on re-acquires.
  const toggleCam = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setCamBusy(true);
    try {
      const s = streamRef.current;
      if (camOnRef.current) {
        s?.getVideoTracks().forEach(t => { try { t.stop(); } catch { /* ignore */ } s.removeTrack(t); });
        setCamOn(false);
      } else {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: true });
        if (!mounted.current) { fresh.getTracks().forEach(t => t.stop()); return; }
        const track = fresh.getVideoTracks()[0];
        if (s) s.addTrack(track); else streamRef.current = fresh;
        setCamOn(true);
      }
      paint();
    } catch (e) {
      console.warn('preview camera toggle failed', e);
      setCamOn(false);
      toast(deviceError(e, 'Camera', true), 4000);
    } finally {
      busyRef.current = false;
      if (mounted.current) setCamBusy(false);
    }
  }, [paint]);

  const takeStream = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    const v = videoRef.current;
    if (v) { try { v.srcObject = null; } catch { /* ignore */ } }
    return s;
  }, []);

  return { videoRef, camOn, micOn, camBusy, toggleMic, toggleCam, takeStream, stop };
}
