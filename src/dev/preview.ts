// Dev-only: open the meeting screen without a live room, for UI work.
//   http://localhost:5174/?preview          4 people
//   http://localhost:5174/?preview=9        any count
//   http://localhost:5174/?preview=3&video  with fake camera feeds
//   http://localhost:5174/?preview&pm       the PM's tile, and a check-in acted out (no voice)
//   http://localhost:5174/?preview=setup    the host's setup screen
// In the console:
//   vsmPreview.message('Ada', 'hi')                 an incoming chat
//   vsmPreview.lateJoin('Chioma', 'Sorry…')        someone joins late and the PM checks them in
import { Track, type Participant } from 'livekit-client';
import { PM_IDENTITY, type PmMsg } from '../meeting/pm';
import { meeting } from '../meeting/store';

const NAMES = ['You', 'Adaeze Okafor', 'Tunde Bakare', 'Kemi Adeyemi', 'Musa Bello', 'Zainab Yusuf', 'Femi Ojo', 'Ngozi Eze', 'Chidi Nwosu', 'Halima Sani', 'Bola Ade', 'Emeka Obi'];

// A canvas painted every frame stands in for a camera track.
function fakeCamera(label: string, hue: number) {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const g = c.getContext('2d')!;
  const paint = (t: number) => {
    const grad = g.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, `hsl(${hue} 45% 38%)`); grad.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 22%)`);
    g.fillStyle = grad; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(640 + Math.sin(t / 900) * 30, 330, 120, 0, Math.PI * 2); g.fill();
    g.font = '600 44px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(label, 640, 560);
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
  const mst = c.captureStream(30).getVideoTracks()[0];
  const track = {
    kind: 'video', source: 'camera', mediaStreamTrack: mst,
    attach() { const v = document.createElement('video'); v.srcObject = new MediaStream([mst]); void v.play().catch(() => {}); return v; },
    detach() {},
  };
  return { kind: 'video', source: 'camera', track, isMuted: false, dimensions: { width: 1280, height: 720 } };
}

function standIn(i: number, video: boolean, name = NAMES[i % NAMES.length]): Participant {
  const pubs = new Map();
  if (video) pubs.set(`cam${i}`, fakeCamera(name, (i * 67) % 360));
  return {
    identity: i === 0 ? 'me' : `guest_p${i}`,
    name,
    isLocal: i === 0,
    trackPublications: pubs,
    videoTrackPublications: pubs,
    getTrackPublication: (_source: Track.Source) => undefined,
  } as unknown as Participant;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fromPm = (m: PmMsg) => meeting.dev?.receive(m, PM_IDENTITY);

let joined = 0;

/** Someone joins late and the PM checks them in, as its messages would show it. */
async function lateJoin(name = 'Chioma Nwankwo', answer = 'Sorry o, the traffic on Third Mainland Bridge was terrible this morning.') {
  const n = meeting.getSnapshot().participants.length + 10 + joined++;
  const p = standIn(n, false, name);
  meeting.dev?.join(p);
  const first = name.split(' ')[0];
  await sleep(1200);
  fromPm({ t: 'pm', op: 'start', who: p.identity, name });
  fromPm({ t: 'pm', op: 'phase', phase: 'asking', caption: `Sorry to cut in, everyone. Good morning, ${first}, you joined at 9:41. What held you up?` });
  await sleep(4000);
  fromPm({ t: 'pm', op: 'phase', phase: 'listening', caption: `Listening to ${name}…` });
  meeting.dev?.speaking([p.identity]);
  await sleep(answer ? 3500 : 6000);
  meeting.dev?.speaking([]);
  fromPm({ t: 'pm', op: 'phase', phase: 'thinking', caption: '…' });
  await sleep(1500);
  fromPm({ t: 'pm', op: 'phase', phase: 'replying', caption: answer ? 'Ah, sorry about the traffic, you are welcome. Adaeze, please continue.' : `Okay, no problem. You're welcome, ${first}. Adaeze, please continue.` });
  await sleep(3500);
  fromPm({ t: 'pm', op: 'end', speaker: 'guest_p1' });
  return p.identity;
}

export function startPreview() {
  const q = new URLSearchParams(location.search);
  const n = Math.max(1, Number(q.get('preview')) || 4), video = q.has('video');
  const startAt = Date.now() - 20 * 60_000;
  meeting.dev?.set({
    status: 'connected',
    participants: Array.from({ length: n }, (_, i) => standIn(i, video && i % 3 !== 2)),
    role: 'host',
    code: 'abc-defg-hij',
    meetingId: 'vsm-preview',
    pmAvailable: true,
    title: 'Design review',
    micOn: true,
    camOn: false,
  });
  if (q.has('pm') && !document.getElementById('vsm-preview-late')) {
    // The meeting "started" 20 minutes ago with 5 minutes' grace.
    meeting.dev?.set({
      pmHere: true, pmCheckIn: true, pmLateAfter: startAt + 5 * 60_000,
      pmSettings: { enabled: true, startAt, graceMin: 5 },
    });
    const late = ['Chioma Nwankwo', 'Bola Ade', 'Emeka Obi', 'Halima Sani', 'Femi Ojo'];
    const btn = document.createElement('button');
    btn.id = 'vsm-preview-late';
    btn.textContent = '▶ Simulate a latecomer';
    btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:400;padding:10px 14px;border-radius:12px;background:#1b1f24;color:#fff;font:600 13px Inter,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,.3)';
    btn.onclick = () => { void lateJoin(late.shift() || `Guest ${Date.now() % 1000}`); };
    document.body.appendChild(btn);
  }
  (window as unknown as Record<string, unknown>).vsmPreview = {
    message: (name = 'Adaeze Okafor', text = 'Can everyone see my screen?') => meeting.dev?.incomingChat(name, text),
    lateJoin,
    leave: (identity: string) => meeting.dev?.leave(identity),
    receive: (d: unknown, identity: string) => meeting.dev?.receive(d as never, identity),
    pm: (checkIn: boolean) => meeting.dev?.set({ pmHere: true, pmCheckIn: checkIn }),
  };
}
