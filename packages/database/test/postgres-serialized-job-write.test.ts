import { afterEach, describe, expect, it } from 'vitest';
import { runSerializedJobWrite } from '../src/serialized-job-write.js';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from './postgres-test-database.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const databases: PostgresTestDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

describe.skipIf(!postgresIntegrationAvailable)('PostgreSQL serialized job write lock', () => {
  it('uses SERIALIZABLE and holds the transaction-scoped lock across independent clients', async () => {
    const database = await createPostgresTestDatabase(2);
    databases.push(database);
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondEntered = deferred<void>();

    const first = runSerializedJobWrite(database.clients[0]!, async (transaction) => {
      const isolation = await transaction.$queryRaw<Array<{ level: string }>>`
        SELECT current_setting('transaction_isolation') AS level
      `;
      expect(isolation).toEqual([{ level: 'serializable' }]);
      firstEntered.resolve();
      await releaseFirst.promise;
      return 'first';
    });
    await firstEntered.promise;

    const second = runSerializedJobWrite(database.clients[1]!, async () => {
      secondEntered.resolve();
      return 'second';
    });
    const enteredBeforeCommit = await Promise.race([
      secondEntered.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(enteredBeforeCommit).toBe(false);
    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
  });

  it('releases the advisory lock when the owning transaction rolls back', async () => {
    const database = await createPostgresTestDatabase(2);
    databases.push(database);
    const failure = new Error('synthetic rollback');

    await expect(runSerializedJobWrite(database.clients[0]!, async () => {
      throw failure;
    })).rejects.toBe(failure);

    await expect(runSerializedJobWrite(database.clients[1]!, async () => 'after rollback'))
      .resolves.toBe('after rollback');
  });
});
