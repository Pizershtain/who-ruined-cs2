import { connectToProfilesDatabase } from './runtime.js';
import { ProfileStore } from './store.js';

const mode = process.argv[2];
if (process.argv.length !== 3 || (mode !== '--replay-core-feed' && mode !== '--verify-aggregates' && mode !== '--repair-aggregates')) {
  throw new Error('Pass --replay-core-feed, --verify-aggregates (dry run) or --repair-aggregates.');
}
const db = connectToProfilesDatabase();
try {
  const store = new ProfileStore(db);
  if (mode === '--replay-core-feed') {
    await store.rebuild();
    console.info('Replay scheduled. Existing profiles are retained and marked REBUILDING until caught up.');
  } else {
    const repair = mode === '--repair-aggregates';
    let checked = 0;
    let differences = 0;
    let after = '';
    for (;;) {
      const next = await store.auditNext(after, repair);
      if (!next) break;
      after = next.steamId;
      checked++;
      if (next.differs) {
        differences++;
        console.info(JSON.stringify({ steamId: next.steamId, result: repair ? 'REPAIRED' : 'MISMATCH' }));
      }
    }
    console.info(JSON.stringify({ checked, differences, mode }));
    if (differences > 0 && !repair) process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
