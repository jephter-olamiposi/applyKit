/**
 * @fileoverview React DOM mounting point for Side Panel UI.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './sidepanel.css';

const container = document.getElementById('root');

if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
