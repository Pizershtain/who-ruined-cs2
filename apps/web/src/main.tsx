import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProviders } from './app/providers.js';
import { router } from './app/router.js';
import { i18nReady } from './shared/i18n/client.js';
// Bundled fallback for platforms without San Francisco; served with the app, no CDN.
import '@fontsource-variable/inter';
// Tabular monospace for every figure, so numbers scan as a column anywhere on the page.
import '@fontsource-variable/jetbrains-mono/index.css';
import './index.css';

await i18nReady;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AppProviders router={router}/></React.StrictMode>,
);
