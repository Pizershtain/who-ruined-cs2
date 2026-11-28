import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@who-ruined/database';

export async function waitForMatchArtifactLockWait(
  observer: PrismaClient,
  matchId: string,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const [state] = await observer.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks AS waiting
        JOIN pg_locks AS holder
          ON holder.locktype = waiting.locktype
          AND holder.database IS NOT DISTINCT FROM waiting.database
          AND holder.classid IS NOT DISTINCT FROM waiting.classid
          AND holder.objid IS NOT DISTINCT FROM waiting.objid
          AND holder.objsubid IS NOT DISTINCT FROM waiting.objsubid
          AND holder.granted
        WHERE waiting.locktype = 'advisory'
          AND NOT waiting.granted
          AND waiting.database = (
            SELECT oid FROM pg_database WHERE datname = current_database()
          )
          AND waiting.objid = hashtext(${matchId}::text)::int4::oid
      ) AS waiting
    `;
    if (state?.waiting) return;
    await delay(10);
  }
  throw new Error(`MATCH_ARTIFACT_LOCK_WAIT_NOT_OBSERVED:${matchId}`);
}
