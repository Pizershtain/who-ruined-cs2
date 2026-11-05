import {
  Prisma,
  type PrismaClient,
} from '../generated/client/index.js';

const MAX_WRITE_TRANSACTION_ATTEMPTS = 3;
const JOB_WRITE_LOCK_NAMESPACE = 0x57524332;
const JOB_WRITE_LOCK_KEY = 1;
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
  return databaseErrorCode(error) === 'P2034';
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
        // PostgreSQL advisory locks are connection-local and automatically
        // released by commit/rollback. Every queue admission/deletion path uses
        // this same two-key namespace before observing shared capacity/state.
        // Prisma serializes JavaScript numbers as INT8 parameters. The explicit
        // casts select PostgreSQL's INT4/INT4 overload. The materialized CTE
        // executes the volatile lock function but exposes only a normal INT4
        // column, so Prisma never has to decode PostgreSQL's void result.
        await transaction.$queryRaw<Array<{ locked: number }>>`
          WITH advisory_lock AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(
              ${JOB_WRITE_LOCK_NAMESPACE}::int4,
              ${JOB_WRITE_LOCK_KEY}::int4
            )
          )
          SELECT 1::int4 AS locked FROM advisory_lock
        `;
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
