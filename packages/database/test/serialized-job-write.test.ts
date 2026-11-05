import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/client/index.js';
import {
  DatabaseConcurrentWriteError,
  runSerializedJobWrite,
} from '../src/serialized-job-write.js';

function clientWithTransaction(
  transaction: (action: (tx: { $queryRaw: ReturnType<typeof vi.fn> }) => Promise<unknown>) => Promise<unknown>,
): PrismaClient {
  return { $transaction: transaction } as unknown as PrismaClient;
}

describe('PostgreSQL serialized job writes', () => {
  it('acquires the transaction-scoped advisory lock before the action', async () => {
    const order: string[] = [];
    const queryRaw = vi.fn(async () => { order.push('lock'); return [{ locked: 1 }]; });
    const client = clientWithTransaction(async (action) => action({ $queryRaw: queryRaw }));

    await expect(runSerializedJobWrite(client, async () => {
      order.push('action');
      return 'ok';
    })).resolves.toBe('ok');

    expect(order).toEqual(['lock', 'action']);
    expect(queryRaw).toHaveBeenCalledOnce();
    const [template, namespace, key] = queryRaw.mock.calls[0]!;
    const sql = Array.from(template as readonly string[]).join('?');
    expect(sql).toContain('WITH advisory_lock AS MATERIALIZED');
    expect(sql).toContain('?::int4');
    expect(sql).toContain('SELECT 1::int4 AS locked');
    expect([namespace, key]).toEqual([0x57524332, 1]);
  });

  it('retries P2034 conflicts up to the bounded attempt limit', async () => {
    const queryRaw = vi.fn(async () => [{ locked: 1 }]);
    let attempts = 0;
    const client = clientWithTransaction(async (action) => {
      attempts += 1;
      const result = await action({ $queryRaw: queryRaw });
      if (attempts < 3) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
      return result;
    });

    await expect(runSerializedJobWrite(client, async () => 'committed'))
      .resolves.toBe('committed');
    expect(attempts).toBe(3);
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('maps repeated P2034 conflicts to one typed failure', async () => {
    const conflict = Object.assign(new Error('serialization conflict'), { code: 'P2034' });
    const transaction = vi.fn(async () => { throw conflict; });
    const client = clientWithTransaction(transaction);

    await expect(runSerializedJobWrite(client, async () => undefined))
      .rejects.toBeInstanceOf(DatabaseConcurrentWriteError);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry unrelated database failures', async () => {
    const failure = Object.assign(new Error('unique conflict'), { code: 'P2002' });
    const transaction = vi.fn(async () => { throw failure; });
    const client = clientWithTransaction(transaction);

    await expect(runSerializedJobWrite(client, async () => undefined))
      .rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
