# Development guide

**Status:** canonical developer-experience guide for the current local-first repository. Commands are shown for PowerShell on Windows. Use `npm.cmd`; PowerShell's `npm.ps1` can lose `--` arguments.

## Prerequisites

- Node.js 22.17 or newer.
- Corepack distributed with Node.
- Git.
- Docker Desktop with Compose v2 for the recommended full-stack path.
- No global pnpm installation is required.

The repository pins `pnpm@11.25.0` in `package.json` and Prisma/`@prisma/client@6.17.1` in the lockfile.

## Quality gates

Use the pinned pnpm launcher after setup. The routine repository gate needs no Docker, database or external demo corpus:

~~~powershell
npm.cmd run quality:fast
~~~

It performs fresh architecture (including guardrail negative tests), workspace and tooling lint, source and test typecheck, workspace/frontend tests, build, i18n and contrast checks. A non-zero nested command is propagated. Use `npm.cmd run typecheck:tests` after building the affected workspace dependencies to check only the standalone test projects.

`npm.cmd run test:gateway` exercises the same Nginx image and routes in Docker with synthetic HTTP upstreams. It does not use either application database.

PostgreSQL integration is intentionally separate and fail-closed. Create a disposable local PostgreSQL 17 database whose name contains a standalone `test` segment, then set its URL explicitly:

~~~powershell
$env:TEST_DATABASE_URL = 'postgresql://wrc_test:password@127.0.0.1:54329/wrc_test?schema=public'
npm.cmd run quality:integration
~~~

The gate rejects remote or production-like targets, applies and checks Core Prisma migrations, and runs the PostgreSQL database, Core API, worker, Profiles and Auth tests. Profiles and Auth apply their migrations in separate temporary schemas. Set `TEST_PROFILES_DATABASE_URL` or `TEST_AUTH_DATABASE_URL` to use separately provisioned disposable local test databases. An absent required database is `BLOCKED`, never a successful integration run.

External native-parser verification has two distinct entry points:

~~~powershell
# Strict pinned reconciliation: every manifest fixture and exact SHA is required.
npm.cmd run quality:golden

# End-to-end smoke of one separately approved real demo against a running dev stack.
npm.cmd run quality:real-demo -- --api=http://127.0.0.1:5173/api/v1 --demo='F:\approved\match.dem'

# After restarting API/worker, re-read the already persisted result.
npm.cmd run quality:real-demo -- --api=http://127.0.0.1:5173/api/v1 --match='<match-id>'
~~~

The smoke covers upload, PARSE, normalized match, active rating/explanation, important moments, replay, RESCORE and repeated reads. It does not turn an arbitrary demo into a golden fixture. `npm.cmd run test:golden` remains useful for an explicitly partial diagnostic run because it reports missing configured fixtures as SKIP.

## Install

From the repository root:

~~~powershell
npm.cmd run setup:windows
~~~

The script runs Corepack with the pinned pnpm version, installs with `--frozen-lockfile` and creates only a repository-local launcher under `node_modules\.bin`. It does not modify the system PATH.

Regenerate the Core Prisma client after changes to `apps/core/prisma/schema.prisma`:

~~~powershell
npm.cmd run db:generate
~~~

Do not run `db:push` or migrations against an owner database merely to start a second worktree.

For the one-time owner-data transition, follow the [SQLite to PostgreSQL migration runbook](sqlite-to-postgresql-migration.md). Do not invoke that tool against owner data without explicit permission.

## Recommended isolated full stack

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
~~~

The script:

- creates `_local-dev/data`;
- creates a random PostgreSQL password in ignored `_local-dev/postgres-password.txt` when absent;
- refuses the repository's owner `data` path;
- renders and verifies the effective Compose mounts;
- verifies that published ports are loopback-only;
- starts PostgreSQL 17 on `127.0.0.1:54329` with a named persistent volume and waits for its healthcheck;
- enables the experimental participation endpoints for the active H3 policy;
- runs Prisma migrations inside the API container;
- starts the Core API, worker, static Web, Gateway, Profiles and Auth with their databases.

Open `http://127.0.0.1:5173`. Gateway serves both Web and `/api/v1` on that origin. Direct Core diagnostics and Swagger are on loopback port 3000. Use `-WithoutAuth`, `-WithoutProfiles` or both to skip these services. Use `-CoreOnly` to start only PostgreSQL, API and worker. [Local Docker runbook](local-dev.md#start).

Auth uses a separate PostgreSQL cluster and is reachable through Gateway. See [Auth service](auth-service.md) for creating or recovering a local account and [frontend handoff](auth-frontend-handoff.md) for browser integration.

Choose non-default ports and a distinct Compose project without editing files:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 `
  -ApiPort 3010 -WebPort 5184 -PostgresPort 54330 -ProjectName wrc-other-worktree
~~~

Stop the matching Compose project without deleting its PostgreSQL volume or artifact directory:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1 -ProjectName wrc-other-worktree
~~~

The stop script loads the ignored local password and preserves `_local-dev/data` and the named PostgreSQL volume. A password-redacted resolved configuration is written to `_local-dev/compose.resolved.yml` for inspection. Do not use `docker compose down -v` unless permanent deletion of that isolated database is intended.

## Native development with an isolated database

Use native processes when hot reload is required. Provision a PostgreSQL 17 database or schema dedicated to this worktree first. The Compose PostgreSQL can be reached through its loopback port, but do not start a second API/worker against the same schema while the Compose API/worker are running.

For the default isolated Compose PostgreSQL, load its generated password and choose a schema unique to the native worktree. Run the same environment block in the API and worker terminals:

~~~powershell
$devData = [IO.Path]::GetFullPath((Join-Path (Get-Location) '_local-dev\native-data'))
New-Item -ItemType Directory -Force -Path $devData | Out-Null
$postgresPassword = (Get-Content -LiteralPath '.\_local-dev\postgres-password.txt' -Raw).Trim()
$escapedPassword = [Uri]::EscapeDataString($postgresPassword)

$env:DATA_DIR = $devData
$env:DATABASE_URL = "postgresql://who_ruined_cs2:$escapedPassword@127.0.0.1:54329/who_ruined_cs2?schema=wrc_native_refactor"
$env:ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1'
$env:RETAIN_SOURCE_DEMO = '1'
~~~

Initialize only that new schema with the reproducible migration history:

~~~powershell
npm.cmd run db:generate
npm.cmd run db:migrate
~~~

Then use three terminals.

API:

~~~powershell
$env:API_PORT = '3010'
.\node_modules\.bin\pnpm.cmd --filter @who-ruined/api dev
~~~

Worker (with the same `DATA_DIR`, `DATABASE_URL`, feature flag and policy):

~~~powershell
.\node_modules\.bin\pnpm.cmd --filter @who-ruined/worker dev
~~~

Web:

~~~powershell
.\node_modules\.bin\pnpm.cmd --filter @who-ruined/contracts build
$env:API_URL = 'http://127.0.0.1:3010'
npm.cmd --prefix apps/web run dev -- --port 5184
~~~

Open `http://127.0.0.1:5184`. The default native Vite port is 5174. Vite uses the Docker Gateway at `http://127.0.0.1:5173` when `API_URL` is unset. The explicit override above is for an independent native Core run.

Set `RETAIN_SOURCE_DEMO=0` to test normal post-publication cleanup. Keeping it at 1 is safer while diagnosing a disposable local run.

## Runtime configuration

The application validates numeric runtime values and rejects invalid ranges at startup.

A copied `.env` is input to Docker Compose; native Node processes do not load it automatically. Export native values in each terminal. The current Compose file forwards its listed upload, API, worker, replay and result controls.

| Variable | Consumer | Purpose/default |
| --- | --- | --- |
| `DATA_DIR` | API, worker | shared filesystem root; defaults to `./data` |
| `DATABASE_URL` | Prisma | explicit PostgreSQL URL; API and worker must use the same isolated database/schema |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Compose | PostgreSQL container identity/secret and loopback host port; `dev-up.ps1` supplies the secret |
| `API_BIND_HOST`, `API_PORT` | API | bind address/port; `127.0.0.1:3000` default |
| `API_CORS_ORIGINS` | API | comma-separated exact HTTP origins |
| `API_URL` | Vite | development proxy target, defaults to the Gateway at `http://127.0.0.1:5173` |
| `WEB_PORT` | Compose | Gateway loopback host port, defaults to 5173 |
| `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING` | API | Enabled by default. Use `0` to disable rating and explanation routes |
| `RETAIN_SOURCE_DEMO` | worker | `0` default; delete only after verified result binding |
| `MAX_UPLOAD_BYTES`, `MIN_UPLOAD_FREE_BYTES` | API | streamed upload ceiling and disk reserve |
| `MAX_CONCURRENT_UPLOADS`, `MAX_QUEUED_JOBS` | API | per-process upload admission and shared queue guard |
| `MAX_JSON_BODY_BYTES`, `MAX_QUERY_STRING_BYTES` | API | request limits |
| `API_REQUEST_TIMEOUT_MS`, `API_HEADERS_TIMEOUT_MS`, `API_KEEP_ALIVE_TIMEOUT_MS` | API | HTTP timeouts |
| `PARSE_TIMEOUT_MS`, `CHILD_KILL_GRACE_MS` | worker | parser process wall clock and kill grace |
| `MAX_PARSE_ARTIFACT_BYTES`, `MAX_PARSE_ARTIFACT_OUTPUT_BYTES` | worker | parser snapshot compressed/inflated bounds |
| `MAX_REPLAY_PARSE_ARTIFACT_BYTES`, `MAX_REPLAY_PARSE_ARTIFACT_OUTPUT_BYTES` | worker | replay snapshot bounds |
| `MAX_REPLAY_ROUND_COMPRESSED_BYTES`, `MAX_REPLAY_TOTAL_COMPRESSED_BYTES` | worker | replay publication bounds |
| `MAX_RESULT_COMPRESSED_BYTES`, `MAX_RESULT_JSON_BYTES`, `MAX_RESULT_JSON_DEPTH` | API, worker | canonical result read bounds |
| `WORKER_POLL_MS`, `JOB_LEASE_MS`, `JOB_HEARTBEAT_MS`, `MAX_JOB_ATTEMPTS` | worker | queue ownership and finite recovery |

`LOCAL_DATA_DIR` is a Compose mount input, not an application data root. `RAW_RETENTION_DAYS`, `PUBLIC_MODE` and `LOG_LEVEL` are not configuration inputs: no runtime or Compose service consumes them, and they must not be presented as implemented behavior.

## Targeted checks

During P0-P5 development, use the smallest check that covers the changed boundary.

~~~powershell
# Package and its direct consumers
npm.cmd run test:packages -- --filter=@who-ruined/artifacts
npm.cmd run test:packages -- --filter=@who-ruined/scoring
npm.cmd run test:packages -- --filter=@who-ruined/api
npm.cmd run test:packages -- --filter=@who-ruined/worker

# Frontend
npm.cmd --prefix apps/web run test
npm.cmd --prefix apps/web run typecheck
npm.cmd run i18n:check
npm.cmd run design:contrast

# Architecture and docs-related package graph
npm.cmd run architecture:check
~~~

A contract change normally requires its package, the immediate API/worker/web consumers and compatibility fixtures. Additional checks require a concrete risk or observed regression.

PostgreSQL integration tests require a separately provisioned, disposable PostgreSQL 17 database. The database named in `TEST_DATABASE_URL` must already exist before the command starts; the tests create and drop random schemas inside it, not the database itself. The configured role must be allowed to create and drop schemas. Multiple independent Prisma clients are used where concurrency matters:

~~~powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:54329/wrc_tests?schema=public'
npm.cmd run test:postgres
~~~

Without `TEST_DATABASE_URL`, those tests are explicitly skipped and must be reported as blocked rather than passed. Never point this variable at the active application database or any owner database.

## P6 full gate

P6 owns the repository-wide regression pass:

~~~powershell
npm.cmd run architecture:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:packages
npm.cmd run build
npm.cmd run i18n:check
npm.cmd run design:contrast
~~~

The root `npm.cmd run test` additionally invokes `tests/golden/real-demo.test.ts`. Run it only with separate authorization and the external demo/reference inputs configured. A missing external corpus is recorded as skipped/blocked, never represented as a real-demo pass.

The latest completed run, clean-checkout reproduction and intentionally unrun
external checks are recorded in
[the P6 final quality report](architecture/final-quality-report.md).

## Synthetic fixtures

Synthetic fixtures live with package/app tests and under `tests/fixtures`. They must be labeled synthetic in names, comments or UI. They are appropriate for edge cases, DTO compatibility, null handling, side switches and deterministic arithmetic. They cannot prove parser compatibility with a real demo.

The development-only frontend preview routes render synthetic states without API requests. They are UI fixtures, not integration evidence.

## Worktree isolation

Every worktree must use:

- a unique absolute `DATA_DIR`;
- a unique PostgreSQL database or schema and `DATABASE_URL`;
- a unique Compose project name and named PostgreSQL volume when using Docker;
- non-conflicting API, Vite and PostgreSQL host ports;
- its own process terminals;
- no shared mutable `data` directory.

Never solve a port conflict by attaching a refactor worktree to an already-running owner's PostgreSQL schema or data root.

## Troubleshooting

### TypeScript or ESLint reports errors only in VS Code

1. Open the repository root as the workspace. After a fresh install, run `npm.cmd run db:generate` and `npm.cmd run build` to create the Prisma client and workspace package declarations. Package exports resolve through `dist`, as they do in the runtime build. Turbo manages their build order.
2. With a TypeScript file active, run **TypeScript: Select TypeScript Version**, choose **Use Workspace Version** to use the version pinned in `package.json`, then run **TypeScript: Restart TS Server**. Run **TypeScript: Go to Project Configuration** from the affected file. A backend file in `test/` should open that folder’s `tsconfig.json`. A web test in `src/` uses the web project. Root golden tests use `tests/tsconfig.json`.
3. Compare the Problems panel's source and error code with `npm.cmd run typecheck`, `npm.cmd run typecheck:tests`, `npm.cmd run lint` and `npm.cmd run lint:tooling`. For ESLint-only differences, restart **ESLint: Restart ESLint Server** and check the **ESLint** Output channel for the resolved library and working directory.
4. For a remaining editor-only TypeScript error, set `typescript.tsserver.log` to `verbose` temporarily in user settings, restart the server, reopen the file and run **TypeScript: Open TS Server Log**. Record the SDK version, selected config, diagnostic and module resolution path, then restore the log setting. Remove personal paths before sharing logs.

### Vite says the port is already in use

The config uses `strictPort`. Stop the other process or pass a new port as shown in the native setup. Docker web uses 5173; native default uses 5174.

### API is healthy but jobs do not advance

Confirm the worker is running with the same `DATABASE_URL` and `DATA_DIR`. Check the experimental flag in the API terminal. Inspect the job DTO and worker log request/job IDs.

### Prisma cannot reach PostgreSQL

Confirm PostgreSQL 17 is running, the URL credentials/database/schema are correct and the host port is loopback-reachable. Run `npm.cmd run db:migrate` only against the intended isolated destination. API and worker must use the exact same `DATABASE_URL`; do not repair connectivity by pointing either process at an owner database.

### Rating endpoint returns disabled or policy errors

Check whether `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=0` disabled the routes. The server chooses the policy from the stored result. `REPORT_POLICY_MISMATCH` identifies an incompatible historical policy. Use the scoped H3 rebuild only when the original compatible demo is retained. [Owner rebuild](api-participation-rating.md#owner-rebuild).

### Report/replay is corrupt or not ready

Use the typed public code and `requestId`. Check the database pointer, configured data root and artifact checksum/binding; do not bypass validation or convert the state to an empty success.

### Upload stays near its initial percentage

The browser percentage measures only XHR transfer. After upload, processing is stage-based and deliberately has no invented percentage or ETA. Verify that the job changes from queued to parser/normalizer/scoring stages and that the worker owns a live lease.
