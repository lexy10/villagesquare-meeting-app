// Join/leave chimes and reaction cues, synthesized with WebAudio so the app
// ships almost no audio assets. One shared AudioContext; Chrome suspends it
// when the tab is backgrounded, so every entry point resumes it first.
let actx: AudioContext | null = null;

function ctx(): AudioContext {
  actx = actx || new (window.AudioContext || (window as any).webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

/** Resume the shared context after the tab comes back to the foreground. */
export function resumeAudioContext() {
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}

export function chime(kind: 'join' | 'leave') {
  try {
    const ac = ctx();
    // join = gentle ascending two-note; leave = softer descending two-note.
    const notes = kind === 'join' ? [[587.33, 0], [880, 0.12]] : [[659.25, 0], [440, 0.13]];
    const master = ac.createGain(); master.gain.value = kind === 'join' ? 0.18 : 0.14; master.connect(ac.destination);
    notes.forEach(([freq, at]) => {
      const t = ac.currentTime + at;
      const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.24);
    });
  } catch { /* audio unavailable */ }
}

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const n = ac.sampleRate * 0.6, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = buf);
}

interface ToneOpts { freq: number; at?: number; dur?: number; type?: OscillatorType; peak?: number; glide?: number | null; attack?: number }
// One shaped oscillator note; `glide` bends the pitch over the note's life.
function tone(ac: AudioContext, out: AudioNode, { freq, at = 0, dur = 0.2, type = 'sine', peak = 1, glide = null, attack = 0.012 }: ToneOpts) {
  const t = ac.currentTime + at;
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}

interface NoiseOpts { at?: number; dur?: number; peak?: number; f0?: number; sweep?: number | null; q?: number; type?: BiquadFilterType }
// One shaped noise burst; `sweep` moves the filter for whoosh/crackle effects.
function noise(ac: AudioContext, out: AudioNode, { at = 0, dur = 0.12, peak = 1, f0 = 2000, sweep = null, q = 1, type = 'bandpass' }: NoiseOpts) {
  const t = ac.currentTime + at;
  const src = ac.createBufferSource(); src.buffer = noiseBuffer(ac);
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + dur + 0.02);
}

// Each reaction gets a short cue matching its meaning.
const REACTION_SOUNDS: Record<string, (ac: AudioContext, o: AudioNode) => void> = {
  '\u{1F44D}': (ac, o) => { tone(ac, o, { freq: 1046, dur: 0.11, peak: 0.9 }); tone(ac, o, { freq: 1568, at: 0.08, dur: 0.16, peak: 0.8 }); }, // approving ping
  '❤️': (ac, o) => { tone(ac, o, { freq: 110, dur: 0.16, peak: 1, attack: 0.006 }); // lub
    tone(ac, o, { freq: 92, at: 0.19, dur: 0.22, peak: 0.85, attack: 0.006 }); }, // dub
  '\u{1F389}': (ac, o) => { [523, 659, 784, 1046].forEach((f, i) => tone(ac, o, { freq: f, at: i * 0.055, dur: 0.2, type: 'triangle', peak: 0.7 })); // fanfare
    noise(ac, o, { at: 0.2, dur: 0.35, peak: 1.1, f0: 5000, sweep: 1200, type: 'highpass' }); }, // confetti hiss
  '\u{1F602}': (ac, o) => { [0, 0.13, 0.25, 0.36].forEach((t, i) => tone(ac, o, { freq: 520 - i * 45, at: t, dur: 0.11, type: 'triangle', peak: 0.85, glide: 400 - i * 40 })); }, // ha-ha-ha
  '\u{1F62E}': (ac, o) => { tone(ac, o, { freq: 330, dur: 0.42, peak: 0.8, glide: 990 }); }, // rising gasp
  '\u{1F525}': (ac, o) => { noise(ac, o, { dur: 0.5, peak: 2.2, f0: 3400, sweep: 420, type: 'lowpass', q: 0.8 }); // whoosh
    [0, 0.09, 0.19, 0.29].forEach(t => noise(ac, o, { at: t, dur: 0.05, peak: 0.8, f0: 2600 + Math.random() * 1800, q: 2 })); }, // crackle
  '\u{1F64C}': (ac, o) => { [659, 880, 1319].forEach((f, i) => tone(ac, o, { freq: f, at: i * 0.07, dur: 0.28, type: 'triangle', peak: 0.75 })); }, // triad
};

// Recorded cues where a synth can't convince (applause, a human laugh).
// Freely licensed, loudness-matched to the synthesized cues (sounds/CREDITS.txt).
const REACTION_SAMPLES: Record<string, string> = { '\u{1F602}': 'sounds/laugh.mp3' };
const APPLAUSE_URL = 'sounds/clap.mp3';
const sampleBufs: Record<string, Promise<AudioBuffer>> = {};
function loadSample(ac: AudioContext, url: string): Promise<AudioBuffer> {
  if (!sampleBufs[url]) {
    sampleBufs[url] = fetch(url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(b => ac.decodeAudioData(b));
  }
  return sampleBufs[url];
}

/** Fetch+decode the samples once so the first reaction isn't late. */
export function warmReactionSamples() {
  try { const ac = ctx(); [...Object.values(REACTION_SAMPLES), APPLAUSE_URL].forEach(u => loadSample(ac, u).catch(() => {})); } catch { /* ignore */ }
}

function reactionMaster(ac: AudioContext): GainNode {
  const master = ac.createGain(); master.gain.value = 0.16; master.connect(ac.destination);
  return master;
}

function playSample(url: string, fallback?: (ac: AudioContext, o: AudioNode) => void) {
  try {
    const ac = ctx(), master = reactionMaster(ac);
    loadSample(ac, url).then(buf => {
      const src = ac.createBufferSource(); src.buffer = buf; src.connect(master); src.start();
    }).catch(e => {
      console.warn('reaction sample failed', url, e);
      fallback?.(ac, master);
    });
  } catch { /* audio unavailable */ }
}

// A lone 👏 is silent. Once two or more people clap within 2s the room gets one
// crowd applause, and claps landing while it plays just ride along.
const CLAP_WINDOW_MS = 2000, APPLAUSE_MS = 4000;
let claps: { from: string; at: number }[] = [];
let applauseUntil = 0;
export function clap(from: string) {
  const now = Date.now();
  claps = claps.filter(c => now - c.at < CLAP_WINDOW_MS);
  claps.push({ from, at: now });
  if (now < applauseUntil || new Set(claps.map(c => c.from)).size < 2) return;
  applauseUntil = now + APPLAUSE_MS;
  claps = [];
  playSample(APPLAUSE_URL);
}

// Talking drum for a raised hand: two skin strokes whose pitch bends up then
// down, the squeeze-and-release that makes the drum "talk".
function drumStroke(ac: AudioContext, o: AudioNode, at: number, from: number, to: number, dur: number, peak: number) {
  tone(ac, o, { freq: from, glide: to, at, dur, peak, attack: 0.004 });
  tone(ac, o, { freq: from * 1.5, glide: to * 1.5, at, dur: dur * 0.55, peak: peak * 0.3, attack: 0.004 });
  noise(ac, o, { at, dur: 0.03, peak: peak * 0.7, f0: 1900, q: 0.9 });
}
export function talkingDrum() {
  try {
    const ac = ctx(), o = reactionMaster(ac);
    drumStroke(ac, o, 0, 150, 225, 0.2, 1.6);
    drumStroke(ac, o, 0.17, 235, 125, 0.42, 1.8);
  } catch { /* audio unavailable */ }
}

/** Camera shutter for the group photo. */
export function shutter() {
  try {
    const ac = ctx(), o = reactionMaster(ac);
    noise(ac, o, { dur: 0.045, peak: 1.6, f0: 3200, q: 0.8 });
    noise(ac, o, { at: 0.07, dur: 0.06, peak: 1.3, f0: 2200, q: 0.8 });
  } catch { /* audio unavailable */ }
}

// A burst of reactions shouldn't turn into noise soup: at most 4 per second.
let sndTimes: number[] = [];
export function reactionSound(emoji: string) {
  const url = REACTION_SAMPLES[emoji], make = REACTION_SOUNDS[emoji];
  if (!url && !make) return;
  const now = Date.now();
  sndTimes = sndTimes.filter(t => now - t < 1000);
  if (sndTimes.length >= 4) return;
  sndTimes.push(now);
  if (url) { playSample(url, make); return; }
  try { const ac = ctx(); make(ac, reactionMaster(ac)); } catch { /* audio unavailable */ }
}
