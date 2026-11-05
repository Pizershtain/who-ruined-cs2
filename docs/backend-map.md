# Current architecture map

**Status:** canonical architecture reference after refactoring stages P0-P5. For design rationale and remaining P6 work, see [the roadmap](architecture/refactoring-roadmap.md). `SPEC.md` is normative for domain semantics.

## Boundary rules

1. Native parser output ends in `@who-ruined/parser-adapter`.
2. `@who-ruined/match-domain` receives a parser-neutral `NormalizationInput`; it never imports demoparser2 rows or aliases.
3. `@who-ruined/features` computes factual, availability-aware analytics only.
4. `@who-ruined/scoring` owns rating/report arithmetic and cannot be moved into API or UI.
5. `@who-ruined/artifacts` owns bounded validation and immutable filesystem publication.
6. API and worker depend on database ports/repositories, not ad hoc Prisma access in domain code.
7. Frontend feature modules consume versioned DTOs and render `null`/availability; they do not reproduce backend formulas.
8. A stable team is roster-based. T/CT is a per-round side, never a team identifier.

The repository enforces package/app direction through `npm.cmd run architecture:check`.

## Applications

### `apps/api`

The Nest application keeps transport controllers separated by capability while
sharing one match provider scope:

- `modules/health`: health route.
- `modules/matches`: provider composition plus upload, match list/detail, rounds,
  job status and deletion routes.
- `modules/reports`: legacy report, analytics, rescore, active rating and rating
  explanation controllers.
- `modules/replay`: replay index and round controllers.
- `application/use-cases`: orchestration independent of Nest decorators.
- `application/ports.ts`: storage/system boundaries used by use cases.
- `infrastructure`: Prisma/file-backed adapters and runtime services.
- `http`: public error mapping and request concerns.

`MatchesModule` registers all three match-facing controllers directly; report and
replay do not add empty pass-through Nest modules. Controllers validate transport
input and delegate. They do not parse demos or calculate ratings. Root
`health.controller.ts` and `matches.controller.ts` are source-compatibility barrels
used by existing tests; new code imports capability controllers directly.

### `apps/worker`

The worker owns background state transitions and artifact production:

- `runner/worker-runner.ts`: polling, lease acquisition, heartbeat and loop ownership.
- `job-lifecycle.ts`: stage transitions and fenced completion/failure.
- `parser-boundary.ts` and `parser-child.ts`: directly owned native parser child, timeout/abort lifecycle and bounded artifact envelope.
- `parse-pipeline.ts`: normalization, features, reports, participation, replay and canonical result assembly.
- `rescore-pipeline.ts`: compatible report rebuild from stored `match-result@1`.
- `replay-artifact.ts`: replay DTO construction/publication.
- `reconcile.ts`: startup cleanup and crash-window recovery.
- `runner/worker-dependencies.ts`: composition of repositories, clock, filesystem and pipeline dependencies.

The worker owns full demo parsing and is the only production service that requests
event/tick snapshots. API ingestion performs a bounded Source 2 magic preflight
and an isolated, time-bounded native header probe, then queues the file for worker
parsing; controllers and application use cases do not see native rows.

### `apps/web`

The React application uses an app shell plus capability modules. See [frontend architecture](frontend.md).

## Shared packages

| Package | Owns | Does not own |
| --- | --- | --- |
| `@who-ruined/contracts` | Zod DTOs, schema versions, public error codes | persistence or UI view models |
| `@who-ruined/parser-adapter` | native calls, aliases, decoding, replay sampling, participation evidence | roster/domain decisions |
| `@who-ruined/match-domain` | normalization, stable IDs, team/round/event model | native parser API |
| `@who-ruined/features` | deterministic M2 facts and availability | ranking or blame labels |
| `@who-ruined/scoring` | legacy report builders, participation kernel/projection, explanation, important moments | transport or persistence |
| `@who-ruined/artifacts` | safe paths, gzip bounds, schema/binding checks, immutable publish | job policy |
| `@who-ruined/database` | Prisma client, repositories, lease/fencing transactions | business arithmetic |
| `@who-ruined/validation` | validation/comparison CLIs and golden-test adapters | production request handling |
| `@who-ruined/testkit` | explicitly synthetic factories and test fixtures | runtime data |

## Ingestion and publication flow

~~~text
POST .dem
  -> API streams a bounded multipart part to uploads/<match>/<sha>.dem
  -> API transaction creates match + queued PARSE job
  -> worker claims job with lease token
  -> directly owned parser child writes a bounded match envelope and replay snapshot
  -> parser-adapter decodes rows into NormalizationInput
  -> match-domain normalizes roster teams, rounds and events
  -> features computes factual analytics with availability
  -> scoring builds legacy reports + active H2 result
  -> replay builder publishes index + round artifacts when evidence is available
  -> artifact store publishes match-result@1 immutably
  -> database transaction binds result path/SHA and terminal job state
  -> source demo is removed only after binding is verified and policy permits
~~~

Filesystem and PostgreSQL cannot share a transaction. Publication therefore uses immutable content, SHA-256 binding, lease fencing, intent state and startup reconciliation. The exact ordering is in [storage lifecycle](storage-lifecycle.md).

## Read flow

~~~text
HTTP route
  -> application use case
  -> match repository + artifact reader
  -> bounded decompression + checksum/schema/binding validation
  -> versioned DTO projection
  -> public error mapper
~~~

The active rating and explanation use the rating already stored inside `match-result@1`. The API never reads `.dem` for GET requests and never exposes the internal recompute seed or policy digest.

Replay reads validate the replay index first, then the requested round and its binding. A missing/corrupt replay has typed errors and does not invalidate the canonical match result.

## Rescore and rating rebuild flows

`POST /api/v1/matches/:id/rescore` creates a `RESCORE` job for a requested compatible scoring report. The worker reads the normalized artifact embedded in `match-result@1`, recomputes that report, publishes a new immutable result and swaps the database pointer. It does not need the original `.dem`.

The owner-only `rating:rebuild` command reconstructs H2 from the private recompute seed, calls the same active rating builder used by new parses, then conditionally replaces the canonical result. It is the explicit transition path for historical H1 results. Legacy artifacts without sufficient stored input fail instead of inventing evidence.

## Dependency direction

~~~text
worker -> parser-adapter -> match-domain -> features -> scoring
api    -> application ports -> database / artifacts / scoring adapters
api ingestion infrastructure -> parser-adapter (version constants + isolated header probe)
worker -> database + artifacts
web    -> contracts + HTTP DTOs
all versioned boundaries -> contracts
~~~

More precisely, domain packages may depend on contracts and lower-level pure packages, but they do not import application code. API and worker are composition roots. The web application cannot import parser, database, feature or scoring implementations.

## Runtime topology

The supported local topology is one API process, one or more lease-coordinated worker processes, one Vite/static web process, one PostgreSQL 17 database and one shared artifact data root. API and worker use independent Prisma connections to the same database. Defaults bind HTTP and PostgreSQL host ports to loopback.

This is a trusted-owner architecture. Authentication, tenant isolation, cross-process admission control and public object storage are not implemented; see [limitations](limitations.md).
