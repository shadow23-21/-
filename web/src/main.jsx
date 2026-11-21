import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.jsx';
import './styles.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline shell is optional; the app still works without it.
    });
  });
}

createRoot(document.getElementById('root')).render(<App />);
