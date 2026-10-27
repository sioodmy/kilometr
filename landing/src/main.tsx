import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initWebLocale } from './i18n';

if (window.location.pathname === '/trip/' || window.location.pathname === '/trip') {
  window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
}

initWebLocale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
