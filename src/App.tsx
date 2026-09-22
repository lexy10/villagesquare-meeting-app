import { useEffect } from 'react';
import Landing from './components/Landing';
import HostSignin from './components/HostSignin';
import HostSetup from './components/HostSetup';
import Prejoin from './components/Prejoin';
import NotLive from './components/NotLive';
import Meeting from './components/Meeting';
import ShareModal from './components/ShareModal';
import * as app from './engine';

// App renders the exact markup from the original index.html ONCE (every screen
// is present in the DOM, toggled via the `.active` class exactly like before).
// The imperative engine then drives that DOM. React owns the initial paint; the
// engine owns all runtime mutation — mirroring how the vanilla app worked.
export default function App() {
  useEffect(() => {
    app.initEngine();
  }, []);

  return (
    <>
      <Landing />
      <HostSignin />
      <HostSetup />
      <Prejoin />
      <NotLive />
      <Meeting />

      {/* share modal + toast are body-level siblings in the original */}
      <ShareModal />
      <div id="toast"></div>

      {/* NEW: audio-gate affordance (autoplay fix "a") */}
      <button id="audioGate" className="audio-gate" onClick={() => app.enableAudio()}>
        <span className="material-symbols-rounded">volume_up</span> Tap to enable sound
      </button>
    </>
  );
}
