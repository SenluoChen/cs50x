import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { warmPlotsCacheInBackground } from './utils/localPlots';

import reportWebVitals from './reportWebVitals';

// Global safety: catch uncaught errors and promise rejections to avoid a white
// screen when browser blocks access to storage (Tracking Prevention) or other
// runtime errors occur.
if (typeof window !== 'undefined') {
  try {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';

    // UI scale: keep localhost at 100%, shrink deployed site by 10%.
    // Use CSS `zoom` (affects layout) to avoid the footer white-gap problem
    // caused by `transform: scale(...)`.
    (document.documentElement.style as any).zoom = isLocalhost ? '' : '0.9';
  } catch {
    // ignore
  }

  window.addEventListener('error', (ev) => {
    // prevent default to avoid noisy error dialogs in some browsers
    // eslint-disable-next-line no-console
    console.error('Window error captured:', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled promise rejection:', ev.reason);
  });
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Warm caches opportunistically to reduce first-view latency.
try {
  warmPlotsCacheInBackground();
} catch {
  // ignore
}

reportWebVitals();
