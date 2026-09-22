import * as app from '../engine';

export default function Prejoin() {
  return (
    <div className="screen" id="prejoin">
      <div className="pj-top">
        <button className="iconbtn" onClick={() => app.leavePrejoin()}><span className="material-symbols-rounded">arrow_back</span></button>
        <div className="vsmark sm"><img src="logo.png" alt="VillageSquare" /></div>
        <div className="wordmark" style={{ fontSize: '16px' }}><b>villagesquare</b> <span className="meet">meet</span></div>
      </div>
      <div className="pj-body">
        <div className="pj-preview">
          <video id="pjVideo" autoPlay playsInline muted ref={v => { if (v) v.muted = true; }}></video>
          <div className="pj-off" id="pjOff"><div className="av" id="pjAv">?</div><div>Camera is off</div></div>
          <div className="pj-tag" id="pjTag">You</div>
          <div className="pj-ctrls">
            <button className="pj-cbtn" id="pjMicBtn" onClick={() => app.pjMic()}><span className="material-symbols-rounded">mic</span></button>
            <button className="pj-cbtn" id="pjCamBtn" onClick={() => app.pjCam()}><span className="material-symbols-rounded">videocam</span></button>
          </div>
        </div>
        <div className="pj-right">
          <div className="eyebrow">You're invited</div>
          <h2 id="pjTitle">Join the meeting</h2>
          <div className="rmeta">Room <b id="pjRoom">—</b></div>
          <input className="name" id="pjName" placeholder="What's your name?" onInput={() => app.onPjName()} onKeyDown={e => { if (e.key === 'Enter') app.guestJoin(); }} />
          <button className="btn-primary" id="btnGuestJoin" onClick={() => app.guestJoin()} disabled><span className="material-symbols-rounded">login</span> Join now</button>
          <div className="pj-hint">Your camera and mic stay off until you’re in — you’re in control.</div>
        </div>
      </div>
    </div>
  );
}
