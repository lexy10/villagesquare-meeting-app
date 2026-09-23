import { ctx } from './sounds';

const SPEECH_DB = -42;      // voice-band level that counts as talking
const TICK_MS = 100;
const TRIGGER_TICKS = 7;    // ~0.7s of talking, so a cough or a keyboard clack doesn't count

/**
 * Calls `onSpeech` when someone keeps talking into a muted mic.
 *
 * LiveKit mutes by disabling the track, so the muted track itself carries only
 * silence. A clone has its own `enabled` flag: turning that on lets us measure
 * the level locally while the published track stays muted. Nothing from the
 * clone is sent anywhere. Returns a stop function.
 */
export function watchMutedSpeech(track: MediaStreamTrack, onSpeech: () => void): () => void {
  const clone = track.clone();
  clone.enabled = true;
  const ac = ctx();
  const src = ac.createMediaStreamSource(new MediaStream([clone]));
  // Voice band only: ignores the low rumble of fans and air-con.
  const band = ac.createBiquadFilter();
  band.type = 'bandpass'; band.frequency.value = 1000; band.Q.value = 0.7;
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  // Some browsers only run nodes that reach the destination; a zero gain keeps it silent.
  const sink = ac.createGain();
  sink.gain.value = 0;
  src.connect(band); band.connect(an); an.connect(sink); sink.connect(ac.destination);

  const buf = new Float32Array(an.fftSize);
  let loud = 0;
  const timer = window.setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);
    loud = db > SPEECH_DB ? loud + 1 : Math.max(0, loud - 1);
    if (loud >= TRIGGER_TICKS) { loud = 0; onSpeech(); }
  }, TICK_MS);

  return () => {
    window.clearInterval(timer);
    try { src.disconnect(); sink.disconnect(); } catch { /* already gone */ }
    clone.stop();
  };
}
