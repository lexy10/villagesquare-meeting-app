const LK = window.LivekitClient;

// ---------- backend (fixed: staging) ----------
const API_BASE = 'https://staging-api.villagesquare.io/v2';
function apiBase(){ return API_BASE; }

// ---------- state ----------
let accessToken='';               // host bearer (from login)
let room=null, myRole='guest', roomId='', livekitUrl='', shareUrl='', livestreamUuid='';
let camOn=true, micOn=true, sharing=false, handRaised=false;
let curPanel=null, unread=0;
const chatLog=[]; const handsUp=new Set(); const speaking=new Set();
let pjStream=null, pjCamOn=true, pjMicOn=true, pendingRoom='';

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
    show('hostSetup'); setTimeout(()=>document.getElementById('mTitle').select(),50);
  }catch(e){ err.textContent=e.message; err.classList.add('show'); }
  finally{ btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">login</span> Sign in'; }
}

// ---------- host: start meeting ----------
async function startMeeting(){
  const title=document.getElementById('mTitle').value.trim()||'VillageSquare Meeting';
  const err=document.getElementById('startErr'); err.classList.remove('show');
  const btn=document.getElementById('btnStart'); btn.disabled=true; btn.innerHTML='<span class="material-symbols-rounded">progress_activity</span> Starting…';
  try{
    const fd=new FormData(); fd.append('title',title); fd.append('category_id','38'); fd.append('privacy','everyone');
    const d=await apiFetch('/livestreams/start',{method:'POST',multipart:true,body:fd});
    roomId = d.room_id; livekitUrl = d.livekit_url; livestreamUuid = d.uuid; myRole='host';
    const hostToken = d.token;
    if(!hostToken||!livekitUrl) throw new Error('Meeting started but no media token was returned');
    shareUrl = location.origin+location.pathname+'?room='+encodeURIComponent(roomId);
    // connect
    await connectRoom(hostToken, myName()||'Host', title);
    // show share modal
    document.getElementById('shareLink').value=shareUrl;
    document.getElementById('shareCode').textContent=roomId;
    document.getElementById('shareModal').classList.add('open');
  }catch(e){ err.textContent=e.message; err.classList.add('show'); btn.disabled=false; btn.innerHTML='<span class="material-symbols-rounded">rocket_launch</span> Start meeting'; }
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
function stopPreview(){ if(pjStream){ pjStream.getTracks().forEach(t=>t.stop()); pjStream=null; } }
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
  try{
    const d=await apiFetch('/livestreams/'+encodeURIComponent(pendingRoom)+'/guest-token',{method:'POST',auth:false,body:{name}});
    roomId=d.room_id; livekitUrl=d.livekit_url; shareUrl=location.origin+location.pathname+'?room='+encodeURIComponent(roomId);
    if(!d.token||!livekitUrl) throw new Error('No media token returned');
    stopPreview();
    await connectRoom(d.token, name, 'Meeting');
  }catch(e){
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
async function connectRoom(token, displayName, title){
  room=new LK.Room({adaptiveStream:true,dynacast:true});
  ['ParticipantConnected','ParticipantDisconnected','TrackSubscribed','TrackUnsubscribed','TrackMuted','TrackUnmuted','LocalTrackPublished','LocalTrackUnpublished']
    .forEach(ev=>room.on(LK.RoomEvent[ev],()=>{renderGrid();renderPeople();}));
  room.on(LK.RoomEvent.ParticipantConnected,p=>{chime('join');toast((p.name||p.identity)+' joined');});
  room.on(LK.RoomEvent.ParticipantDisconnected,p=>{chime('leave');handsUp.delete(p.identity);speaking.delete(p.identity);toast((p.name||p.identity)+' left');});
  room.on(LK.RoomEvent.ActiveSpeakersChanged,s=>{speaking.clear();s.forEach(p=>speaking.add(p.identity));updateSpeaking();});
  room.on(LK.RoomEvent.Disconnected,()=>cleanup());
  room.on(LK.RoomEvent.DataReceived,(payload,p)=>{ try{ handleData(JSON.parse(new TextDecoder().decode(payload)),p);}catch{} });
  await room.connect(livekitUrl.trim(), token);
  await room.localParticipant.setCameraEnabled(camOn).catch(()=>{});
  await room.localParticipant.setMicrophoneEnabled(micOn).catch(()=>{});
  document.getElementById('mtTitle').textContent=title||'Meeting';
  document.getElementById('mtCode').textContent=roomId;
  show('meeting'); renderGrid(); renderPeople(); updateDock();
  toast('You joined the meeting');
}

function handleData(d,p){ const who=p?(p.name||p.identity):'Someone';
  if(d.t==='chat') addChat(d.name||who,d.text);
  else if(d.t==='reaction') floatEmoji(d.emoji);
  else if(d.t==='hand'){ if(d.raised)handsUp.add(p?.identity); else handsUp.delete(p?.identity); renderGrid(); renderPeople(); if(d.raised)toast((d.name||who)+' raised their hand ✋'); }
}

// ---------- grid ----------
function parts(){ return room?[room.localParticipant,...room.remoteParticipants.values()]:[]; }
function cols(n){ return n<=1?1:n<=4?2:n<=9?3:4; }
function renderGrid(){
  if(!room)return; const grid=document.getElementById('grid');
  grid.querySelectorAll('video,audio').forEach(el=>{try{el.srcObject=null;}catch{}el.remove();}); grid.innerHTML='';
  const ps=parts(), n=ps.length, c=cols(n), r=Math.ceil(n/c);
  grid.style.gridTemplateColumns=`repeat(${c},1fr)`; grid.style.gridTemplateRows=`repeat(${r},1fr)`;
  grid.style.maxWidth=n<=1?'960px':'100%'; grid.style.aspectRatio=n<=1?'16/9':'auto'; grid.style.height='100%';
  ps.forEach((p,i)=>{
    const local=p===room.localParticipant;
    const tile=document.createElement('div'); tile.className='tile'+(local?' local':'')+(speaking.has(p.identity)?' speaking':''); tile.dataset.id=p.identity;
    if(n===3&&i===0)tile.style.gridColumn='1 / -1';
    const scr=p.getTrackPublication(LK.Track.Source.ScreenShare), cam=p.getTrackPublication(LK.Track.Source.Camera);
    let vt=null,isScr=false;
    if(scr&&scr.track&&!scr.isMuted){vt=scr.track;isScr=true;} else if(cam&&cam.track&&!cam.isMuted){vt=cam.track;}
    if(vt){ const v=vt.attach(); v.autoplay=true;v.playsInline=true;v.muted=true; if(isScr){tile.classList.add('screen');tile.classList.remove('local');} tile.appendChild(v); }
    else { const a=document.createElement('div');a.className='tav';a.textContent=initials(p.name||p.identity);tile.appendChild(a); }
    const hand=document.createElement('div');hand.className='thand'+(handsUp.has(p.identity)?' show':'');hand.textContent='✋';tile.appendChild(hand);
    const mic=p.getTrackPublication(LK.Track.Source.Microphone); const muted=!mic||!mic.track||mic.isMuted;
    const label=document.createElement('div');label.className='tname';
    label.innerHTML=(muted?'<span class="material-symbols-rounded">mic_off</span>':'')+`<span class="nm">${esc(p.name||p.identity)}</span>`+(local?'<span class="badge-you">YOU</span>':'');
    tile.appendChild(label);
    if(!local&&mic&&mic.track&&!mic.isMuted){const au=mic.track.attach();au.style.display='none';tile.appendChild(au);}
    grid.appendChild(tile);
  });
  document.getElementById('peopleCnt').textContent=n;
}
function updateSpeaking(){ document.querySelectorAll('.tile').forEach(t=>t.classList.toggle('speaking',speaking.has(t.dataset.id))); }

// ---------- dock controls ----------
async function toggleMic(){ if(!room)return; micOn=!micOn; await room.localParticipant.setMicrophoneEnabled(micOn); updateDock(); renderGrid(); }
async function toggleCam(){ if(!room)return; camOn=!camOn; await room.localParticipant.setCameraEnabled(camOn); updateDock(); renderGrid(); }
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
    h+=`<div class="person"><div class="pav">${esc(initials(p.name||p.identity))}</div><div class="pnm">${esc(p.name||p.identity)}${local?' (You)':''}</div><div class="pstat">${hand}<span class="material-symbols-rounded ${muted?'muted':''}">${muted?'mic_off':'mic'}</span></div></div>`; });
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
    toast('Meeting ended for everyone');
    if(room)room.disconnect();
  }catch(e){
    // Leave the host in the room so they can retry; the room is still live.
    toast('Could not end meeting: '+e.message,4500);
  }
}
function cleanup(){ room=null; sharing=false; handRaised=false; livestreamUuid=''; myRole='guest'; handsUp.clear(); speaking.clear(); chatLog.length=0; unread=0;
  document.getElementById('grid').innerHTML=''; closePanel(); closeLeaveMenu(); document.getElementById('shareModal').classList.remove('open');
  ['btnGuestJoin','btnStart'].forEach(id=>{const b=document.getElementById(id); if(b)b.disabled=false;});
  document.getElementById('btnGuestJoin').innerHTML='<span class="material-symbols-rounded">login</span> Join now';
  document.getElementById('btnStart').innerHTML='<span class="material-symbols-rounded">rocket_launch</span> Start meeting';
  show('landing'); toast('You left the meeting');
}

// ---------- deep link ?room= ----------
(function(){ const r=new URLSearchParams(location.search).get('room'); if(r){ checkAndProceed(r); } })();
document.addEventListener('click',e=>{ const m=document.getElementById('leaveMenu'); if(m.classList.contains('open') && !m.contains(e.target) && !e.target.closest('.dbtn.leave')) closeLeaveMenu(); });
window.addEventListener('beforeunload',()=>{ if(room)room.disconnect(); stopPreview(); });
