import { AppProvider, useApp } from './app/AppContext';
import HostSetup from './components/HostSetup';
import HostSignin from './components/HostSignin';
import Landing from './components/Landing';
import Meeting from './components/meeting/Meeting';
import NotLive from './components/NotLive';
import { AudioGate, ShareModal, Toast } from './components/Overlays';
import Prejoin from './components/Prejoin';

function Screen() {
  const { screen } = useApp();
  switch (screen) {
    case 'hostSignin': return <HostSignin />;
    case 'hostSetup': return <HostSetup />;
    case 'prejoin': return <Prejoin />;
    case 'notlive': return <NotLive />;
    case 'meeting': return <Meeting />;
    default: return <Landing />;
  }
}

export default function App() {
  return (
    <AppProvider>
      <Screen />
      <ShareModal />
      <Toast />
      <AudioGate />
    </AppProvider>
  );
}
