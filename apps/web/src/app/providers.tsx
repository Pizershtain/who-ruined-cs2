import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider, type RouterProviderProps } from 'react-router-dom';
import { i18n } from '../shared/i18n/client.js';
import { AuthProvider } from '../features/auth/index.js';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export function AppProviders({ router }: { router: RouterProviderProps['router'] }): ReactNode {
  return <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider><RouterProvider router={router}/></AuthProvider>
    </QueryClientProvider>
  </I18nextProvider>;
}
