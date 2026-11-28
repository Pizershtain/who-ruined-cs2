import type { PublicApiErrorCode } from '@who-ruined/contracts';

export class ApplicationError extends Error {
  constructor(
    public readonly code: PublicApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
