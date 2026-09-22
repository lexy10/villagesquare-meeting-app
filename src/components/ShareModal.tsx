import * as app from '../engine';

export default function ShareModal() {
  return (
    <div className="modalback" id="shareModal">
      <div className="sharecard">
        <div className="ok"><span className="material-symbols-rounded">check</span></div>
        <h2>Your meeting is live</h2>
        <p>Share this link — anyone who opens it just types their name to join.</p>
        <div className="linkbox"><input id="shareLink" readOnly /><button onClick={() => app.copyShare()}>Copy link</button></div>
        <div className="codebig">Meeting code · <b id="shareCode">—</b></div>
        <button className="btn-primary enter" onClick={() => app.closeShare()}><span className="material-symbols-rounded">meeting_room</span> Enter meeting</button>
      </div>
    </div>
  );
}
