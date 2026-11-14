import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initWebLocale } from './i18n';

if (window.location.pathname === '/t/' || window.location.pathname === '/t') {
  const h = window.location.hash.slice(1);
  const nextHash = h && !h.includes('=') ? `#t=${h}` : window.location.hash;
  window.history.replaceState(null, '', `/${window.location.search}${nextHash}`);
}

initWebLocale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
