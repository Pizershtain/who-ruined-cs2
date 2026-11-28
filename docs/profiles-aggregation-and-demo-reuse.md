# Profiles aggregation and demo reuse

Core owns uploads, byte identity and canonical results. Profiles owns match history and its cumulative projection, refreshed through the existing private publication feed. Gateway forwards both responses through the existing routes.

## Profile projection

The Profiles migration adds `ProfileAggregate`, keyed by SteamID64. The row contains an internal version, the highest publication revision reflected in the saved summary, and the versioned `player-profile@1` body with the displayed values, numerators, denominators, match and round coverage. The table uses its primary-key index. The existing `ProfileParticipation` indexes support match-to-player lookup and history scoped to one SteamID. History applies its keyset cursor and limit before reading the selected rows' player JSON.

`ProfileStore.apply()` puts the new match snapshot, its player history, all changed players' summaries and pending-work acknowledgement in one PostgreSQL transaction. The existing transaction advisory lock fences concurrent writers across processes. For each affected player, the existing aggregate builder recomputes from the authoritative local history. A PostgreSQL cursor reads at most 256 representatives at a time. The winner per SHA-256 remains the newest upload, then greatest match ID on ties. Removing that record promotes the next surviving copy. Removing the last unique demo removes the profile row. The latest eligible nickname and all existing coverage and award semantics are preserved. A replayed revision and a summary with unchanged content produce no duplicate contribution.

Average rates continue to sum only verifiable numerators and their matching denominators. Totals can retain verified contributions even when the rate is unavailable. The profile response still distinguishes a confirmed zero from `PARTIAL`, `UNAVAILABLE` and `NOT_APPLICABLE`.

### Migration and recovery

The schema migration retains match and player history. The running Profiles service creates missing projections in the background, using a durable SteamID cursor. After an interruption it resumes from that checkpoint. Match changes are serialized with background work. Previously saved summaries remain readable during replay, with explicit freshness headers.

Use the existing Profiles administrative command and configure `PROFILES_DATABASE_URL` for the intended Profiles database.

```powershell
pnpm --filter @who-ruined/profiles rebuild --verify-aggregates
pnpm --filter @who-ruined/profiles rebuild --repair-aggregates
pnpm --filter @who-ruined/profiles rebuild --replay-core-feed
```

- Verification compares each stored summary to a fresh calculation over local history, reports mismatches by SteamID and returns exit 1 when it finds differences. It performs no writes.
- Repair uses the same comparison under the writer lock, changing only mismatched summaries. It can be repeated after interruption.
- Replay resets the feed checkpoint and marks projections as rebuilding. The service reads the retained Core feed from zero, honors tombstones and revision fences, rebuilds its summaries and clears the marker after backfill and catch-up. The source must be the same Core database lineage. A replacement Core database should start with a separate Profiles store.

After deployment, verify that the internal Profiles `/api/v1/ready` shows `aggregateBackfillComplete: true`, `replaying: false`, `pending: 0` and `status: ready`.

## Demo reuse

Multer writes the upload to a temporary file and computes SHA-256 on the same stream with backpressure. Core validates the extension, actual length and Source 2 signature before looking up the exact digest and current parser and normalizer versions. A match on these fields avoids the native header process. New bytes still undergo the full header preflight and atomic queue admission, which rechecks the same key under the write lock. Limits and abort-safe cleanup also apply to duplicate uploads.

The production reader validates the canonical artifact's compressed SHA, schema, embedded H3 policy and report bindings. Reuse additionally requires the recompute seed to bind to the new upload's digest and current component versions. The chosen job is the original PARSE job, even when a newer RESCORE job exists. Two identical uploads racing after a lookup miss may both run the bounded header probe. The existing transaction admits only one PARSE.

| Existing state | Response |
| --- | --- |
| Canonical H3 report verified after terminal PARSE, including a readable partial report | 202, `duplicate: true`, `RESULT_READY` |
| PARSE queued or running | 202, `duplicate: true`, `ANALYSIS_IN_PROGRESS` |
| Previous PARSE failed, was cancelled, or has no report | 409 `REPORT_NOT_READY`, with match ID and operator recovery |
| Artifact fails verification | 409 `REPORT_CORRUPT` and recovery details |
| Same component versions and bytes, but an old rating policy | 409 `REPORT_POLICY_MISMATCH` with rebuild or delete-and-reupload guidance |
| Match is being deleted | 409 `MATCH_ACTIVE`. Retry after deletion finishes |
| New bytes or incompatible parser/normalizer identity | Existing admission flow, 202 `ACCEPTED` if admitted |

### Game identity evidence

Five authorized CS2 headers read with the installed `demoparser2` exposed no match or session identifier. The same `demo_version_guid` appeared across all five demos, and the set of map names had only two entries. Source 2's `CDemoFileHeader` lacks a CS2 match-ID field, and the CS variant of `CDemoFileInfo` carries round ticks. Server Info has server identity hints and optional session payloads whose cross-recording stability and availability were not established. The matchmaking coordinator has its own optional `matchid`, available from a different message type. Its existence does not establish an authenticated identifier in uploaded demos. [Demo protobuf](https://github.com/SteamDatabase/Protobufs/blob/master/csgo/demo.proto), [server messages](https://github.com/SteamDatabase/Protobufs/blob/master/csgo/netmessages.proto), [coordinator messages](https://github.com/SteamDatabase/Protobufs/blob/master/csgo/cstrike15_gcmessages.proto).

The application uses the computed SHA-256 as byte identity. A shared map, score, roster, timestamp or filename is insufficient to link sessions or reuse results. Even a future trusted match ID would identify a session. Reuse across different files would still require evidence that their usable data and coverage are equivalent. The full file must reach the server to establish its digest.

## Local verification and timings

The old and new images ran through the same Docker Gateway and PostgreSQL 17 test project. The four synthetic players had the same input rows and different history sizes. The values below are loopback HTTP medians of three warmed reads. SQL counts refer to data SELECTs. Bytes are the logical PostgreSQL JSON text length, excluding protocol framing and row metadata. The old column includes the player JSON only, so it is a lower bound on all JSON read by the previous path.

| Matches | GET old / new (ms) | SQL data reads old / new | Player JSON / stored summary (bytes) |
| ---: | ---: | ---: | ---: |
| 10 | 6.38 / 4.04 | 1 / 1 | 35,130 / 9,497 |
| 100 | 19.64 / 4.04 | 2 / 1 | 351,300 / 9,697 |
| 1,000 | 119.81 / 3.49 | 11 / 1 | 3,513,000 / 9,874 |
| 10,000 | 5,441.75 / 2.58 | 101 / 1 | 35,130,000 / 10,046 |

The HTTP responses matched the legacy builder field by field, with exact numeric equality for these fixtures. The new write path reads the affected player's representative history. The following are single measurements of a one-player update, a subsequent deletion and initial backfill under the same 384 MiB container limit. Update timings exclude fetching the Core snapshot.

| Matches | Update old / new (ms) | Delete old / new (ms) | New backfill (ms) |
| ---: | ---: | ---: | ---: |
| 10 | 11.62 / 12.40 | 6.89 / 8.69 | 15.06 |
| 100 | 7.52 / 19.95 | 6.62 / 16.29 | 19.58 |
| 1,000 | 8.27 / 80.29 | 6.68 / 80.79 | 93.64 |
| 10,000 | 8.37 / 685.06 | 6.68 / 667.13 | 702.27 |

A live feed replay and backfill for 22 profiles, including the four synthetic histories, took 8.12 seconds through the next ready checkpoint. Verification found zero differences before and after the replay. The 10,000-match update now costs about 0.7 seconds for one affected player in this run. A burst affecting several long histories can therefore increase feed lag and is reflected in the freshness headers.

For the same 146,547,586-byte real demo, first upload to HTTP 202 took 2.471 seconds before and 1.514 seconds after. The median of three duplicate uploads through Gateway was 2.472 seconds before and 1.579 seconds after. These are request timings including multipart transfer, hashing, lookup and response, excluding the asynchronous PARSE job. The new API's elapsed time after receiving the file was 103 milliseconds for the new upload and 110–163 milliseconds for ready duplicate responses. The isolated native header probe took 2.63–17.40 milliseconds per file in a separate local measurement of five authorized demos, excluding child process startup.

With the worker paused, two concurrent uploads of a second real demo (164,397,426 bytes) resolved to one queued PARSE. After restarting the worker, the same bytes returned `RESULT_READY`. Both tested demo identities had one PARSE job each. Profiles recovered the public history after being stopped while Core processed jobs. The separate PostgreSQL suite covers rollback, late revisions, replacement of duplicate representatives, the last copy's deletion and component version changes. The exact upload-limit test uses a configured synthetic 64 KiB boundary.
