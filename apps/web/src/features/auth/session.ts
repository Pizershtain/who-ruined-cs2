import type { AuthRegistrationInput, AuthTokensDto, AuthUserDto } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { authApi } from './api.js';
import { browserCoordination, type SessionEvent } from './coordination.js';

type State = 'GUEST' | 'CHECKING' | 'AUTHENTICATED' | 'UNAVAILABLE';
type Snapshot = { state: State; user: AuthUserDto | null; error: unknown; busy: boolean; logoutUnconfirmed: boolean };

function rejectedBeforeRotation(error: unknown) {
  return error instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 414, 429].includes(error.status);
}

export function waitUntil(error: unknown, now: number): number {
  if (!(error instanceof ApiClientError) || error.status !== 429) return 0;
  const retryAfter = error.retryAfter ?? '';
  if (/^\d+$/u.test(retryAfter)) return now + Number(retryAfter) * 1_000;
  const retryDate = Date.parse(retryAfter);
  return Number.isFinite(retryDate) ? Math.max(now, retryDate) : now + 1_000;
}

export class AuthSession {
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private renewal: { generation: number; task: Promise<void> } | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryAt = 0;

  constructor(private readonly enabled: boolean, private readonly api = authApi, private readonly coordination = browserCoordination) {
    this.snapshot = { state: enabled ? 'CHECKING' : 'GUEST', user: null, error: null, busy: false, logoutUnconfirmed: false };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(fields: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...fields };
    for (const listener of this.listeners) listener();
  }

  private clear() {
    clearTimeout(this.timer);
    this.access = null;
  }

  private accept(issued: AuthTokensDto, user = issued.user) {
    const duration = issued.expiresIn * 1_000;
    this.access = { token: issued.accessToken, expiresAt: Date.now() + duration };
    this.update({ state: 'AUTHENTICATED', user, error: null, logoutUnconfirmed: false });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.coordination.canRefresh()) void this.restore();
      else { this.clear(); this.update({ state: 'GUEST', user: null, error: new ApiClientError('SESSION_EXPIRED') }); }
    }, this.coordination.canRefresh() ? duration - Math.min(30_000, duration / 5) : duration);
  }

  connect(): () => void {
    if (!this.enabled) return () => undefined;
    const disconnect = this.coordination.listen(event => this.externalChange(event));
    void this.restore();
    return disconnect;
  }

  private externalChange(event: SessionEvent) {
    this.generation++;
    this.clear();
    if (event === 'login') {
      void this.restore();
    } else {
      const unconfirmed = event === 'logout-unconfirmed';
      this.update({ state: unconfirmed ? 'UNAVAILABLE' : 'GUEST', user: null,
        error: unconfirmed ? new ApiClientError('AUTH_UNAVAILABLE') : null, logoutUnconfirmed: unconfirmed });
    }
  }

  restore(): Promise<void> {
    if (!this.enabled || this.snapshot.busy) return Promise.resolve();
    const generation = this.generation;
    if (this.renewal?.generation === generation) return this.renewal.task;
    if (!this.access) this.update({ state: 'CHECKING', user: null, error: null, logoutUnconfirmed: false });

    const task = this.coordination.exclusive(async () => {
      if (generation !== this.generation) return;
      const guard = this.coordination.guard();
      if (guard === 'uncertain') throw new ApiClientError('AUTH_SESSION_UNCERTAIN');
      if (guard === 'guest' || !this.coordination.canRefresh()) {
        this.clear();
        this.update({ state: 'GUEST', user: null, error: null });
        return;
      }
      // Keep the marker if a request can have consumed the cookie without a response.
      this.coordination.setGuard('uncertain');
      let issued: AuthTokensDto;
      try {
        issued = await this.api.refresh();
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          this.coordination.setGuard('guest');
          this.coordination.notify('logout');
          if (generation === this.generation) {
            const expired = this.access !== null || error.code === 'SESSION_EXPIRED';
            this.clear();
            this.update({ state: 'GUEST', user: null, error: expired ? new ApiClientError('SESSION_EXPIRED') : null });
          }
          return;
        }
        if (rejectedBeforeRotation(error)) this.coordination.setGuard('ready');
        throw error;
      }
      this.coordination.setGuard('ready');
      if (generation === this.generation) this.accept(issued);
    }).catch((error: unknown) => {
      if (generation === this.generation) {
        this.clear();
        this.update({ state: 'UNAVAILABLE', user: null, error });
      }
    }).finally(() => {
      if (this.renewal?.generation === generation) this.renewal = null;
    });
    this.renewal = { generation, task };
    return task;
  }

  async withAccess<T>(request: (token: string) => Promise<T>): Promise<T> {
    if (!this.access || Date.now() >= this.access.expiresAt) await this.restore();
    if (!this.access || Date.now() >= this.access.expiresAt) throw new ApiClientError('UNAUTHENTICATED', 401);
    const generation = this.generation;
    const data = await request(this.access.token);
    if (generation !== this.generation || !this.access) throw new ApiClientError('UNAUTHENTICATED', 401);
    return data;
  }

  currentUser(): Promise<AuthUserDto> {
    return this.withAccess(token => this.api.me(token));
  }

  login(username: string, password: string): Promise<boolean> {
    return this.start(() => this.api.login(username, password));
  }

  register(input: AuthRegistrationInput): Promise<boolean> {
    return this.start(() => this.api.register(input));
  }

  private async start(issue: () => Promise<AuthTokensDto>): Promise<boolean> {
    if (!this.enabled || this.snapshot.busy || Date.now() < this.retryAt) return false;
    this.generation++;
    this.clear();
    this.update({ state: 'GUEST', user: null, error: null, busy: true, logoutUnconfirmed: false });
    try {
      return await this.coordination.exclusive(async () => {
        const guard = this.coordination.guard();
        this.coordination.setGuard('uncertain');
        let issued: AuthTokensDto;
        try { issued = await issue(); }
        catch (error) {
          if (rejectedBeforeRotation(error)) this.coordination.setGuard(guard);
          throw error;
        }
        this.coordination.setGuard('ready');
        this.coordination.notify('login');
        this.accept(issued);
        try {
          const verified = await this.currentUser();
          if (verified.id !== issued.user.id) throw new ApiClientError('INVALID_RESPONSE');
          this.update({ user: verified });
        } catch (error) {
          // The successful token response also authenticates the user. A
          // transport hiccup during the optional read does not undo login.
          if (error instanceof ApiClientError && (error.status === 401 || error.code === 'INVALID_RESPONSE')) {
            this.clear();
            throw error;
          }
        }
        return true;
      });
    } catch (error) {
      this.retryAt = waitUntil(error, Date.now());
      this.update({ state: rejectedBeforeRotation(error) ? 'GUEST' : 'UNAVAILABLE', user: null, error });
      return false;
    } finally {
      this.update({ busy: false });
    }
  }

  async logout(): Promise<void> {
    if (this.snapshot.busy) return;
    const generation = ++this.generation;
    this.clear();
    this.update({ busy: true, error: null });
    try {
      await this.coordination.exclusive(async () => {
        this.coordination.setGuard('uncertain');
        try {
          await this.api.logout();
        } catch (error) {
          this.coordination.notify('logout-unconfirmed');
          throw error;
        }
        this.coordination.setGuard('guest');
        this.coordination.notify('logout');
        this.update({ state: 'GUEST', user: null, logoutUnconfirmed: false });
      });
    } catch (error) {
      if (generation === this.generation) this.update({ state: 'UNAVAILABLE', user: null, error, logoutUnconfirmed: true });
    } finally {
      this.update({ busy: false });
    }
  }
}
