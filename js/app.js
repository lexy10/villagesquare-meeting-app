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
function goHostSignin(){ if(accessToken){ show('hostSetup'); } else { show('hostSignin'); setTimeout(()=>document.getElementById('hEmail').focus(),50); } }
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
    show('hostSetup'); setTimeout(()=>document.getElementById('mTitle').select(),50);
  }catch(e){ err.textContent=e.message; err.classList.add('show'); }
  finally{ btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">login</span> Sign in'; }
}

// ---------- host: start meeting ----------
async function startMeeting(){
  const title=document.getElementById('mTitle').value.trim()||'VillageSquare Meeting';
  const err=document.getElementById('startErr'); err.classList.remove('show');
  const btn=document.getElementById('btnStart'); btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Starting…';
  let seed=null;
  try{
    // Capture before any other await, while still inside the click gesture:
    // iOS only shows the camera/mic sheet for a gesture-initiated getUserMedia,
    // and the granted tracks are then reused for the whole session.
    try{ seed=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); }
    catch(e){ console.warn('host media capture failed',e); camOn=false; micOn=false; toast('Starting without camera/mic — you can enable them in the meeting.',4000); }
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
  document.getElementById('pjRoom').textContent=pendingRoom;
  document.getElementById('pjTitle').textContent=pendingTitle?('Join “'+pendingTitle+'”'):'Join the meeting';
  document.getElementById('pjName').value=localStorage.getItem('vsm_name')||'';
  onPjName(); updatePjTag(); show('prejoin'); startPreview();
}
async function startPreview(){
  stopPreview();
  try{ pjStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); document.getElementById('pjVideo').srcObject=pjStream; applyPj(); }
  catch{ pjCamOn=false; pjMicOn=false; document.getElementById('pjOff').classList.add('show'); updatePjBtns(); toast('Camera/mic unavailable — you can still join.'); }
}
function stopPreview(){ if(pjStream){ pjStream.getTracks().forEach(t=>t.stop()); pjStream=null; } detachPreview(); }
// Release the <video> element WITHOUT stopping the tracks — used when the
// preview stream is being handed to LiveKit instead of discarded.
function detachPreview(){ const v=document.getElementById('pjVideo'); if(v){ try{ v.srcObject=null; }catch{} } }
function applyPj(){ if(!pjStream)return; pjStream.getVideoTracks().forEach(t=>t.enabled=pjCamOn); pjStream.getAudioTracks().forEach(t=>t.enabled=pjMicOn); document.getElementById('pjOff').classList.toggle('show',!pjCamOn); updatePjBtns(); }
function updatePjBtns(){ const m=document.getElementById('pjMicBtn'),c=document.getElementById('pjCamBtn'); m.classList.toggle('off',!pjMicOn); m.querySelector('.material-symbols-rounded').textContent=pjMicOn?'mic':'mic_off'; c.classList.toggle('off',!pjCamOn); c.querySelector('.material-symbols-rounded').textContent=pjCamOn?'videocam':'videocam_off'; }
function pjMic(){ pjMicOn=!pjMicOn; applyPj(); }
function pjCam(){ pjCamOn=!pjCamOn; applyPj(); }
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
  const at=seed&&seed.getAudioTracks&&seed.getAudioTracks()[0];
  const vt=seed&&seed.getVideoTracks&&seed.getVideoTracks()[0];
  if(at||vt){
    try{
      if(at) await room.localParticipant.publishTrack(at,{source:LK.Track.Source.Microphone});
      if(vt) await room.localParticipant.publishTrack(vt,{source:LK.Track.Source.Camera});
      // Publish first, then apply the user's pre-join choices as mute state, so
      // a guest who joined muted can still unmute later without a new capture.
      await room.localParticipant.setMicrophoneEnabled(micOn).catch(()=>{});
      await room.localParticipant.setCameraEnabled(camOn).catch(()=>{});
      return;
    }catch(e){
      console.warn('reusing pre-join tracks failed, capturing fresh',e);
      try{ seed.getTracks().forEach(t=>t.stop()); }catch{}
    }
  }
  await room.localParticipant.setCameraEnabled(camOn).catch(()=>{});
  await room.localParticipant.setMicrophoneEnabled(micOn).catch(()=>{});
}

async function connectRoom(token, displayName, title, seedStream){
  room=new LK.Room({adaptiveStream:true,dynacast:true});
  ['ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished']
    .forEach(ev=>room.on(LK.RoomEvent[ev],()=>{renderGrid();renderPeople();}));
  // Mirror server-side (host) mutes into our own control state.
  ['TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished']
    .forEach(ev=>room.on(LK.RoomEvent[ev],(_a,p)=>{ if(!p||p===room.localParticipant) syncLocalMediaState(); }));
  room.on(LK.RoomEvent.ParticipantConnected,p=>{chime('join');toast((p.name||p.identity)+' joined');
    // Someone who arrives after a pin was set would otherwise see no spotlight.
    if(myRole==='host'&&pinned) setTimeout(()=>publish({t:'pin',identity:pinned}),600);});
  room.on(LK.RoomEvent.ParticipantDisconnected,p=>{chime('leave');handsUp.delete(p.identity);speaking.delete(p.identity);
    // Drop the spotlight if the pinned person is the one who left.
    if(pinned===p.identity){ pinned=''; if(myRole==='host') publish({t:'pin',identity:''}); }
    if(tileMenuFor===p.identity) closeTileMenu();
    toast((p.name||p.identity)+' left');});
  room.on(LK.RoomEvent.ActiveSpeakersChanged,s=>{speaking.clear();s.forEach(p=>speaking.add(p.identity));updateSpeaking();});
  room.on(LK.RoomEvent.Disconnected,()=>cleanup());
  room.on(LK.RoomEvent.DataReceived,(payload,p)=>{ try{ handleData(JSON.parse(new TextDecoder().decode(payload)),p);}catch{} });
  await room.connect(livekitUrl.trim(), token);
  await publishLocalMedia(seedStream);
  document.getElementById('mtTitle').textContent=title||'Meeting';
  document.getElementById('mtCode').textContent=roomId;
  show('meeting'); renderGrid(); renderPeople(); updateDock();
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
function renderGrid(){
  if(!room)return; const grid=document.getElementById('grid');
  grid.querySelectorAll('video,audio').forEach(el=>{try{el.srcObject=null;}catch{}el.remove();}); grid.innerHTML='';
  const ps=parts();
  const phone=isPhonePortrait();
  // A pinned participant is hoisted to the front and given a full-width row;
  // everyone else shares a smaller strip beneath it.
  const pinIdx = pinned ? ps.findIndex(p=>p.identity===pinned) : -1;
  const hasPin = pinIdx>=0;
  if(hasPin) ps.unshift(ps.splice(pinIdx,1)[0]);
  const n=ps.length;
  let c, centred=false, rowCount=1;
  grid.classList.toggle('pinned',hasPin);
  if(!hasPin) grid.classList.remove('pin-portrait');
  if(hasPin){
    // Layout is flexbox in CSS (spotlight + filmstrip), so clear any grid
    // template left over from the un-pinned view.
    grid.style.gridTemplateColumns=''; grid.style.gridTemplateRows='';
    grid.style.height='100%'; grid.style.maxWidth='100%'; grid.style.aspectRatio='auto';
  }else{
    c=cols(n); const r=Math.ceil(n/c);
    grid.style.gridTemplateColumns=`repeat(${c},1fr)`;
    if(phone){
      // Phones keep each tile at a readable shape (set in CSS) and let the strip
      // scroll instead of squashing everyone into slivers to fit one screenful.
      grid.style.gridTemplateRows=`repeat(${r},auto)`;
      grid.style.height='auto'; grid.style.maxWidth='100%'; grid.style.aspectRatio='auto';
    }else{
      // Twice as many columns as tiles, each tile spanning two: a row with
      // fewer tiles than the rest can then start on a half-column and sit
      // centred (5 people = 3 up, 2 centred underneath) instead of hugging
      // the left with a hole on the right.
      grid.style.gridTemplateColumns=`repeat(${c*2},1fr)`;
      grid.style.gridTemplateRows=`repeat(${r},1fr)`;
      grid.style.maxWidth=n<=1?'960px':'100%'; grid.style.aspectRatio=n<=1?'16/9':'auto'; grid.style.height='100%';
      centred=true; rowCount=r;
    }
  }
  // Everyone except the spotlight goes into a scrollable filmstrip.
  const strip = hasPin ? document.createElement('div') : null;
  if(strip) strip.className='filmstrip';
  ps.forEach((p,i)=>{
    const local=p===room.localParticipant;
    const isPinned=hasPin&&i===0;
    const tile=document.createElement('div'); tile.className='tile'+(local?' local':'')+(speaking.has(p.identity)?' speaking':'')+(isPinned?' pin':''); tile.dataset.id=p.identity;
    if(centred){
      const row=Math.floor(i/c), inRow=i%c;
      const isLastRow=row===rowCount-1;
      const inThisRow=isLastRow ? n-(rowCount-1)*c : c;   // tiles sharing this row
      tile.style.gridColumn=`${(c-inThisRow)+1+2*inRow} / span 2`;
    }
    const scr=p.getTrackPublication(LK.Track.Source.ScreenShare), cam=p.getTrackPublication(LK.Track.Source.Camera);
    let vt=null,isScr=false;
    if(scr&&scr.track&&!scr.isMuted){vt=scr.track;isScr=true;} else if(cam&&cam.track&&!cam.isMuted){vt=cam.track;}
    if(vt){ const v=vt.attach(); v.autoplay=true;v.playsInline=true;v.muted=true; if(isScr){tile.classList.add('screen');tile.classList.remove('local');} tile.appendChild(v);
      // Shape the spotlight to whatever the sender is actually publishing, so a
      // phone in portrait doesn't get letterboxed into a landscape box (and a
      // desktop share doesn't get a tall one). Publication dimensions are known
      // up front for remote tracks; the video element is the fallback and the
      // correction if the sender rotates mid-call.
      if(isPinned){
        // Portrait spotlights are narrow, which frees a lot of width — the grid
        // gets a class so the filmstrip can widen into two columns instead of
        // leaving a dead band down the middle.
        const setAR=(w,h)=>{ if(w&&h){ tile.style.setProperty('--pin-ar', w+'/'+h); grid.classList.toggle('pin-portrait', h>w); } };
        const dim=(isScr?scr:cam)&&(isScr?scr:cam).dimensions;
        if(dim) setAR(dim.width,dim.height);
        v.addEventListener('loadedmetadata',()=>setAR(v.videoWidth,v.videoHeight));
        v.addEventListener('resize',()=>setAR(v.videoWidth,v.videoHeight));
      }
    }
    else { const a=document.createElement('div');a.className='tav';a.style.cssText=avatarStyle(p.identity);a.textContent=initials(p.name||p.identity);tile.appendChild(a); }
    const hand=document.createElement('div');hand.className='thand'+(handsUp.has(p.identity)?' show':'');hand.textContent='✋';tile.appendChild(hand);
    const mic=p.getTrackPublication(LK.Track.Source.Microphone); const muted=!mic||!mic.track||mic.isMuted;
    const label=document.createElement('div');label.className='tname';
    label.innerHTML=(muted?'<span class="material-symbols-rounded">mic_off</span>':'')+`<span class="nm">${esc(p.name||p.identity)}</span>`+(local?'<span class="badge-you">YOU</span>':'');
    tile.appendChild(label);
    if(!local&&mic&&mic.track&&!mic.isMuted){const au=mic.track.attach();au.style.display='none';tile.appendChild(au);}
    if(isPinned){ const pb=document.createElement('div'); pb.className='tpin'; pb.innerHTML='<span class="material-symbols-rounded">push_pin</span>'; tile.appendChild(pb); }
    // Moderation is host-only; guests get no menu button at all.
    if(myRole==='host'){
      const mb=document.createElement('button'); mb.className='tmore'; mb.title='Participant options';
      mb.innerHTML='<span class="material-symbols-rounded">more_vert</span>';
      mb.onclick=(ev)=>{ ev.stopPropagation(); openTileMenu(p.identity, p.name||p.identity, local, ev.currentTarget); };
      tile.appendChild(mb);
    }
    (isPinned||!strip ? grid : strip).appendChild(tile);
  });
  if(strip&&strip.children.length) grid.appendChild(strip);
  document.getElementById('peopleCnt').textContent=n;
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
    rows.push(`<button onclick="moderate('${identity}','${micMuted?'unmute':'mute'}','${micMuted?'Asked to unmute':'Muted'} ${esc(name)}');closeTileMenu()"><span class="material-symbols-rounded">${micMuted?'mic':'mic_off'}</span>${micMuted?'Unmute':'Mute'}</button>`);
    rows.push(`<button onclick="moderate('${identity}','${camOff?'start_video':'stop_video'}','${camOff?'Asked to start video':'Stopped video for'} ${esc(name)}');closeTileMenu()"><span class="material-symbols-rounded">${camOff?'videocam':'videocam_off'}</span>${camOff?'Start video':'Stop video'}</button>`);
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
async function syncLocalMediaState(){
  if(!room||!room.localParticipant)return;
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
async function toggleShare(){ if(!room)return; try{ sharing=!sharing; await room.localParticipant.setScreenShareEnabled(sharing); updateDock(); }catch{ sharing=false; updateDock(); toast('Screen share cancelled'); } }
function toggleHand(){ if(!room)return; handRaised=!handRaised; if(handRaised)handsUp.add(room.localParticipant.identity); else handsUp.delete(room.localParticipant.identity); publish({t:'hand',raised:handRaised,name:room.localParticipant.name}); updateDock(); renderGrid(); renderPeople(); toast(handRaised?'You raised your hand ✋':'Hand lowered'); }
function updateDock(){
  const m=document.getElementById('dMic'),c=document.getElementById('dCam'),s=document.getElementById('dShare'),h=document.getElementById('dHand');
  m.classList.toggle('off',!micOn); m.querySelector('.material-symbols-rounded').textContent=micOn?'mic':'mic_off';
  c.classList.toggle('off',!camOn); c.querySelector('.material-symbols-rounded').textContent=camOn?'videocam':'videocam_off';
  s.classList.toggle('accent',sharing); s.querySelector('.material-symbols-rounded').textContent=sharing?'cancel_presentation':'present_to_all';
  h.classList.toggle('accent',handRaised);
}

// ---------- reactions ----------
function toggleReact(){ document.getElementById('reactBar').classList.toggle('open'); document.getElementById('dReact').classList.toggle('accent'); }
function react(e){ floatEmoji(e); publish({t:'reaction',emoji:e,name:room?.localParticipant?.name}); }
function floatEmoji(e){ const st=document.querySelector('.mt-stage'); const el=document.createElement('div'); el.className='floatemoji'; el.textContent=e; el.style.left=(28+Math.random()*44)+'%'; st.appendChild(el); setTimeout(()=>el.remove(),3200); }
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
function cleanup(){ room=null; sharing=false; handRaised=false; livestreamUuid=''; myRole='guest'; pinned=''; closeTileMenu(); handsUp.clear(); speaking.clear(); chatLog.length=0; unread=0;
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
