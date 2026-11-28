const lockName = 'wrc:auth:cookie';
const guardKey = 'wrc:auth:refresh-state';
const eventKey = 'wrc:auth:session-event';

export type RefreshGuard = 'guest' | 'uncertain' | 'ready';
export type SessionEvent = 'login' | 'logout' | 'logout-unconfirmed';

export const browserCoordination = {
  canRefresh: () => Boolean(navigator.locks),
  exclusive: <T>(task: () => Promise<T>): Promise<T> => navigator.locks
    ? navigator.locks.request(lockName, task)
    : task(),
  guard(): RefreshGuard {
    const value = localStorage.getItem(guardKey);
    return value === 'guest' || value === 'uncertain' ? value : 'ready';
  },
  setGuard(value: RefreshGuard) { localStorage.setItem(guardKey, value); },
  notify(event: SessionEvent) { localStorage.setItem(eventKey, `${event}:${Date.now()}:${Math.random()}`); },
  listen(callback: (event: SessionEvent) => void) {
    function receive(event: StorageEvent) {
      if (event.key !== eventKey || event.storageArea !== localStorage) return;
      if (event.newValue !== localStorage.getItem(eventKey)) return;
      const kind = event.newValue?.split(':')[0];
      if (kind === 'login' || kind === 'logout' || kind === 'logout-unconfirmed') callback(kind);
    }
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  },
};
