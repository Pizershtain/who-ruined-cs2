# Backend map

This is the shortest path through the local backend. Historical research names
remain inside frozen schema/version strings where compatibility requires them;
active source filenames describe their current responsibility.

## Components

| Area | Primary location | Responsibility |
| --- | --- | --- |
| HTTP API | `apps/api/src/matches.controller.ts`, `matches.service.ts` | Upload, jobs, match/M2/report reads, RESCORE and the opt-in participation-rating endpoint. |
| API storage guard | `apps/api/src/match-result-storage.ts` | Bounded, checksum-verified reads of the canonical result bound to SQLite. |
| Worker lifecycle | `apps/worker/src/main.ts`, `process-job.ts`, `reconcile.ts` | Lease-owned jobs, recovery, parse/normalize/score orchestration and cleanup. |
| Native parser boundary | `apps/worker/src/parser-{boundary,supervisor,child}.ts` | Owned subprocess, hard timeout and bounded parser artifact handoff. |
| Normalized domain | `packages/match-domain/src/` | Stable roster-team identities, validated rounds and normalized events. |
| Factual analytics | `packages/features/src/` | Availability-aware M2 metrics; no rating or tactical blame. |
| Participation inputs | `apps/worker/src/prepared-participation-input.ts`, `participation-sidecar.ts` | Build six-family inputs and participation evidence while raw demo facts are available; legacy sidecar support remains for migration. |
| Participation scoring | `packages/scoring/src/participation-family-kernel.ts`, `participation-rating.ts` | Shared six-family kernel and frozen owner-selected H2/H1 projection. |
| Canonical result | `packages/scoring/src/active-match-result.ts`, `apps/worker/src/match-result-storage.ts` | Create/rebuild and atomically publish one `match-result@1` gzip artifact. |
| SQLite accounting | `packages/database/src/`, `prisma/schema.prisma` | Match/job ownership, leases, deduplication and canonical-result pointers. |

## Data flow

```text
.dem upload
  → SQLite match + queued PARSE job
  → owned parser child with hard timeout
  → normalized roster teams, rounds and events
  → factual M2 analytics + production report
  → prepared participation inputs + one owner-selected H2/H1 rating
  → atomically published match-result@1.json.gz
  → SQLite result binding
  → versioned HTTP match / analytics / report / participation responses
```

The worker removes a source demo only after publication and SQLite binding are
verified, unless explicit debug retention is enabled. HTTP reads never reparse
or silently rebuild a result.

## Owner policy and stable boundaries

- `ACTIVE_RATING_POLICY=H2` is the primary owner policy; `H1` is the permanent
  fallback. `rating:rebuild` switches from the retained recompute seed without
  a demo. HTTP policy selectors remain forbidden.
- Do not rename or reinterpret H2/H1 IDs and digests, schema/version strings,
  `match-result@1`, database columns/statuses, HTTP URLs, DTO fields, error
  codes or runtime environment variables as a readability cleanup.
- Stable teams are roster-derived, never inferred from T/CT. Missing parser
  values remain unavailable/null. Ordinary deaths are facts, not blame.

API details are in `docs/api-participation-rating.md`; storage and lifecycle
details are in `docs/m4.3-compact-result-and-lifecycle.md`.
