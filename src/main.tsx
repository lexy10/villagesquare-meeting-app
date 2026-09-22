import { createRoot } from 'react-dom/client';
import App from './App';

// Reuse the original stylesheet VERBATIM (imported, never edited) + the one new
// stylesheet for the added audio-gate affordance.
import '../css/styles.css';
import './audio-gate.css';

// No <StrictMode>: the engine's startup (initEngine) wires listeners, timers and
// the deep-link check once, mirroring the original single-run app.js. It is also
// guarded to be idempotent, but we avoid the dev-only double-invoke regardless.
createRoot(document.getElementById('root')!).render(<App />);
