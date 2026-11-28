import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokensDto } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { AuthSession, waitUntil } from './session.js';
import type { RefreshGuard, SessionEvent } from './coordination.js';

const user = { id: 'f5bc6530-d2f3-46fd-b299-d86f40a09cc2', username: 'fixture', displayName: 'Synthetic account' };
const tokens: AuthTokensDto = { accessToken: 'synthetic-token', tokenType: 'Bearer', expiresIn: 60, user };

function browser(canRefresh = true) {
  let guard: RefreshGuard = 'ready';
  let queue = Promise.resolve();
  const listeners = new Set<(event: SessionEvent) => void>();
  return () => {
    let own: ((event: SessionEvent) => void) | null = null;
    return {
      canRefresh: () => canRefresh,
      exclusive<T>(task: () => Promise<T>) {
        const result = queue.then(task);
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
      guard: () => guard,
      setGuard: (value: RefreshGuard) => { guard = value; },
      notify: (event: SessionEvent) => {
        for (const listener of listeners) if (listener !== own) listener(event);
      },
      listen: (callback: (event: SessionEvent) => void) => {
        own = callback;
        listeners.add(callback);
        return () => { listeners.delete(callback); };
      },
    };
  };
}

function api() {
  return { login: vi.fn(async () => tokens), refresh: vi.fn(async () => tokens), logout: vi.fn(async () => undefined), me: vi.fn(async () => user) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Auth session on a shared browser origin', () => {
  it('coalesces parallel readers on expiry and serializes refresh requests across tabs', async () => {
    const makeTab = browser();
    const service = api();
    const a = new AuthSession(true, service, makeTab());
    const b = new AuthSession(true, service, makeTab());
    let inFlight = 0;
    service.refresh.mockImplementation(async () => {
      expect(++inFlight).toBe(1);
      await Promise.resolve();
      inFlight--;
      return tokens;
    });
    await Promise.all([a.restore(), a.restore(), b.restore()]);
    expect(service.refresh).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 61_000);
    await expect(Promise.all([a.currentUser(), a.currentUser()])).resolves.toEqual([user, user]);
    expect(service.refresh).toHaveBeenCalledTimes(3);
    expect(service.me).toHaveBeenCalledWith(tokens.accessToken);
    expect(a.getSnapshot()).not.toHaveProperty('accessToken');
  });

  it('renews a live session from the server TTL and propagates a confirmed logout', async () => {
    const makeTab = browser();
    const service = api();
    const a = new AuthSession(true, service, makeTab());
    const b = new AuthSession(true, service, makeTab());
    const disconnect = b.connect();
    await b.restore();
    await vi.advanceTimersByTimeAsync(48_000);
    expect(service.refresh).toHaveBeenCalledTimes(2);
    await a.logout();
    expect(b.getSnapshot()).toMatchObject({ state: 'GUEST', user: null });
    await b.restore();
    expect(service.refresh).toHaveBeenCalledTimes(2);
    disconnect();
  });

  it('keeps ambiguous refreshes blocked across reloads and tabs until a password login', async () => {
    const makeTab = browser();
    const service = api();
    service.refresh.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR'));
    const a = new AuthSession(true, service, makeTab());
    const b = new AuthSession(true, service, makeTab());
    await Promise.all([a.restore(), b.restore()]);
    expect(service.refresh).toHaveBeenCalledTimes(1);
    expect(b.getSnapshot()).toMatchObject({ state: 'UNAVAILABLE', error: { code: 'AUTH_SESSION_UNCERTAIN' } });
    await expect(a.login('fixture', 'synthetic-password')).resolves.toBe(true);
    await new AuthSession(true, service, makeTab()).restore();
    expect(service.refresh).toHaveBeenCalledTimes(2);
  });

  it('finishes an in-flight rotation before logout and distinguishes unconfirmed logout', async () => {
    const service = api();
    const a = new AuthSession(true, service, browser()());
    let resolveRefresh: (value: AuthTokensDto) => void = () => undefined;
    service.refresh.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const refresh = a.restore();
    await Promise.resolve();
    const logout = a.logout();
    expect(service.logout).not.toHaveBeenCalled();
    resolveRefresh(tokens);
    await Promise.all([refresh, logout]);
    expect(a.getSnapshot()).toMatchObject({ state: 'GUEST' });
    await a.login('fixture', 'synthetic-password');
    service.logout.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR'));
    await a.logout();
    expect(a.getSnapshot()).toMatchObject({ state: 'UNAVAILABLE', user: null, logoutUnconfirmed: true });
  });

  it('honors Retry-After and the manual sign-in fallback without Web Locks', async () => {
    const service = api();
    const a = new AuthSession(true, service, browser(false)());
    await a.restore();
    expect(service.refresh).not.toHaveBeenCalled();
    expect(a.getSnapshot().state).toBe('GUEST');
    const limit = new ApiClientError('RATE_LIMITED', 429, undefined, undefined, '5');
    expect(waitUntil(limit, 1_000)).toBe(6_000);
    service.login.mockRejectedValueOnce(limit);
    await expect(a.login('fixture', 'synthetic-password')).resolves.toBe(false);
    await expect(a.login('fixture', 'synthetic-password')).resolves.toBe(false);
    expect(service.login).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(a.login('fixture', 'synthetic-password')).resolves.toBe(true);
  });
});
