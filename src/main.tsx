import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// The original stylesheet, unchanged, plus the few rules the React version adds.
import '../css/styles.css';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
