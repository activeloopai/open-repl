import React from 'react';
import { createRoot } from 'react-dom/client';
import { store } from './store.js';
import { App } from './App.js';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

store.connect();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
