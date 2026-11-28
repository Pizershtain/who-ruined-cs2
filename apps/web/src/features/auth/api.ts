import { authTokensSchema, authUserSchema, type AuthRegistrationInput } from '@who-ruined/contracts';
import { z } from 'zod';
import { request } from '../../shared/api/transport.js';

const shared = { credentials: 'same-origin', cache: 'no-store' } as const;
const post = () => ({ ...shared, method: 'POST', signal: AbortSignal.timeout(15_000) });

export const authApi = {
  login: (username: string, password: string) => request('/api/v1/auth/login', {
    ...post(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }, authTokensSchema),
  register: (input: AuthRegistrationInput) => request('/api/v1/auth/register', {
    ...post(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, authTokensSchema),
  refresh: () => request('/api/v1/auth/refresh', post(), authTokensSchema),
  logout: () => request('/api/v1/auth/logout', post(), z.undefined()),
  me: (token: string) => request('/api/v1/auth/me', { ...shared,
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  }, authUserSchema),
};
