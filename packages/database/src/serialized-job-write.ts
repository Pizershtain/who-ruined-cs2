import {
  Prisma,
  type PrismaClient,
} from '../generated/client/index.js';

const MAX_WRITE_TRANSACTION_ATTEMPTS = 3;
const WRITE_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 5_000,
} as const;

export interface SerializedJobWriteHooks {
  beforeWriteLock?: () => void | Promise<void>;
  afterWriteLock?: () => void | Promise<void>;
}

export class DatabaseConcurrentWriteError extends Error {
  constructor(cause: unknown) {
    super('DATABASE_CONCURRENT_WRITE', { cause });
    this.name = 'DatabaseConcurrentWriteError';
  }
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function isRetryableWriteConflict(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (code === 'P1008' || code === 'P2034') return true;
  if (!(error instanceof Error)) return false;
  return /SQLITE_BUSY|database is locked/i.test(error.message);
}

/** Serializes Job-related writes before any state used by the write is read. */
export async function runSerializedJobWrite<T>(
  client: PrismaClient,
  action: (transaction: Prisma.TransactionClient) => Promise<T>,
  hooks: SerializedJobWriteHooks = {},
): Promise<T> {
  let lastConflict: unknown;
  for (let attempt = 0; attempt < MAX_WRITE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await hooks.beforeWriteLock?.();
      return await client.$transaction(async (transaction) => {
        // SQLite starts a DEFERRED transaction. This no-op write acquires the
        // database write reservation before admission or ownership is observed.
        await transaction.$executeRawUnsafe(
          'UPDATE "Job" SET "id" = "id" WHERE 0 = 1',
        );
        await hooks.afterWriteLock?.();
        return action(transaction);
      }, WRITE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isRetryableWriteConflict(error)) throw error;
      lastConflict = error;
    }
  }
  throw new DatabaseConcurrentWriteError(lastConflict);
}
