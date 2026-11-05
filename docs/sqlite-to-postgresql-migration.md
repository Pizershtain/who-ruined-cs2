# SQLite to PostgreSQL migration runbook

**Scope:** owner-controlled one-time migration from the final SQLite schema to an empty PostgreSQL 17 database. The tool never migrates `DATA_DIR` files and never changes the source SQLite file. Test on copies before switching the application.

## 1. Back up the current installation

Stop API and worker writes. Preserve the SQLite database, its `-wal`/`-shm` companions when present, and the complete `DATA_DIR` together. Keep the backup outside the working tree. Do not delete source demos, results, replays, reports or sidecars.

## 2. Quiesce the old database

Ensure no API, worker, maintenance command or other SQLite connection is running. The importer rejects any `Job` in an unfinished state. Resolve or deliberately recover queued/leased work in the old installation before proceeding; do not rewrite active rows by hand.

## 3. Create a consistent SQLite snapshot

With all writers stopped, use SQLite's backup mechanism rather than an ordinary copy of a live file:

~~~powershell
sqlite3.exe .\data\app.db ".backup 'C:/wrc-migration/app.snapshot.db'"
sqlite3.exe C:\wrc-migration\app.snapshot.db "PRAGMA quick_check; PRAGMA foreign_key_check;"
~~~

The importer also opens the snapshot read-only, starts one read transaction, runs both integrity checks and validates the exact final SQLite table shape. Keep the original installation untouched until acceptance is complete.

## 4. Provision PostgreSQL 17

Create a dedicated empty database or schema. For the repository's isolated Compose profile, `scripts/dev-up.ps1` provisions PostgreSQL 17, a named volume and a random ignored password. Starting Docker requires explicit owner approval. An externally managed PostgreSQL 17 instance is also supported.

Do not reuse an owner or production database for rehearsal. The destination URL must be explicit and must not be logged or committed.

## 5. Deploy the PostgreSQL schema

Set the destination only in the current terminal, then apply the committed migration history:

~~~powershell
$env:WRC_MIGRATION_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:54329/DATABASE?schema=public'
$env:DATABASE_URL = $env:WRC_MIGRATION_DATABASE_URL
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:migrate
~~~

The second deploy must report no pending migration. The importer additionally requires PostgreSQL 17 or newer and empty `Match`, `Job` and `Report` tables.

## 6. Preflight without writing

~~~powershell
npm.cmd run db:migrate:sqlite -- --sqlite C:\wrc-migration\app.snapshot.db `
  --postgres-url-env WRC_MIGRATION_DATABASE_URL --dry-run
~~~

Record the reported `matches`, `jobs`, `reports` and `fingerprint`. Preflight rejects schema drift, source integrity/foreign-key failures, active jobs, an unavailable/old PostgreSQL server and a non-empty destination.

## 7. Import atomically

~~~powershell
npm.cmd run db:migrate:sqlite -- --sqlite C:\wrc-migration\app.snapshot.db `
  --postgres-url-env WRC_MIGRATION_DATABASE_URL
~~~

Rows are mapped without status normalization and inserted in `Match`, `Job`, `Report` order inside one `SERIALIZABLE` PostgreSQL transaction. IDs, timestamps, nullable values, attempts, leases, errors, artifact paths/SHA and policy metadata are retained. The destination is reread and fingerprinted before commit. Any error rolls back the entire import. A repeated run is rejected because the target is no longer empty; it never upserts or overwrites.

## 8. Verify rows and immutable artifacts

Compare the import counts/fingerprint with preflight. Keep the same complete `DATA_DIR`, or copy it separately while both applications are stopped and then point API and worker at that copy. Database paths are relative to this root.

For representative `COMPLETED` and `PARTIAL` matches verify through the application:

- match detail and typed quality/status;
- canonical `match-result@1` checksum, binding and schema validation;
- H2 rating and explanation, including `rating: null` states;
- replay index and at least one available round;
- an existing legacy report where present;
- a `RESCORE` job after temporarily moving the retained source `.dem` out of reach, proving the stored canonical artifact is sufficient.

Do not repair a failed artifact check by editing pointers or weakening checksum/binding validation. Restore the matching `DATA_DIR` instead.

## 9. Switch the application

Stop the rehearsal processes. Configure both API and worker with the same accepted PostgreSQL `DATABASE_URL` and the verified artifact `DATA_DIR`. Apply `npm.cmd run db:migrate` once more, then start API and worker. Confirm health, list/detail reads, one existing result, one replay and one new synthetic/test upload before treating the switch as accepted.

## 10. Roll back before acceptance

If any check fails, stop the PostgreSQL-backed API/worker. Returning to SQLite requires the previous compatible application version, its SQLite-generated Prisma Client and its original configuration. The PostgreSQL-only build cannot be pointed at `file:.../app.db`: its generated client and migration history support PostgreSQL only.

Keep the old SQLite database and its corresponding `DATA_DIR` untouched as one rollback unit until PostgreSQL acceptance is complete. Restart only the previous SQLite-compatible installation against that pair. Do not merge databases or copy rows back. Retain the failed PostgreSQL database for diagnosis or delete only its dedicated database/volume after explicit owner approval.

The migration tool is not an online dual-write mechanism. Once new writes are accepted in PostgreSQL, a simple rollback to the old SQLite snapshot loses every new PostgreSQL-only write. Reconciling those writes requires a separate migration and owner decision; do not treat configuration rollback as data rollback.
