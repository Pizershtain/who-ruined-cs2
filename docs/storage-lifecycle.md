# Storage, jobs and artifact lifecycle

**Status:** canonical persistence and worker lifecycle reference. It documents the local architecture implemented after P0-P3; it is not a public-cloud design.

## Storage roots

PostgreSQL 17 stores metadata, state and relative pointers. Large/versioned payloads remain below `DATA_DIR`; they are not database blobs.

| Path shape | Payload |
| --- | --- |
| `uploads/<matchId>/<sha256>.dem` | streamed source demo while retained |
| `artifacts/<matchId>/...` | normalized/compatibility artifacts where applicable |
| `results/<matchId>/<sha256>.match-result@1.json.gz` | canonical result |
| `reports/<matchId>/...` | legacy scoring reports |
| `replays/<matchId>/<fileSha256>/index.m4.7-replay@1.json.gz` | replay index |
| `replays/<matchId>/<fileSha256>/rounds/<roundId>.m4.7-replay-round@1.json.gz` | replay rounds |
| `tmp/parse/<leaseToken>.*.json.gz` | provisional parser child output |

Paths stored in PostgreSQL are relative to the configured root. Artifact code resolves them under that root, rejects escape paths and refuses symlink components.

## Canonical result

`match-result@1` contains:

- normalized match data and M2 analytics;
- compatible production scoring reports;
- one active H2 participation rating;
- private recompute seed and selected policy identity;
- source-retention metadata.

The private `internal` block is persisted for deterministic rebuilds but is not returned by public rating/explanation endpoints.

## Safe reads

`@who-ruined/artifacts` applies the following checks before a payload becomes domain data:

1. resolve a safe relative path below the configured root;
2. reject symlinks and non-files;
3. enforce compressed-byte limits;
4. verify an expected SHA-256 when a database pointer provides one;
5. inflate with an independent output limit;
6. parse JSON with a maximum nesting depth;
7. validate the versioned Zod schema;
8. validate match/file/policy or replay binding.

Failures are typed internally as missing, unsafe path, symlink, compressed/decompressed limit, checksum, invalid JSON, depth, schema, binding, integrity or immutable conflict. API adapters reduce those to public `REPORT_*`, `REPLAY_*` or storage errors without exposing private paths.

## Immutable publication protocol

`FileArtifactStore.publishImmutable()` implements create/reuse/conflict:

1. create a unique temporary file with exclusive creation;
2. write all bytes and `fsync` the file;
3. close the handle;
4. call the optional `beforeCommit` ownership check;
5. publish by creating a hard link at the final path;
6. if the final path already exists, reuse it only when its digest matches;
7. otherwise report `IMMUTABLE_CONFLICT`; never overwrite;
8. remove the temporary file in every success and failure path.

A failed write, sync, ownership check or publish therefore does not intentionally leave a provisional file. Startup reconciliation removes abandoned worker/parser provisional artifacts as an additional crash safeguard.

## Database pointer ordering

For a new parse job:

1. the worker validates that its lease is still current;
2. it publishes the canonical result immutably;
3. replay publication is attempted independently and may remain unavailable;
4. one PostgreSQL transaction verifies lease ownership, writes the match result path/SHA/policy fields and marks the job `COMPLETED` or `PARTIAL`;
5. only after that transaction can raw-source cleanup run.

A database pointer never intentionally targets a not-yet-published result. A published but unreferenced result can exist after a crash; reconciliation removes versions that are neither referenced nor protected by an active job.

PostgreSQL and the filesystem are not a single transaction. The protocol closes tested crash windows through immutable publication, checksums, lease-token fencing, conditional updates and reconciliation; it does not claim distributed transactional semantics.

API upload, rescore and delete admission use a `SERIALIZABLE` transaction plus one transaction-scoped PostgreSQL advisory lock. The lock serializes the small set of global queue/match admission decisions across independent API connections. PostgreSQL serialization failures (`P2034`) are retried a bounded three times; unrelated database errors are not retried. Worker claim, heartbeat, completion and report persistence continue to use conditional row updates and lease-token fencing rather than this global admission lock.

## Jobs, leases and recovery

Job types are `PARSE` and `RESCORE`. Active stages include parsing, normalization, validation, feature computation and scoring.

- Claiming a queued job assigns a random lease token and increments the attempt count.
- Heartbeats extend only the row owned by the same non-expired token.
- Stage changes, publication checks and terminal updates are fenced by that token.
- A stale owner stops without committing terminal state.
- On shutdown/interruption, a job is returned to the queue while attempts remain.
- Startup recovery requeues expired active jobs or marks them `WORKER_RECOVERY_EXHAUSTED` after `MAX_JOB_ATTEMPTS`.
- Deterministic parse/validation/scoring failures become terminal rather than looping forever.

`JOB_HEARTBEAT_MS * 3` must be less than `JOB_LEASE_MS`.

## Parser isolation

For full event/tick/replay parsing, the worker launches the native parser in a child process. The parent:

- owns a monotonic timeout;
- kills the child after the configured grace period;
- rejects an oversized compressed file before allocating or reading it;
- bounds decompression independently from compressed size;
- accepts only a validated match envelope containing the normalized snapshot inputs and ordered participation rows under a lease-specific provisional path;
- removes provisional snapshots after use/recovery.

The native parser is synchronous inside the child, but it cannot block the worker's lease/timeout control process indefinitely. Upload ingestion performs bounded Source 2 magic/size checks and runs its header probe in a separate time-bounded child; the API process itself does not load the native parser. Artifact bounds do not constitute a hard native RSS limit; deployment-level memory isolation remains necessary for that guarantee.

## RESCORE and policy rebuilds

The HTTP `RESCORE` job recalculates a requested compatible scoring report from the `artifact` embedded in `match-result@1`; it does not read the original demo. A legacy normalized artifact can support the older report-only path. If neither stored form is sufficient, the request fails instead of fabricating evidence.

Transitioning a historical non-H2 result is a separate `rating:rebuild` operation. It reconstructs H2 from the private recompute seed inside the canonical result, publishes a new immutable result, conditionally swaps the database pointer, then removes the old owned version. The demo is not required.

## Raw demo retention

`RETAIN_SOURCE_DEMO=0` is the default. Cleanup requires all of the following:

- a bound result path and SHA;
- a `COMPLETED` or `PARTIAL` match;
- no active job for that match;
- no other match row sharing the raw path;
- the conditional row update still matches the same raw/result pointers.

If validation or publication fails, the source is not deleted by that success path. `RETAIN_SOURCE_DEMO=1` keeps it for owner-controlled diagnostics.

## Partial results and replay

A normalized match can finish `PARTIAL` with explicit quality issues. Missing values remain `null`/unavailable and are not synthesized.

Replay is a derived, independently readable artifact. Sampling is bounded, and replay publication failure is logged without invalidating an otherwise valid canonical result. Replay GETs report unavailable/corrupt/round-not-found separately.

## Deletion and reconciliation

Deletion first records intent. Reconciliation waits until no active job owns the match, removes only validated in-root paths and known match directories, then deletes the row conditionally. Startup also cleans stale parser snapshots, orphaned result versions and eligible already-published raw sources.

These safeguards assume a trusted local filesystem account. They are not a substitute for object-store conditional writes, malware scanning, tenant quotas, backup policy or public-service authorization.
