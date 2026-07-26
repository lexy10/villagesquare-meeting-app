const LK = window.LivekitClient;

// ---------- backend (fixed: staging) ----------
const API_BASE = 'https://staging-api.villagesquare.io/v2';
function apiBase(){ return API_BASE; }

// ---------- state ----------
let accessToken='';               // host bearer (from login)
let room=null, myRole='guest', roomId='', livekitUrl='', shareUrl='', livestreamUuid='';
let camOn=true, micOn=true, sharing=false, handRaised=false;
let curPanel=null, unread=0;
let pinned='';            // identity spotlighted for everyone ('' = none)
const chatLog=[]; const handsUp=new Set(); const speaking=new Set();
let pjStream=null, pjCamOn=true, pjMicOn=true, pendingRoom='';
let pendingRejoin=false;   // set when sign-in was triggered from the rejoin banner

// ---------- theme ----------
const THEME_KEY='vsm_theme';
function currentTheme(){ return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark'; }
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark');
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', t==='light'?'#f1f3f4':'#202124');
}
function toggleTheme(){
  const next=currentTheme()==='light'?'dark':'light';
  try{ localStorage.setItem(THEME_KEY,next); }catch{}
  applyTheme(next);
  // Avatar colours are mixed per theme, so re-render anything showing them.
  if(room){ renderGrid(); renderPeople(); }
}
// Applied before first paint (see the inline bootstrap in index.html); this
// re-applies for the saved/system value once the app script loads.
(function(){
  let saved=null; try{ saved=localStorage.getItem(THEME_KEY); }catch{}
  applyTheme(saved || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light':'dark'));
})();

// ---------- participant colours ----------
// Each participant gets a stable hue derived from their identity, so the same
// person is the same colour for everyone in the room (like Meet). Saturation
// and lightness are chosen per theme so it always reads against the background.
// Curated hue/saturation pairs rather than evenly-spaced hues: equal steps put
// several near-identical golds and greens next to each other, so neighbouring
// entries here are deliberately far apart in both hue and intensity.
const AV_COLORS=[
  [354,62],[ 22,72],[ 45,78],[ 96,42],[152,44],[174,52],[190,64],
  [212,58],[236,52],[264,44],[292,42],[322,52],[ 18,26],[206,18],
];
// FNV-1a: short ids like "g1"/"g2" collide into neighbouring buckets with a
// simple *31 hash, which is exactly when the colours look repetitive.
function hashOf(s){ s=String(s||'?'); let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
function avatarStyle(identity){
  const [h,s]=AV_COLORS[hashOf(identity)%AV_COLORS.length];
  return currentTheme()==='light'
    ? `--av-bg:hsl(${h} ${s}% 72%);--av-ink:hsl(${h} ${Math.min(s+10,90)}% 15%)`
    : `--av-bg:hsl(${h} ${s}% 42%);--av-ink:#fff`;
}

// ---------- helpers ----------
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function initials(n){ n=(n||'').trim(); if(!n)return '?'; const p=n.split(/\s+/); return (p[0][0]+(p[1]?p[1][0]:'')).toUpperCase(); }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function clock(){ return new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
function toast(m,ms=2600){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),ms); }
function setClock(){ const el=document.getElementById('lpClock'); if(el) el.textContent=clock()+' · '+new Date().toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}); }
setClock(); setInterval(setClock,15000);

async function apiFetch(path, {method='GET', body, auth=true, multipart=false}={}){
  const headers={}; if(auth && accessToken) headers['Authorization']='Bearer '+accessToken;
  let payload; if(multipart){ payload=body; } else if(body){ headers['Content-Type']='application/json'; payload=JSON.stringify(body); }
  const resp=await fetch(apiBase()+path,{method,headers,body:payload});
  let json={}; try{ json=await resp.json(); }catch{}
  if(!resp.ok) throw new Error(json.message || (resp.status+' '+resp.statusText));
  return json.data!==undefined ? json.data : json;
}

// ---------- host: resume a meeting left without ending ----------
// Leaving only disconnects this client; the room stays live until the host ends
// it (or the media server reaps it once no publisher is left). Remember which
// meeting this browser started so the host can get back in with host powers —
// rejoining as a guest would work, but would not be able to end it for everyone.
// Only the identifiers are persisted; the bearer token is never written to disk.
const HOST_MEETING_KEY='vsm_host_meeting';
function rememberHostMeeting(m){ try{ localStorage.setItem(HOST_MEETING_KEY,JSON.stringify(m)); }catch{} }
function forgetHostMeeting(){ try{ localStorage.removeItem(HOST_MEETING_KEY); }catch{} }
function recallHostMeeting(){ try{ return JSON.parse(localStorage.getItem(HOST_MEETING_KEY)||'null'); }catch{ return null; } }

// Show the rejoin banner only if that meeting is genuinely still live.
async function refreshRejoinCard(){
  const card=document.getElementById('rejoinCard'); if(!card)return;
  const m=recallHostMeeting();
  if(!m||!m.uuid||!m.roomId){ card.style.display='none'; return; }
  try{
    const d=await apiFetch('/livestreams/'+encodeURIComponent(m.roomId)+'/meeting-status',{method:'POST',auth:false});
    if(d && d.live===false){ forgetHostMeeting(); card.style.display='none'; return; }
  }catch(e){ /* status unavailable — still offer it; the rejoin call decides */ }
  document.getElementById('rejoinRoom').textContent=m.title?`${m.title} · ${m.roomId}`:m.roomId;
  card.style.display='flex';
}

async function rejoinAsHost(){
  const m=recallHostMeeting(); if(!m||!m.uuid) return;
  // Host rejoin is an authenticated call — without a token we can't prove
  // ownership, so route through sign-in and come straight back here.
  if(!accessToken){ pendingRejoin=true; show('hostSignin'); toast('Sign in to rejoin as host'); setTimeout(()=>document.getElementById('hEmail').focus(),50); return; }
  const btn=document.querySelector('#rejoinCard .rj-btn'); if(btn){ btn.disabled=true; btn.textContent='Rejoining…'; }
  let seed=null;
  try{
    try{ seed=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); }
    catch(e){ camOn=false; micOn=false; }
    const d=await apiFetch('/livestreams/'+encodeURIComponent(m.uuid)+'/join',{method:'POST'});
    if(!d.token||!d.livekit_url) throw new Error('No media token returned');
    roomId=d.room_id||m.roomId; livekitUrl=d.livekit_url; livestreamUuid=m.uuid; myRole='host';
    shareUrl=location.origin+location.pathname+'?room='+encodeURIComponent(roomId);
    await connectRoom(d.token, myName()||'Host', m.title||'Meeting', seed);
    seed=null;
  }catch(e){
    if(seed){ try{ seed.getTracks().forEach(t=>t.stop()); }catch{} }
    // A meeting that has since ended shouldn't keep offering a dead button.
    if(/not live|not found|ended|denied/i.test(e.message||'')){ forgetHostMeeting(); refreshRejoinCard(); }
    toast('Could not rejoin: '+e.message,4500);
  }finally{ if(btn){ btn.disabled=false; btn.textContent='Rejoin'; } }
}

// ---------- landing ----------
function onCode(){ document.getElementById('btnJoin').disabled=!document.getElementById('joinCode').value.trim(); }
function goHostSignin(){ if(accessToken){ openHostSetup(); } else { show('hostSignin'); setTimeout(()=>document.getElementById('hEmail').focus(),50); } }
// Host setup mirrors the guest pre-join: see yourself, set mic/camera, then
// enter with exactly those settings.
function openHostSetup(){
  previewCtx='hs'; pjCamOn=true; pjMicOn=true;
  document.getElementById('hsAv').textContent=initials(myName()||'Host');
  updatePjBtns(); show('hostSetup'); startPreview();
  setTimeout(()=>document.getElementById('mTitle').select(),50);
}
function cancelHostSetup(){ stopPreview(); show('landing'); }
function goGuest(){ const v=document.getElementById('joinCode').value.trim(); if(!v)return; checkAndProceed(normalizeRoom(v)); }
function normalizeRoom(v){ try{ if(v.startsWith('http')){ const u=new URL(v); return u.searchParams.get('room')||v; } }catch{} return v.trim(); }

// Gate on live status before asking for a name. Not live → branded notice.
let pendingTitle='';
async function checkAndProceed(rawRoom){
  const roomIn=(rawRoom||'').trim(); if(!roomIn)return;
  pendingRoom=roomIn; pendingTitle='';
  const btn=document.getElementById('btnJoin'); const orig=btn?btn.textContent:''; if(btn){ btn.disabled=true; btn.textContent='Checking…'; }
  try{
    const d=await apiFetch('/livestreams/'+encodeURIComponent(roomIn)+'/meeting-status',{method:'POST',auth:false});
    // Fail-open: only block on a DEFINITIVE not-live. If the check is unavailable
    // or returns something unexpected, proceed and let the real join decide —
    // guest-token is the source of truth and shows "not live" if it truly isn't.
    if(d && d.live===false){ showNotLive(roomIn); }
    else { if(d && d.room_id) pendingRoom=d.room_id; if(d && d.title) pendingTitle=d.title; openPrejoin(); }
  }catch(e){ console.warn('meeting-status check unavailable, proceeding to join:', e.message); openPrejoin(); }
  finally{ if(btn){ btn.disabled=false; btn.textContent=orig||'Join'; } }
}
function showNotLive(room){ document.getElementById('nlRoom').textContent=room; show('notlive'); }
function checkAgain(){ const b=document.getElementById('btnCheckAgain'); b.disabled=true; b.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Checking…'; checkAndProceed(pendingRoom).finally(()=>{ b.disabled=false; b.innerHTML='<span class="material-symbols-rounded">refresh</span> Check again'; }); }

// ---------- host: login ----------
async function doLogin(){
  const email=document.getElementById('hEmail').value.trim(), pw=document.getElementById('hPass').value;
  const err=document.getElementById('loginErr'); err.classList.remove('show');
  if(!email||!pw){ err.textContent='Enter your email and password.'; err.classList.add('show'); return; }
  const btn=document.getElementById('btnLogin'); btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Signing in…';
  try{
    const d=await apiFetch('/auth/login',{method:'POST',auth:false,body:{ email_or_username:email, password:pw, login_type:'password', audience:'web', device:'browser', timezone:Intl.DateTimeFormat().resolvedOptions().timeZone }});
    accessToken = d.access_token || d.accessToken || d.token || '';
    if(!accessToken) throw new Error('No access token in response');
    document.getElementById('lpAvatar').textContent=initials(email);
    if(pendingRejoin){ pendingRejoin=false; show('landing'); await rejoinAsHost(); return; }
    openHostSetup();
  }catch(e){ err.textContent=e.message; err.classList.add('show'); }
  finally{ btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">login</span> Sign in'; }
}

// ---------- host: start meeting ----------
async function startMeeting(){
  const title=document.getElementById('mTitle').value.trim()||'VillageSquare Meeting';
  const err=document.getElementById('startErr'); err.classList.remove('show');
  const btn=document.getElementById('btnStart'); btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Starting…';
  // Enter with whatever was chosen in the preview, exactly like a guest does.
  camOn=pjCamOn; micOn=pjMicOn;
  let seed=null;
  try{
    if(pjStream){
      // Hand the preview's already-permitted tracks straight to LiveKit — the
      // same path guests use, and what keeps the mic working on iOS.
      seed=pjStream; pjStream=null; detachPreview();
    }else{
      // No preview stream (permission denied, or it was stopped): capture now,
      // still inside the click gesture so iOS will show the prompt.
      try{ seed=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); }
      catch(e){ console.warn('host media capture failed',e); camOn=false; micOn=false; toast('Starting without camera/mic — you can enable them in the meeting.',4000); }
    }
    const fd=new FormData(); fd.append('title',title); fd.append('category_id','38'); fd.append('privacy','everyone');
    const d=await apiFetch('/livestreams/start',{method:'POST',multipart:true,body:fd});
    roomId = d.room_id; livekitUrl = d.livekit_url; livestreamUuid = d.uuid; myRole='host';
    rememberHostMeeting({uuid:livestreamUuid, roomId, title});
    const hostToken = d.token;
    if(!hostToken||!livekitUrl) throw new Error('Meeting started but no media token was returned');
    shareUrl = location.origin+location.pathname+'?room='+encodeURIComponent(roomId);
    // connect
    await connectRoom(hostToken, myName()||'Host', title, seed);
    // show share modal
    document.getElementById('shareLink').value=shareUrl;
    document.getElementById('shareCode').textContent=roomId;
    document.getElementById('shareModal').classList.add('open');
  }catch(e){
    // Don't leave the camera light on if we never made it into the room.
    if(seed){ try{ seed.getTracks().forEach(t=>t.stop()); }catch{} }
    err.textContent=e.message; err.classList.add('show'); btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">rocket_launch</span> Start meeting';
  }
}
function myName(){ return document.getElementById('hEmail')?.value?.split('@')[0] || ''; }

// ---------- guest: pre-join ----------
function openPrejoin(){
  previewCtx='pj';
  document.getElementById('pjRoom').textContent=pendingRoom;
  document.getElementById('pjTitle').textContent=pendingTitle?('Join “'+pendingTitle+'”'):'Join the meeting';
  document.getElementById('pjName').value=localStorage.getItem('vsm_name')||'';
  onPjName(); updatePjTag(); show('prejoin'); startPreview();
}
// The host and the guest both get a live preview before entering. They are
// separate screens with their own elements, so the preview helpers resolve
// their targets through previewCtx instead of hard-coding the guest ids.
let previewCtx='pj';   // 'pj' = guest pre-join, 'hs' = host setup
function pvEl(part){
  const ids = previewCtx==='hs'
    ? {v:'hsVideo',off:'hsOff',av:'hsAv',mic:'hsMicBtn',cam:'hsCamBtn'}
    : {v:'pjVideo',off:'pjOff',av:'pjAv',mic:'pjMicBtn',cam:'pjCamBtn'};
  return document.getElementById(ids[part]);
}
async function startPreview(){
  stopPreview();
  try{ pjStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); pvEl('v').srcObject=pjStream; applyPj(); }
  catch{ pjCamOn=false; pjMicOn=false; pvEl('off').classList.add('show'); updatePjBtns(); toast('Camera/mic unavailable — you can still continue.'); }
}
function stopPreview(){ if(pjStream){ pjStream.getTracks().forEach(t=>t.stop()); pjStream=null; } detachPreview(); }
// Release the <video> element WITHOUT stopping the tracks — used when the
// preview stream is being handed to LiveKit instead of discarded.
function detachPreview(){ const v=pvEl('v'); if(v){ try{ v.srcObject=null; }catch{} } }
// Note the button/overlay refresh happens even with no stream: when permission
// was denied there are no tracks to flip, but the toggles must still respond so
// the choice you make is visible — and it is still carried into the meeting.
function applyPj(){
  if(pjStream){
    pjStream.getVideoTracks().forEach(t=>t.enabled=pjCamOn);
    pjStream.getAudioTracks().forEach(t=>t.enabled=pjMicOn);
  }
  const off=pvEl('off'); if(off) off.classList.toggle('show',!pjCamOn);
  updatePjBtns();
}
function updatePjBtns(){ const m=pvEl('mic'),c=pvEl('cam'); if(!m||!c)return; m.classList.toggle('off',!pjMicOn); m.querySelector('.material-symbols-rounded').textContent=pjMicOn?'mic':'mic_off'; c.classList.toggle('off',!pjCamOn); c.querySelector('.material-symbols-rounded').textContent=pjCamOn?'videocam':'videocam_off'; }
// The mic stays a plain enable/disable: silencing it needs no device release,
// and re-acquiring audio is exactly what iOS refuses to re-prompt for.
function pjMic(){ pjMicOn=!pjMicOn; applyPj(); }

// The camera is different — disabling a video track only blanks the frames, it
// keeps the capture open and the device light on. Turning it off here stops and
// drops the track outright, and turning it back on re-acquires one.
let _pjCamBusy=false;
async function pjCam(){
  if(_pjCamBusy)return;
  _pjCamBusy=true;
  const btn=pvEl('cam'); if(btn) btn.disabled=true;
  try{
    if(pjCamOn){
      if(pjStream) pjStream.getVideoTracks().forEach(t=>{ try{ t.stop(); }catch{} pjStream.removeTrack(t); });
      pjCamOn=false;
      // Re-point the element so it drops the last painted frame.
      const v=pvEl('v'); if(v) v.srcObject=pjStream&&pjStream.getTracks().length?pjStream:null;
    }else{
      const fresh=await navigator.mediaDevices.getUserMedia({video:true});
      const track=fresh.getVideoTracks()[0];
      if(pjStream) pjStream.addTrack(track); else pjStream=fresh;
      pjCamOn=true;
      const v=pvEl('v'); if(v) v.srcObject=pjStream;
    }
  }catch(e){
    console.warn('preview camera toggle failed',e);
    pjCamOn=false;
    toast(deviceError(e,'Camera',true),4000);
  }finally{
    _pjCamBusy=false;
    if(btn) btn.disabled=false;
    applyPj();
  }
}
function onPjName(){ const v=document.getElementById('pjName').value.trim(); document.getElementById('btnGuestJoin').disabled=!v; updatePjTag(); }
function updatePjTag(){ const v=document.getElementById('pjName').value.trim()||'You'; document.getElementById('pjTag').textContent=v; document.getElementById('pjAv').textContent=initials(v); }
function leavePrejoin(){ stopPreview(); show('landing'); }

// ---------- guest: join ----------
async function guestJoin(){
  const name=document.getElementById('pjName').value.trim(); if(!name)return;
  localStorage.setItem('vsm_name',name);
  camOn=pjCamOn; micOn=pjMicOn; myRole='guest';
  const btn=document.getElementById('btnGuestJoin'); btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Joining…';
  let seed=null;
  try{
    const d=await apiFetch('/livestreams/'+encodeURIComponent(pendingRoom)+'/guest-token',{method:'POST',auth:false,body:{name}});
    roomId=d.room_id; livekitUrl=d.livekit_url; shareUrl=location.origin+location.pathname+'?room='+encodeURIComponent(roomId);
    if(!d.token||!livekitUrl) throw new Error('No media token returned');
    // Hand the already-permitted preview tracks to LiveKit rather than stopping
    // them — see publishLocalMedia() for why re-acquiring breaks on iOS.
    seed=pjStream; pjStream=null; detachPreview();
    await connectRoom(d.token, name, 'Meeting', seed);
    seed=null; // ownership transferred to LiveKit
  }catch(e){
    // We took the preview tracks out of pjStream, so stopPreview() can no longer
    // reach them — release here or the camera light stays on after a failure.
    if(seed){ try{ seed.getTracks().forEach(t=>t.stop()); }catch{} seed=null; }
    btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">login</span> Join now';
    if(/not live|not found|room/i.test(e.message||'')){ stopPreview(); showNotLive(pendingRoom); }
    else toast('Could not join: '+e.message,4500);
  }
}

// ---------- notification chimes (synthesized, no assets) ----------
let _actx=null;
function chime(kind){
  try{
    _actx=_actx||new (window.AudioContext||window.webkitAudioContext)();
    if(_actx.state==='suspended')_actx.resume();
    // join = gentle ascending two-note; leave = softer descending two-note.
    const notes = kind==='join' ? [[587.33,0],[880,0.12]] : [[659.25,0],[440,0.13]];
    const master=_actx.createGain(); master.gain.value=kind==='join'?0.18:0.14; master.connect(_actx.destination);
    notes.forEach(([freq,at])=>{
      const t=_actx.currentTime+at;
      const osc=_actx.createOscillator(); osc.type='sine'; osc.frequency.value=freq;
      const g=_actx.createGain();
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(1,t+0.015);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.22);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t+0.24);
    });
  }catch{}
}

// ---------- reaction sounds (synthesized, no assets) ----------
// Each reaction gets a short cue that matches its meaning: a clap is filtered
// noise bursts, a heart is a two-beat pulse, fire is a downward whoosh, etc.
// Everything is built from oscillators/noise so the app stays a self-contained
// page with no audio files to ship or preload.
function _ac(){
  _actx=_actx||new (window.AudioContext||window.webkitAudioContext)();
  if(_actx.state==='suspended')_actx.resume();
  return _actx;
}
let _noiseBuf=null;
function _noiseBuffer(ac){
  if(_noiseBuf)return _noiseBuf;
  const n=ac.sampleRate*0.6, buf=ac.createBuffer(1,n,ac.sampleRate), d=buf.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
  return (_noiseBuf=buf);
}
// One shaped oscillator note; `glide` bends the pitch over the note's life.
function _tone(ac,out,{freq,at=0,dur=.2,type='sine',peak=1,glide=null,attack=.012}){
  const t=ac.currentTime+at;
  const o=ac.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t);
  if(glide) o.frequency.exponentialRampToValueAtTime(glide,t+dur);
  const g=ac.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(peak,t+attack);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t+dur+.02);
}
// One shaped noise burst; `sweep` moves the filter for whoosh/crackle effects.
function _noise(ac,out,{at=0,dur=.12,peak=1,f0=2000,sweep=null,q=1,type='bandpass'}){
  const t=ac.currentTime+at;
  const src=ac.createBufferSource(); src.buffer=_noiseBuffer(ac);
  const f=ac.createBiquadFilter(); f.type=type; f.frequency.setValueAtTime(f0,t); f.Q.value=q;
  if(sweep) f.frequency.exponentialRampToValueAtTime(sweep,t+dur);
  const g=ac.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(peak,t+.008);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t+dur+.02);
}

const REACTION_SOUNDS={
  '\u{1F44D}':(ac,o)=>{ _tone(ac,o,{freq:1046,dur:.11,peak:.9}); _tone(ac,o,{freq:1568,at:.08,dur:.16,peak:.8}); },              // approving ping
  '\u2764\uFE0F':(ac,o)=>{ _tone(ac,o,{freq:110,dur:.16,type:'sine',peak:1,attack:.006});                                        // lub
                       _tone(ac,o,{freq:92,at:.19,dur:.22,type:'sine',peak:.85,attack:.006}); },                                   // dub
  '\u{1F389}':(ac,o)=>{ [523,659,784,1046].forEach((f,i)=>_tone(ac,o,{freq:f,at:i*.055,dur:.2,type:'triangle',peak:.7}));         // party fanfare
                    _noise(ac,o,{at:.2,dur:.35,peak:1.1,f0:5000,sweep:1200,type:'highpass'}); },                                   // confetti hiss
  '\u{1F44F}':(ac,o)=>{ [0,.11,.21,.3].forEach((t,i)=>_noise(ac,o,{at:t,dur:.075,peak:i?2.0:2.7,f0:1600+Math.random()*900,q:.7})); }, // applause
  '\u{1F602}':(ac,o)=>{ [0,.13,.25,.36].forEach((t,i)=>_tone(ac,o,{freq:520-i*45,at:t,dur:.11,type:'triangle',peak:.85,glide:400-i*40})); }, // ha-ha-ha
  '\u{1F62E}':(ac,o)=>{ _tone(ac,o,{freq:330,dur:.42,type:'sine',peak:.8,glide:990}); },                                          // rising gasp
  '\u{1F525}':(ac,o)=>{ _noise(ac,o,{dur:.5,peak:2.2,f0:3400,sweep:420,type:'lowpass',q:.8});                                      // whoosh
                    [0,.09,.19,.29].forEach(t=>_noise(ac,o,{at:t,dur:.05,peak:.8,f0:2600+Math.random()*1800,q:2})); },            // crackle
  '\u{1F64C}':(ac,o)=>{ [659,880,1319].forEach((f,i)=>_tone(ac,o,{freq:f,at:i*.07,dur:.28,type:'triangle',peak:.75})); },         // uplifting triad
};

// Recorded cues for the reactions where a synth can't convince: applause and a
// human laugh. Public-domain sources, trimmed and loudness-matched to the
// synthesized cues (see sounds/CREDITS.txt). Everything else stays synthesized.
const REACTION_SAMPLES={'\u{1F44F}':'sounds/clap.mp3','\u{1F602}':'sounds/laugh.mp3'};
const _sampleBufs={};
function _loadSample(ac,url){
  if(!_sampleBufs[url]){
    _sampleBufs[url]=fetch(url)
      .then(r=>{ if(!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b=>ac.decodeAudioData(b));
  }
  return _sampleBufs[url];
}
// Fetch+decode once so the first reaction isn't late; safe to call repeatedly.
function warmReactionSamples(){
  try{ const ac=_ac(); Object.values(REACTION_SAMPLES).forEach(u=>_loadSample(ac,u).catch(()=>{})); }catch{}
}

// A burst of reactions shouldn't turn into noise soup.
let _sndTimes=[];
function reactionSound(emoji){
  const url=REACTION_SAMPLES[emoji], make=REACTION_SOUNDS[emoji];
  if(!url&&!make)return;
  const now=Date.now();
  _sndTimes=_sndTimes.filter(t=>now-t<1000);
  if(_sndTimes.length>=4)return;
  _sndTimes.push(now);
  try{
    const ac=_ac();
    const master=ac.createGain(); master.gain.value=.16; master.connect(ac.destination);
    if(url){
      _loadSample(ac,url).then(buf=>{
        const src=ac.createBufferSource(); src.buffer=buf; src.connect(master); src.start();
      }).catch(e=>{
        // Fall back to the synthesized cue if the file can't be fetched/decoded.
        console.warn('reaction sample failed, using synth',url,e);
        if(make) make(ac,master);
      });
    }else make(ac,master);
  }catch{}
}

// ---------- connect (shared) ----------
// Publish local audio/video, preferring tracks already captured in pre-join.
//
// iOS (Chrome and Safari both run WKWebView) will not re-prompt for the
// microphone once a granted audio track has been released — a second
// getUserMedia for audio rejects with NotAllowedError instead of showing the
// permission sheet. So handing LiveKit the live pre-join tracks, rather than
// stopping them and capturing again, is what keeps the mic working. It also
// means later dock toggles only mute/unmute an existing publication, so they
// never hit getUserMedia (and never hit that iOS restriction) at all.
async function publishLocalMedia(seed){
  // Snapshot the choice made in the preview. Publishing fires LocalTrackPublished,
  // and syncLocalMediaState() reacts to it by reading the publication's mute
  // state — which is "unmuted" for a freshly published track — overwriting
  // micOn/camOn before we get to apply them. Reading the globals after that
  // point would silently start every meeting with mic and camera on.
  const wantMic=micOn, wantCam=camOn;
  _applyingLocalMedia=true;
  try{
    const at=seed&&seed.getAudioTracks&&seed.getAudioTracks()[0];
    let vt=seed&&seed.getVideoTracks&&seed.getVideoTracks()[0];
    // Camera chosen off: release it instead of publishing a disabled track.
    // Publishing it would keep the capture open (device light on) and leave a
    // window where a frame could reach the room before the mute lands.
    if(vt&&!wantCam){ try{ vt.stop(); }catch{} vt=null; }
    if(at||vt){
      try{
        // Publish the mic already in the chosen state — never enable it first,
        // or live audio reaches the room for the moment before muting applies.
        if(at) at.enabled=wantMic;
        if(vt) vt.enabled=true;
        if(at) await room.localParticipant.publishTrack(at,{source:LK.Track.Source.Microphone});
        if(vt) await room.localParticipant.publishTrack(vt,{source:LK.Track.Source.Camera});
        // Mirror the choice into LiveKit's own mute flags: that is what remote
        // tiles read for the mic icon, and what lets an unmute work later
        // without re-prompting for the device.
        if(at) await room.localParticipant.setMicrophoneEnabled(wantMic).catch(()=>{});
        if(vt) await room.localParticipant.setCameraEnabled(true).catch(()=>{});
        return;
      }catch(e){
        console.warn('reusing pre-join tracks failed, capturing fresh',e);
        try{ seed.getTracks().forEach(t=>t.stop()); }catch{}
      }
    }
    await room.localParticipant.setCameraEnabled(wantCam).catch(()=>{});
    await room.localParticipant.setMicrophoneEnabled(wantMic).catch(()=>{});
  }finally{
    micOn=wantMic; camOn=wantCam;
    _applyingLocalMedia=false;
    updateDock();
  }
}

async function connectRoom(token, displayName, title, seedStream){
  room=new LK.Room({adaptiveStream:true,dynacast:true});
  ['ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','TrackPublished','TrackUnpublished','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished']
    .forEach(ev=>room.on(LK.RoomEvent[ev],()=>{syncPresentations();renderGrid();renderPeople();}));
  // Mirror server-side (host) mutes into our own control state.
  ['TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished']
    .forEach(ev=>room.on(LK.RoomEvent[ev],(_a,p)=>{ if(!p||p===room.localParticipant) syncLocalMediaState(); }));
  room.on(LK.RoomEvent.ParticipantConnected,p=>{chime('join');toast((p.name||p.identity)+' joined');
    // Someone who arrives after a pin was set would otherwise see no spotlight.
    if(myRole==='host'&&pinned) setTimeout(()=>publish({t:'pin',identity:pinned}),600);});
  room.on(LK.RoomEvent.ParticipantDisconnected,p=>{chime('leave');handsUp.delete(p.identity);speaking.delete(p.identity);
    // Drop the spotlight if the pinned person is the one who left.
    if(pinned===p.identity||pinned===p.identity+SCREEN_SUFFIX){ pinned=''; if(myRole==='host') publish({t:'pin',identity:''}); }
    knownShares.delete(p.identity);
    if(tileMenuFor===p.identity) closeTileMenu();
    toast((p.name||p.identity)+' left');});
  room.on(LK.RoomEvent.ActiveSpeakersChanged,s=>{speaking.clear();s.forEach(p=>speaking.add(p.identity));updateSpeaking();});
  room.on(LK.RoomEvent.Disconnected,()=>cleanup());
  room.on(LK.RoomEvent.DataReceived,(payload,p)=>{ try{ handleData(JSON.parse(new TextDecoder().decode(payload)),p);}catch{} });
  await room.connect(livekitUrl.trim(), token);
  await publishLocalMedia(seedStream);
  document.getElementById('mtTitle').textContent=title||'Meeting';
  document.getElementById('mtCode').textContent=roomId;
  show('meeting'); renderGrid(); renderPeople(); updateDock(); warmReactionSamples();
  toast('You joined the meeting');
}

function handleData(d,p){ const who=p?(p.name||p.identity):'Someone';
  if(d.t==='chat') addChat(d.name||who,d.text);
  else if(d.t==='reaction') floatEmoji(d.emoji);
  else if(d.t==='pin'){ pinned=d.identity||''; renderGrid(); }
  else if(d.t==='hand'){ if(d.raised)handsUp.add(p?.identity); else handsUp.delete(p?.identity); renderGrid(); renderPeople(); if(d.raised)toast((d.name||who)+' raised their hand ✋'); }
}

// ---------- grid ----------
function parts(){ return room?[room.localParticipant,...room.remoteParticipants.values()]:[]; }
function isPhonePortrait(){ return window.innerWidth<=600 && window.innerHeight>window.innerWidth; }
// On a phone in portrait, splitting into columns yields tall slivers (a 2-up
// side-by-side is ~170px wide). Stacking keeps every tile roughly landscape,
// which is how faces actually fit. Wider screens keep the square-ish layout.
function cols(n){
  if(isPhonePortrait()) return n<=3?1:2;
  return n<=1?1:n<=4?2:n<=9?3:4;
}
// Tiles persist across renders, keyed by identity. Rebuilding them wholesale on
// every mute/camera event detached and re-attached every <video> in the room,
// which is what made everyone's tiles blink whenever anyone toggled anything.
const tileEls=new Map();
let stripEl=null;

// A publication is only renderable if its track is actually alive. During an
// unpublish the publication can briefly still be present with a dead track —
// attaching that paints a black tile that only cleared on the next full render
// (which is why toggling the theme "fixed" it).
function livePub(pub,isScr){
  if(!pub||!pub.track||pub.isMuted) return null;
  const mst=pub.track.mediaStreamTrack;
  if(mst && mst.readyState!=='live') return null;
  return {pub,track:pub.track,isScr};
}
function screenPub(p){ return livePub(p.getTrackPublication(LK.Track.Source.ScreenShare),true); }
function cameraPub(p){ return livePub(p.getTrackPublication(LK.Track.Source.Camera),false); }

// A presentation is its own tile, not a replacement for the presenter's camera —
// so you keep seeing their face while their screen is up, exactly like Meet.
// Each entry is one tile: {key, p, screen}. `key` is what pinning refers to.
function renderables(){
  const out=[];
  parts().forEach(p=>{
    if(screenPub(p)) out.push({key:p.identity+SCREEN_SUFFIX,p,screen:true});
    out.push({key:p.identity,p,screen:false});
  });
  return out;
}
const SCREEN_SUFFIX='::screen';
function isScreenKey(k){ return typeof k==='string' && k.endsWith(SCREEN_SUFFIX); }
function keyIdentity(k){ return isScreenKey(k) ? k.slice(0,-SCREEN_SUFFIX.length) : k; }

function ensureTile(key){
  let el=tileEls.get(key);
  if(el) return el;
  el=document.createElement('div');
  el.className='tile'; el.dataset.id=key;
  const av=document.createElement('div'); av.className='tav';
  // Material icon rather than the ✋ emoji: the emoji renders in its own yellow,
  // which disappeared against the yellow badge.
  const hand=document.createElement('div'); hand.className='thand';
  hand.innerHTML='<span class="material-symbols-rounded">front_hand</span>';
  const label=document.createElement('div'); label.className='tname';
  el.append(av,hand,label);
  tileEls.set(key,el);
  return el;
}

function updateTile(el,spec,{local,isPinned,grid}){
  const p=spec.p, isScreen=spec.screen;
  const vsel=isScreen?screenPub(p):cameraPub(p);
  // Swap the media element only when the underlying track really changed.
  const wantV=vsel?(vsel.pub.trackSid||vsel.pub.sid||'v'):'';
  if(wantV!==(el.dataset.vsid||'')){
    const old=el.querySelector('video');
    if(old){ try{ old.srcObject=null; }catch{} old.remove(); }
    if(vsel){
      const v=vsel.track.attach();
      v.autoplay=true; v.playsInline=true; v.muted=true;
      el.insertBefore(v,el.firstChild);
    }
    el.dataset.vsid=wantV;
  }
  // Spotlight follows the sender's real aspect ratio (and re-checks on rotate).
  const v=el.querySelector('video');
  if(isPinned&&v&&vsel){
    const setAR=(w,h)=>{ if(w&&h){ el.style.setProperty('--pin-ar',w+'/'+h); grid.classList.toggle('pin-portrait',h>w); } };
    const dim=vsel.pub.dimensions;
    if(dim) setAR(dim.width,dim.height);
    if(!v.dataset.arWired){ v.dataset.arWired='1';
      v.addEventListener('loadedmetadata',()=>setAR(v.videoWidth,v.videoHeight));
      v.addEventListener('resize',()=>setAR(v.videoWidth,v.videoHeight));
    }
  }
  if(!isPinned) el.style.removeProperty('--pin-ar');

  const av=el.querySelector('.tav');
  if(vsel||isScreen){ av.style.display='none'; }
  else{ av.style.cssText=avatarStyle(p.identity); av.textContent=initials(p.name||p.identity); }

  const mic=p.getTrackPublication(LK.Track.Source.Microphone);
  const micLive=!!(mic&&mic.track&&!mic.isMuted);
  const wantA=(!local&&micLive&&!isScreen)?(mic.trackSid||mic.sid||'a'):'';
  if(wantA!==(el.dataset.asid||'')){
    const olda=el.querySelector('audio');
    if(olda){ try{ olda.srcObject=null; }catch{} olda.remove(); }
    if(wantA){ const a=mic.track.attach(); a.style.display='none'; el.appendChild(a); }
    el.dataset.asid=wantA;
  }

  const person=p.name||p.identity;
  const name=isScreen?(local?'Your presentation':`${person}'s presentation`):person;
  const label=el.querySelector('.tname');
  const html=isScreen
    ? '<span class="material-symbols-rounded">present_to_all</span>'+`<span class="nm">${esc(name)}</span>`
    : (micLive?'':'<span class="material-symbols-rounded">mic_off</span>')+
      `<span class="nm">${esc(name)}</span>`+(local?'<span class="badge-you">YOU</span>':'');
  if(label.innerHTML!==html) label.innerHTML=html;

  // A hand belongs to the person, not to their screen; and never mirror a shared
  // screen the way we mirror a selfie camera.
  el.querySelector('.thand').classList.toggle('show',!isScreen&&handsUp.has(p.identity));
  el.classList.toggle('screen',isScreen);
  el.classList.toggle('local',local&&!isScreen);
  el.classList.toggle('speaking',!isScreen&&speaking.has(p.identity));
  el.classList.toggle('pin',isPinned);

  let badge=el.querySelector('.tpin');
  if(isPinned&&!badge){ badge=document.createElement('div'); badge.className='tpin';
    badge.innerHTML='<span class="material-symbols-rounded">push_pin</span>'; el.appendChild(badge); }
  else if(!isPinned&&badge) badge.remove();

  // Moderation is host-only; the role can change on rejoin, so keep it in sync.
  let more=el.querySelector('.tmore');
  if(myRole==='host'&&!isScreen&&!more){
    more=document.createElement('button'); more.className='tmore'; more.title='Participant options';
    more.innerHTML='<span class="material-symbols-rounded">more_vert</span>';
    more.onclick=(ev)=>{ ev.stopPropagation(); openTileMenu(el.dataset.id,el.dataset.nm||el.dataset.id,el.classList.contains('local'),ev.currentTarget); };
    el.appendChild(more);
  }else if((myRole!=='host'||isScreen)&&more) more.remove();
  el.dataset.nm=name;
}

// Move only the nodes that are out of position, so untouched tiles are never
// detached (detaching a <video> is what causes the visible flash).
function placeChildren(container,els){
  els.forEach((el,i)=>{ if(container.children[i]!==el) container.insertBefore(el,container.children[i]||null); });
  while(container.children.length>els.length) container.lastElementChild.remove();
}

function renderGrid(){
  if(!room)return; const grid=document.getElementById('grid');
  const ps=renderables();
  const phone=isPhonePortrait();
  const pinIdx = pinned ? ps.findIndex(t=>t.key===pinned) : -1;
  const hasPin = pinIdx>=0;
  if(hasPin) ps.unshift(ps.splice(pinIdx,1)[0]);
  const n=ps.length;
  let c, centred=false, rowCount=1, fit=false;
  grid.classList.toggle('pinned',hasPin);
  if(!hasPin) grid.classList.remove('pin-portrait');

  if(hasPin){
    grid.style.gridTemplateColumns=''; grid.style.gridTemplateRows='';
    grid.style.height='100%'; grid.style.maxWidth='100%'; grid.style.aspectRatio='auto';
  }else{
    c=cols(n); const r=Math.ceil(n/c);
    grid.style.gridTemplateColumns=`repeat(${c},1fr)`;
    if(phone){
      // Three full-width tiles at their natural shape overflow a phone screen,
      // so at exactly 3 they shrink to share the height instead of scrolling.
      fit = n===3;
      grid.style.gridTemplateRows=`repeat(${r},${fit?'1fr':'auto'})`;
      grid.style.height=fit?'100%':'auto';
      grid.style.maxWidth='100%'; grid.style.aspectRatio='auto';
    }else{
      // Twice as many columns as tiles, each spanning two, so a short last row
      // starts on a half-column and sits centred (5 = 3 up, 2 centred).
      grid.style.gridTemplateColumns=`repeat(${c*2},1fr)`;
      grid.style.gridTemplateRows=`repeat(${r},1fr)`;
      grid.style.maxWidth=n<=1?'960px':'100%'; grid.style.aspectRatio=n<=1?'16/9':'auto'; grid.style.height='100%';
      centred=true; rowCount=r;
    }
  }
  grid.classList.toggle('fit',fit);

  const mainEls=[], stripTiles=[];
  ps.forEach((spec,i)=>{
    const local=spec.p===room.localParticipant;
    const isPinned=hasPin&&i===0;
    const el=ensureTile(spec.key);
    updateTile(el,spec,{local,isPinned,grid});
    if(centred){
      const row=Math.floor(i/c), inRow=i%c;
      const inThisRow=(row===rowCount-1) ? n-(rowCount-1)*c : c;
      el.style.gridColumn=`${(c-inThisRow)+1+2*inRow} / span 2`;
    }else el.style.removeProperty('grid-column');
    (hasPin&&!isPinned ? stripTiles : mainEls).push(el);
  });

  if(hasPin&&stripTiles.length){
    if(!stripEl){ stripEl=document.createElement('div'); stripEl.className='filmstrip'; }
    placeChildren(stripEl,stripTiles);
    placeChildren(grid,[...mainEls,stripEl]);
  }else{
    if(stripEl&&stripEl.parentNode) stripEl.remove();
    placeChildren(grid,mainEls);
  }

  // Drop tiles for anyone who has left, releasing their media elements.
  const alive=new Set(ps.map(t=>t.key));
  tileEls.forEach((el,id)=>{
    if(alive.has(id)) return;
    el.querySelectorAll('video,audio').forEach(m=>{ try{ m.srcObject=null; }catch{} });
    el.remove(); tileEls.delete(id);
  });
  document.getElementById('peopleCnt').textContent=parts().length;
}
// Presentations announce themselves and take the spotlight for everyone, then
// hand it back when they end. Each client detects this from its own view of the
// room, so it works for guests too and needs no host action or data message.
const knownShares=new Set();
function syncPresentations(){
  if(!room)return;
  const live=new Set();
  parts().forEach(p=>{ if(screenPub(p)) live.add(p.identity); });

  live.forEach(id=>{
    if(knownShares.has(id)) return;
    knownShares.add(id);
    const p=parts().find(x=>x.identity===id);
    const mine=p===room.localParticipant;
    pinned=id+SCREEN_SUFFIX;                       // spotlight the presentation
    toast(mine?'You are presenting to everyone':`${(p&&(p.name||p.identity))||'Someone'} is presenting`,3600);
    if(!mine) chime('join');
  });

  knownShares.forEach(id=>{
    if(live.has(id)) return;
    knownShares.delete(id);
    // Release the spotlight only if it was still on that presentation.
    if(pinned===id+SCREEN_SUFFIX) pinned='';
  });
}

function updateSpeaking(){ document.querySelectorAll('.tile').forEach(t=>t.classList.toggle('speaking',speaking.has(t.dataset.id))); }

// ---------- host moderation ----------
// Pinning is a shared "spotlight": the host's choice is broadcast so every
// client renders the same layout, rather than being a private view preference.
function setPin(identity){
  pinned = (pinned===identity) ? '' : identity;
  publish({t:'pin', identity:pinned});
  renderGrid();
  toast(pinned?'Pinned for everyone':'Unpinned');
}

// Mute / stop-video / remove go through the API so LiveKit enforces them
// server-side; a client that ignores the request still gets muted or removed.
async function moderate(identity, action, label){
  try{
    await apiFetch('/livestreams/'+encodeURIComponent(roomId)+'/moderate',{method:'POST',body:{identity,action}});
    toast(label);
  }catch(e){ toast('Could not '+action.replace('_',' ')+': '+e.message,4000); }
}

let tileMenuFor='';
function openTileMenu(identity,name,isLocal,anchor){
  const m=document.getElementById('tileMenu'); if(!m)return;
  if(tileMenuFor===identity && m.classList.contains('open')){ closeTileMenu(); return; }
  tileMenuFor=identity;
  const p=parts().find(x=>x.identity===identity);
  const mic=p&&p.getTrackPublication(LK.Track.Source.Microphone);
  const cam=p&&p.getTrackPublication(LK.Track.Source.Camera);
  const micMuted=!mic||!mic.track||mic.isMuted;
  const camOff=!cam||!cam.track||cam.isMuted;
  const isPinned=pinned===identity;
  // The host can spotlight themselves, but muting or removing yourself from the
  // dock is what the dock is for — so those are hidden on your own tile.
  const rows=[
    `<button onclick="setPin('${identity}');closeTileMenu()"><span class="material-symbols-rounded">${isPinned?'push_pin':'push_pin'}</span>${isPinned?'Unpin':'Pin for everyone'}</button>`,
  ];
  if(!isLocal){
    // Mute and stop-video are one-way: a host can silence someone, but only that
    // person can reopen their own mic/camera (the browser will not hand the
    // device back without their gesture). So when it's already done, the row is
    // shown disabled rather than offering an "unmute" that cannot work.
    rows.push(`<button ${micMuted?'disabled':''} onclick="moderate('${identity}','mute','Muted ${esc(name)}');closeTileMenu()"><span class="material-symbols-rounded">mic_off</span>${micMuted?'Already muted':'Mute'}</button>`);
    rows.push(`<button ${camOff?'disabled':''} onclick="moderate('${identity}','stop_video','Stopped video for ${esc(name)}');closeTileMenu()"><span class="material-symbols-rounded">videocam_off</span>${camOff?'Video already off':'Pause video'}</button>`);
    rows.push(`<button class="danger" onclick="moderate('${identity}','remove','Removed ${esc(name)}');closeTileMenu()"><span class="material-symbols-rounded">person_remove</span>Remove from meeting</button>`);
  }
  m.innerHTML=`<div class="tm-head">${esc(name)}</div>`+rows.join('');
  m.classList.add('open');
  // Anchor to the button, then nudge back inside the viewport.
  const r=anchor.getBoundingClientRect();
  m.style.top=(r.bottom+6)+'px';
  m.style.left=Math.max(8,Math.min(r.right-220, window.innerWidth-232))+'px';
}
function closeTileMenu(){ const m=document.getElementById('tileMenu'); if(m){ m.classList.remove('open'); } tileMenuFor=''; }

// ---------- dock controls ----------
// Mic/cam toggles hit getUserMedia when switching ON, which can reject (denied
// or dismissed permission prompt, device busy). The flag must therefore only
// stick if the device call actually succeeded — otherwise the button state and
// the real track drift apart and the UI looks "stuck". `busy` blocks re-entry
// while the permission prompt is open, so an impatient double-tap can't flip
// the flag twice and cancel itself out.
let micBusy=false, camBusy=false;
const IS_IOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function deviceError(e,kind,on){
  const n=(e&&e.name)||'';
  if(n==='NotAllowedError'||n==='SecurityError'){
    // iOS grants camera/mic to the browser app itself, so a denial there can't
    // be undone from the page — point at the setting that actually controls it.
    return IS_IOS
      ? `${kind} blocked — turn on ${kind} for your browser in iOS Settings, then reload`
      : `${kind} blocked — allow access from the padlock in the address bar, then tap again`;
  }
  if(n==='NotFoundError') return `No ${kind.toLowerCase()} found on this device`;
  if(n==='NotReadableError') return `${kind} is in use by another app — close it and tap again`;
  return `Could not turn ${kind.toLowerCase()} ${on?'on':'off'} — tap to retry`;
}
async function toggleMic(){
  if(!room||micBusy)return;
  micBusy=true; const next=!micOn;
  try{
    await room.localParticipant.setMicrophoneEnabled(next);
    micOn=next;
  }catch(e){
    console.warn('mic toggle failed',e);
    toast(deviceError(e,'Microphone',next),4000);
  }finally{ micBusy=false; updateDock(); renderGrid(); }
}
// Turning the camera off releases the device outright rather than just muting
// the track. Muting leaves the capture open, which is why the browser's camera
// indicator stayed lit — "off" should mean the camera is genuinely not running.
// (The mic is deliberately only muted, never stopped: re-acquiring audio is what
// iOS refuses to re-prompt for, and a muted mic lights no indicator anyway.)
async function releaseCamera(){
  const pub=room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
  if(pub&&pub.track){ await room.localParticipant.unpublishTrack(pub.track,true); }
  else{ await room.localParticipant.setCameraEnabled(false); }
}
async function toggleCam(){
  if(!room||camBusy)return;
  camBusy=true; const next=!camOn;
  try{
    if(next) await room.localParticipant.setCameraEnabled(true);
    else await releaseCamera();
    camOn=next;
  }catch(e){
    console.warn('cam toggle failed',e);
    toast(deviceError(e,'Camera',next),4000);
  }finally{ camBusy=false; updateDock(); renderGrid(); }
}

// Keep the dock honest about what the tracks are actually doing. Without this a
// host-side force-mute changed the real track but not our local flag, so the
// button still read "on" and the next tap muted an already-muted mic — the user
// had to press twice to get sound back.
let _applyingLocalMedia=false;
async function syncLocalMediaState(){
  if(!room||!room.localParticipant||_applyingLocalMedia)return;
  const lp=room.localParticipant;
  const mic=lp.getTrackPublication(LK.Track.Source.Microphone);
  const cam=lp.getTrackPublication(LK.Track.Source.Camera);
  const nextMic=!!(mic&&mic.track&&!mic.isMuted);
  const nextCam=!!(cam&&cam.track&&!cam.isMuted);
  if(nextMic===micOn&&nextCam===camOn)return;

  // Camera muted from outside (host paused this person's video): drop the
  // capture too, so "paused" frees the camera instead of just freezing it.
  if(!nextCam&&camOn&&!camBusy&&cam&&cam.track&&cam.isMuted){
    try{ await releaseCamera(); }catch(e){ console.warn('release on remote pause failed',e); }
  }
  if(!nextMic&&micOn&&!micBusy){ toast('You were muted by the host',3200); }
  if(!nextCam&&camOn&&!camBusy){ toast('Your video was paused by the host',3200); }

  micOn=nextMic; camOn=nextCam;
  updateDock(); renderGrid(); renderPeople();
}
// Screen capture is a desktop-browser capability. iOS exposes no web API for it
// at all (every iOS browser is WebKit under the hood), and Chrome for Android
// doesn't implement getDisplayMedia either — the mobile Meet app does it with
// native platform APIs, which a web page cannot reach. So detect it up front and
// say so, rather than failing with a misleading "cancelled".
function canShareScreen(){
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia==='function');
}
async function toggleShare(){
  if(!room)return;
  if(!canShareScreen()){
    toast('Screen sharing needs a desktop browser — mobile browsers can’t capture the screen',5000);
    return;
  }
  const next=!sharing;
  try{
    await room.localParticipant.setScreenShareEnabled(next);
    sharing=next;
  }catch(e){
    // Picker dismissed is the common case and isn't an error worth alarming over.
    const n=(e&&e.name)||'';
    if(n==='NotAllowedError') toast('Screen share cancelled');
    else{ console.warn('screen share failed',e); toast('Could not start screen share — '+(e&&e.message||'unknown error'),4500); }
  }finally{ updateDock(); }
}
function toggleHand(){ if(!room)return; handRaised=!handRaised; if(handRaised)handsUp.add(room.localParticipant.identity); else handsUp.delete(room.localParticipant.identity); publish({t:'hand',raised:handRaised,name:room.localParticipant.name}); updateDock(); renderGrid(); renderPeople(); toast(handRaised?'You raised your hand ✋':'Hand lowered'); }
function updateDock(){
  const m=document.getElementById('dMic'),c=document.getElementById('dCam'),s=document.getElementById('dShare'),h=document.getElementById('dHand');
  m.classList.toggle('off',!micOn); m.querySelector('.material-symbols-rounded').textContent=micOn?'mic':'mic_off';
  c.classList.toggle('off',!camOn); c.querySelector('.material-symbols-rounded').textContent=camOn?'videocam':'videocam_off';
  s.classList.toggle('accent',sharing); s.querySelector('.material-symbols-rounded').textContent=sharing?'cancel_presentation':'present_to_all';
  // Unsupported on mobile browsers — show it greyed rather than pretending.
  const shareOk=canShareScreen();
  s.disabled=!shareOk;
  s.title=shareOk?(sharing?'Stop presenting':'Present'):'Screen sharing isn’t supported on mobile browsers';
  h.classList.toggle('accent',handRaised);
}

// ---------- reactions ----------
function toggleReact(){ document.getElementById('reactBar').classList.toggle('open'); document.getElementById('dReact').classList.toggle('accent'); }
function react(e){ floatEmoji(e); publish({t:'reaction',emoji:e,name:room?.localParticipant?.name}); }
function floatEmoji(e){ reactionSound(e); const st=document.querySelector('.mt-stage'); const el=document.createElement('div'); el.className='floatemoji'; el.textContent=e; el.style.left=(28+Math.random()*44)+'%'; st.appendChild(el); setTimeout(()=>el.remove(),3200); }
function publish(o){ if(!room)return; try{ room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(o)),{reliable:true}); }catch(e){ console.warn(e); } }

// ---------- panels ----------
function openPanel(w){ curPanel=w; document.getElementById('panel').classList.add('open');
  const people=w==='people';
  document.getElementById('pnlTitle').textContent=people?'People':'In-call messages';
  document.getElementById('peopleBody').style.display=people?'block':'none';
  document.getElementById('chatBody').style.display=people?'none':'block';
  document.getElementById('chatBar').style.display=people?'none':'flex';
  document.getElementById('dPeople').classList.toggle('accent',people);
  document.getElementById('dChat').classList.toggle('accent',!people);
  if(people)renderPeople(); else { unread=0; document.getElementById('chatCnt').style.display='none'; renderChat(); setTimeout(()=>document.getElementById('chatInput').focus(),40); }
}
function closePanel(){ document.getElementById('panel').classList.remove('open'); document.getElementById('dPeople').classList.remove('accent'); document.getElementById('dChat').classList.remove('accent'); curPanel=null; }
function renderPeople(){ if(!room)return; const ps=parts(); let h=`<div class="psec">In the room · ${ps.length}</div>`;
  ps.forEach(p=>{ const local=p===room.localParticipant; const mic=p.getTrackPublication(LK.Track.Source.Microphone); const muted=!mic||!mic.track||mic.isMuted;
    const hand=handsUp.has(p.identity)?'<span class="material-symbols-rounded hand">front_hand</span>':'';
    h+=`<div class="person"><div class="pav" style="${avatarStyle(p.identity)}">${esc(initials(p.name||p.identity))}</div><div class="pnm">${esc(p.name||p.identity)}${local?' (You)':''}</div><div class="pstat">${hand}<span class="material-symbols-rounded ${muted?'muted':''}">${muted?'mic_off':'mic'}</span></div></div>`; });
  document.getElementById('peopleBody').innerHTML=h;
}

// ---------- chat ----------
function grow(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,90)+'px'; }
function onChatInput(){ document.getElementById('chatSend').disabled=!document.getElementById('chatInput').value.trim(); }
function chatKey(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); } }
function sendChat(){ const inp=document.getElementById('chatInput'); const t=inp.value.trim(); if(!t)return; const nm=room?.localParticipant?.name||'You'; addChat(nm,t,true); publish({t:'chat',text:t,name:nm}); inp.value=''; grow(inp); onChatInput(); }
function addChat(name,text,mine){ chatLog.push({name,text,ts:clock(),mine}); if(curPanel==='chat')renderChat(); else { unread++; const b=document.getElementById('chatCnt'); b.style.display='flex'; b.textContent=unread; } }
function renderChat(){ const box=document.getElementById('chatMsgs'); if(!chatLog.length){ box.innerHTML='<div class="chat-empty">Messages are visible to everyone in the room and disappear when the meeting ends.</div>'; return; }
  box.innerHTML=chatLog.map(m=>`<div class="cm${m.mine?' mine':''}"><div class="cmh"><span class="cmn">${esc(m.name)}${m.mine?' (You)':''}</span><span class="cmt">${m.ts}</span></div><div class="cmx">${esc(m.text)}</div></div>`).join('');
  box.scrollTop=box.scrollHeight;
}

// ---------- share / leave ----------
function copyLink(){ navigator.clipboard?.writeText(shareUrl).then(()=>toast('Invite link copied')).catch(()=>toast('Code: '+roomId)); }
function copyShare(){ const i=document.getElementById('shareLink'); i.select(); navigator.clipboard?.writeText(i.value).then(()=>toast('Link copied — share it!')).catch(()=>{}); }
function closeShare(){ document.getElementById('shareModal').classList.remove('open'); }
function onLeaveClick(e){
  e.stopPropagation();
  // Host gets a choice (leave vs end for everyone); guests just leave.
  if(myRole==='host' && livestreamUuid){ document.getElementById('leaveMenu').classList.toggle('open'); }
  else { leaveMeeting(); }
}
function closeLeaveMenu(){ document.getElementById('leaveMenu').classList.remove('open'); }
function leaveMeeting(){ closeLeaveMenu(); if(room)room.disconnect(); }
async function endMeeting(){
  closeLeaveMenu();
  const btn=document.getElementById('lmEnd');
  try{
    await apiFetch('/livestreams/'+encodeURIComponent(livestreamUuid)+'/end-livestream');
    forgetHostMeeting();
    toast('Meeting ended for everyone');
    if(room)room.disconnect();
  }catch(e){
    // Leave the host in the room so they can retry; the room is still live.
    toast('Could not end meeting: '+e.message,4500);
  }
}
function cleanup(){ tileEls.forEach(el=>{ el.querySelectorAll('video,audio').forEach(m=>{try{m.srcObject=null;}catch{}}); el.remove(); }); tileEls.clear(); if(stripEl){ stripEl.remove(); stripEl=null; }
  room=null; sharing=false; handRaised=false; knownShares.clear(); livestreamUuid=''; myRole='guest'; pinned=''; closeTileMenu(); handsUp.clear(); speaking.clear(); chatLog.length=0; unread=0;
  document.getElementById('grid').innerHTML=''; closePanel(); closeLeaveMenu(); document.getElementById('shareModal').classList.remove('open');
  ['btnGuestJoin','btnStart'].forEach(id=>{const b=document.getElementById(id); if(b)b.disabled=false;});
  document.getElementById('btnGuestJoin').innerHTML='<span class="material-symbols-rounded">login</span> Join now';
  document.getElementById('btnStart').innerHTML='<span class="material-symbols-rounded">rocket_launch</span> Start meeting';
  show('landing'); refreshRejoinCard(); toast('You left the meeting');
}

// ---------- deep link ?room= ----------
(function(){
  const r=new URLSearchParams(location.search).get('room');
  if(r){ checkAndProceed(r); return; }
  // No deep link — surface a meeting this browser started and never ended.
  refreshRejoinCard();
})();
document.addEventListener('click',e=>{ const tm=document.getElementById('tileMenu');
  if(tm&&tm.classList.contains('open')&&!tm.contains(e.target)&&!e.target.closest('.tmore')) closeTileMenu();
  const m=document.getElementById('leaveMenu'); if(m.classList.contains('open') && !m.contains(e.target) && !e.target.closest('.dbtn.leave')) closeLeaveMenu(); });
window.addEventListener('beforeunload',()=>{ if(room)room.disconnect(); stopPreview(); });
// The grid's column count depends on viewport/orientation, so re-lay it out on
// rotate or resize. Debounced because iOS fires resize repeatedly mid-rotation.
let _relayout;
window.addEventListener('resize',()=>{ clearTimeout(_relayout); _relayout=setTimeout(()=>{ if(room)renderGrid(); },150); });
