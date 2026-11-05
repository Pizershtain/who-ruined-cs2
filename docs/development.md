# Development guide

**Status:** canonical developer-experience guide for the current local-first repository. Commands are shown for PowerShell on Windows. Use `npm.cmd`; PowerShell's `npm.ps1` can lose `--` arguments.

## Prerequisites

- Node.js 22.17 or newer.
- Corepack distributed with Node.
- Git.
- Docker Desktop with Compose v2 for the recommended full-stack path.
- No global pnpm installation is required.

The repository pins `pnpm@11.25.0` in `package.json` and Prisma/`@prisma/client@6.17.1` in the lockfile.

## Install

From the repository root:

~~~powershell
npm.cmd run setup:windows
~~~

The script runs Corepack with the pinned pnpm version, installs with `--frozen-lockfile` and creates only a repository-local launcher under `node_modules\.bin`. It does not modify the system PATH.

Regenerate the Prisma client after a schema/client checkout change:

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
- enables the experimental participation endpoints; H2 is the only policy;
- runs Prisma migrations inside the API container;
- starts API, worker and web.

Open `http://127.0.0.1:5173`. API and Swagger are at `http://127.0.0.1:3000/api/v1` and `http://127.0.0.1:3000/api/docs`.

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

Open `http://127.0.0.1:5184`. The normal native default is 5174; using an explicit alternate port prevents a collision with another worktree. Vite proxies `/api` to `API_URL`.

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
| `API_URL` | Vite | development proxy target; `http://127.0.0.1:3000` default |
| `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING` | API | `1` enables rating and explanation routes |
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

### Vite says the port is already in use

The config uses `strictPort`. Stop the other process or pass a new port as shown in the native setup. Docker web uses 5173; native default uses 5174.

### API is healthy but jobs do not advance

Confirm the worker is running with the same `DATABASE_URL` and `DATA_DIR`. Check the experimental flag in the API terminal. Inspect the job DTO and worker log request/job IDs.

### Prisma cannot reach PostgreSQL

Confirm PostgreSQL 17 is running, the URL credentials/database/schema are correct and the host port is loopback-reachable. Run `npm.cmd run db:migrate` only against the intended isolated destination. API and worker must use the exact same `DATABASE_URL`; do not repair connectivity by pointing either process at an owner database.

### Rating endpoint returns disabled or policy errors

Set `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` in the API. Do not add a `policy` query parameter. `REPORT_POLICY_MISMATCH` means the stored historical result must be explicitly rebuilt to H2 with `rating:rebuild`.

### Report/replay is corrupt or not ready

Use the typed public code and `requestId`. Check the database pointer, configured data root and artifact checksum/binding; do not bypass validation or convert the state to an empty success.

### Upload stays near its initial percentage

The browser percentage measures only XHR transfer. After upload, processing is stage-based and deliberately has no invented percentage or ETA. Verify that the job changes from queued to parser/normalizer/scoring stages and that the worker owns a live lease.
