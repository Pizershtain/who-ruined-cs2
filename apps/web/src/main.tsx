import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';
import { i18n, i18nReady } from './shared/i18n/client.js';
import { router } from './App.js';
// Bundled fallback for platforms without San Francisco; served with the app, no CDN.
import '@fontsource-variable/inter';
// Tabular monospace for every figure, so numbers scan as a column anywhere on the page.
import '@fontsource-variable/jetbrains-mono';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
await i18nReady;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></I18nextProvider></React.StrictMode>,
);
