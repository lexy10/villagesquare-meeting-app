import * as app from '../engine';

export default function HostSetup() {
  return (
    <div className="screen" id="hostSetup">
      <div className="pj-top">
        <button className="iconbtn" onClick={() => app.cancelHostSetup()}><span className="material-symbols-rounded">arrow_back</span></button>
        <div className="vsmark sm"><img src="logo.png" alt="VillageSquare" /></div>
        <div className="wordmark" style={{ fontSize: '16px' }}><b>villagesquare</b> <span className="meet">meet</span></div>
      </div>
      <div className="pj-body">
        <div className="pj-preview">
          <video id="hsVideo" autoPlay playsInline muted ref={v => { if (v) v.muted = true; }}></video>
          <div className="pj-off" id="hsOff"><div className="av" id="hsAv">?</div><div>Camera is off</div></div>
          <div className="pj-tag">You (host)</div>
          <div className="pj-ctrls">
            <button className="pj-cbtn" id="hsMicBtn" onClick={() => app.pjMic()} title="Microphone"><span className="material-symbols-rounded">mic</span></button>
            <button className="pj-cbtn" id="hsCamBtn" onClick={() => app.pjCam()} title="Camera"><span className="material-symbols-rounded">videocam</span></button>
          </div>
        </div>
        <div className="pj-right">
          <div className="eyebrow">Start a meeting</div>
          <h2>Name your meeting</h2>
          <div className="rmeta">You’ll get a shareable link right after</div>
          <input className="name" id="mTitle" placeholder="e.g. Village Standup" defaultValue="VillageSquare Meeting" onKeyDown={e => { if (e.key === 'Enter') app.startMeeting(); }} />
          <div className="err" id="startErr"></div>
          <button className="btn-primary" id="btnStart" onClick={() => app.startMeeting()}><span className="material-symbols-rounded">rocket_launch</span> Start meeting</button>
          <p className="pj-hint">You’ll join with the camera and mic settings you pick here.</p>
        </div>
      </div>
    </div>
  );
}
