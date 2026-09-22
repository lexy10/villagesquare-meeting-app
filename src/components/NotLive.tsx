import * as app from '../engine';

export default function NotLive() {
  return (
    <div className="screen cardscreen" id="notlive">
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="brandrow" style={{ justifyContent: 'center' }}><div className="vsmark sm"><img src="logo.png" alt="VillageSquare" /></div><div className="wordmark" style={{ fontSize: '16px' }}><b>villagesquare</b> <span className="meet">meet</span></div></div>
        <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: '#eef3fb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px auto 18px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '38px', color: '#9fb0c7' }}>bedtime</span>
        </div>
        <h2>This room isn’t live</h2>
        <p className="csub" style={{ maxWidth: '320px', margin: '8px auto 0' }}>Nobody has this meeting running right now. Once the host starts it, this same link will let you straight in.</p>
        <div className="rmeta" style={{ color: 'var(--muted)', fontSize: '14px', marginTop: '16px', fontFamily: "'Inter'" }}>Room <b id="nlRoom" style={{ color: 'var(--ink)' }}>—</b></div>
        <button className="btn-primary" id="btnCheckAgain" onClick={() => app.checkAgain()} style={{ width: '100%', marginTop: '24px' }}><span className="material-symbols-rounded">refresh</span> Check again</button>
        <div className="back"><button onClick={() => app.show('landing')}>← Back to home</button></div>
      </div>
    </div>
  );
}
