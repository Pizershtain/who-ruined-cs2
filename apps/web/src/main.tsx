import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';
import { i18n, i18nReady } from './shared/i18n/client.js';
import { router } from './App.js';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
await i18nReady;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></I18nextProvider></React.StrictMode>,
);
