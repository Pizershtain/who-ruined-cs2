import type { AuthErrorCode } from '@who-ruined/contracts';

const faults = {
  INVALID_CREDENTIALS: [401, 'Invalid username or password.'],
  UNAUTHENTICATED: [401, 'Authentication required.'],
  SESSION_EXPIRED: [401, 'The session has expired.'],
  AUTH_ORIGIN_NOT_ALLOWED: [403, 'Request origin is not allowed.'],
  RATE_LIMITED: [429, 'Too many login attempts.'],
  USERNAME_TAKEN: [409, 'This username is already taken.'],
  INVALID_REQUEST: [400, 'Invalid request.'],
  AUTH_UNAVAILABLE: [503, 'Authentication is temporarily unavailable.'],
} as const satisfies Partial<Record<AuthErrorCode, readonly [number, string]>>;

export class AuthFault extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof faults, readonly retryAfter?: number) {
    const [status, message] = faults[code];
    super(message);
    this.status = status;
  }
}
