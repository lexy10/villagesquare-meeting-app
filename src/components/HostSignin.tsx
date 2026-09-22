import * as app from '../engine';

export default function HostSignin() {
  return (
    <div className="screen cardscreen" id="hostSignin">
      <div className="card">
        <div className="brandrow"><div className="vsmark sm"><img src="logo.png" alt="VillageSquare" /></div><div className="wordmark" style={{ fontSize: '16px' }}><b>villagesquare</b> <span className="meet">meet</span></div></div>
        <h2>Sign in to host</h2>
        <p className="csub">Only the host signs in. Everyone you invite joins with just their name.</p>
        <div className="field"><label>Email or username</label><input id="hEmail" placeholder="you@villagesquare.io" autoComplete="username" /></div>
        <div className="field"><label>Password</label><input id="hPass" type="password" placeholder="••••••••" autoComplete="current-password" onKeyDown={e => { if (e.key === 'Enter') app.doLogin(); }} /></div>
        <div className="err" id="loginErr"></div>
        <button className="btn-primary" id="btnLogin" onClick={() => app.doLogin()}><span className="material-symbols-rounded">login</span> Sign in</button>
        <div className="back"><button onClick={() => app.show('landing')}>← Back</button></div>
      </div>
    </div>
  );
}
