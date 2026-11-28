# Who Ruined CS2

Who Ruined CS2 is a local-first analysis tool for Counter-Strike 2 match demos. It turns a Source 2 `.dem` into factual match analytics, an experimental participation rating with an auditable explanation, a small set of important moments and an interactive 2D reconstruction.

The repository is an active prototype, not a public service. The parser, rating and replay are usable locally; public hosting, multi-user isolation and causal claims are explicitly out of scope for the current release.

## What it does today

- Streams a CS2 `.dem` to local storage and processes it in a separate worker.
- Normalizes players, roster-based teams, rounds and events without treating T/CT as stable team identity.
- Computes availability-aware analytics: K/D/A, ADR, KAST, trades, openings, clutches, utility, economy and objective facts.
- Publishes one immutable `match-result@2` artifact with a content checksum and a PostgreSQL pointer. Historical H2 results remain readable.
- Exposes the seven-family H3 participation rating, MVP/Who Ruined pools and per-player coverage for new matches.
- Explains H3 through seven families with typed evidence and transformations. The final attributions plus the base value of 1 reconstruct the score within `1e-12`.
- Selects up to eight deterministic important moments per player: multikills and confirmed trades, including reliable fast-trade timing.
- Builds a factual 2D replay from sampled positions, round events and map metadata. Missing map assets or replay data remain explicit unavailable/partial states.
- Ships a React UI with 37 locales, RTL support, responsive layouts and development-only synthetic preview states. Profiles provides cumulative H3 stats and match history when enabled.

## Read the rating correctly

H3 is a deterministic, experimental participation rating. It describes recorded match evidence and uses the frozen direct-harm multiplier of two. Historical H2 retains its six-family explanation. [Scoring](docs/scoring.md).

A value can be `null` when participation or required evidence is insufficient. Missing parser output is never converted to zero. A negative contribution, especially CONTEXT, can come from model centering or an aggregate transformation rather than a discrete mistake. Ordinary deaths are match facts, not tactical blame.

See [scoring and explanation](docs/scoring.md) and [known limitations](docs/limitations.md).

## Architecture

~~~text
Browser → Gateway → Web assets / SPA
                  → Core API → Core PostgreSQL + immutable artifacts
                  → Profiles → Profiles PostgreSQL
                  → Auth → dedicated Auth PostgreSQL
Core worker → leased jobs → parser child → normalization → features → H3 / replay → artifacts
Profiles → Core's private publication feed
~~~

| Area | Location | Responsibility |
| --- | --- | --- |
| Web | `apps/web` | Routing, rendering, interaction and i18n only |
| Gateway | `apps/gateway` | Public HTTP routing, streaming and infrastructure errors |
| Core | `apps/core/{api,worker,prisma}` | Match HTTP, parsing, scoring, replay, jobs and owned database schema |
| Profiles | `apps/services/profiles` | Independent H3 history and aggregate read model with its own schema |
| Auth | `apps/services/auth` | Optional password login, JWT access and revocable refresh sessions |
| Docker | `infra/docker` | Application images and service database provisioning |
| Contracts | `packages/contracts` | Versioned Zod DTOs and public errors |
| Parser adapter | `packages/parser-adapter` | Native parser calls and capability mapping |
| Match domain | `packages/match-domain` | Parser-neutral normalization and stable roster identity |
| Features | `packages/features` | Deterministic factual analytics |
| Scoring | `packages/scoring` | Legacy reports, participation rating and explanation |
| Artifacts | `packages/artifacts` | Bounded reads and immutable publication |
| Database | `packages/database` | Prisma client, repositories and lease operations |

See the [Gateway guide](docs/api-gateway-and-service-layout.md) and [backend map](docs/backend-map.md) for routing and data ownership.

## Quick start on Windows

Prerequisites:

- Node.js 22.17 or newer.
- Corepack available with Node.
- Docker Desktop only for the recommended isolated full-stack run.

Install the pinned pnpm toolchain and dependencies:

~~~powershell
npm.cmd run setup:windows
~~~

The setup script uses the lockfile and creates a repository-local launcher; it does not modify the system PATH.

Start the isolated Docker profile:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
~~~

The dev stack starts Web, Gateway, Core, Profiles, Auth and their databases. It uses `_local-dev/data` and loopback bindings. Use `-WithoutAuth` or `-WithoutProfiles` to skip individual services, or `-CoreOnly` to start just the API, worker and Core PostgreSQL. See the [local runbook](docs/local-dev.md#start) and [Auth operator workflow](docs/auth-service.md#operator-workflow).

- Web and API origin: http://127.0.0.1:5173
- Gateway health: http://127.0.0.1:5173/healthz
- Core API health through Gateway: http://127.0.0.1:5173/api/v1/health
- Direct Core diagnostics and OpenAPI: http://127.0.0.1:3000/api/docs

Stop it without deleting its isolated data:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
~~~

For a native three-process setup, use an isolated PostgreSQL database/schema, environment variables and a non-conflicting Vite port as described in the [development guide](docs/development.md). Do not point development commands at an owner database.

## Configuration

Copy `.env.example` only as a starting point. The important controls are:

- `DATA_DIR` and `DATABASE_URL`: filesystem artifact root and PostgreSQL connection; isolate both per worktree.
- `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING`: enables rating and explanation reads.
- `RETAIN_SOURCE_DEMO`: defaults to false after verified canonical publication.
- Upload, parser, artifact and replay size limits: bounded local resource controls.
- Lease and heartbeat settings: worker ownership and recovery behavior.

The complete, code-checked table is in [development](docs/development.md#runtime-configuration).

## Checks

During development, run the smallest checks that cover the changed package, its direct consumers and the touched contract. Examples:

~~~powershell
npm.cmd run architecture:check
npm.cmd run test:packages -- --filter=@who-ruined/scoring
npm.cmd --prefix apps/web run test
npm.cmd run i18n:check
~~~

Do not run real demos unless they are explicitly authorized. Synthetic fixtures must remain labeled synthetic and cannot support real-demo claims.

`npm.cmd run quality:fast` covers architecture, lint, typecheck, workspace tests,
build, i18n and contrast. `npm.cmd run test:gateway` uses Docker and synthetic
HTTP upstreams. PostgreSQL integration and golden demos have separate commands.
See the [development guide](docs/development.md#quality-gates).

## Documentation

Start with the [documentation index](docs/README.md). The canonical references are:

- [API routes, DTOs and errors](docs/api.md)
- [Storage, jobs and artifact lifecycle](docs/storage-lifecycle.md)
- [SQLite to PostgreSQL owner migration runbook](docs/sqlite-to-postgresql-migration.md)
- [Frontend architecture](docs/frontend.md)
- [Local development and troubleshooting](docs/development.md)
- [Parser compatibility evidence](docs/compatibility.md)
- [Refactoring roadmap](docs/architecture/refactoring-roadmap.md)
- [P6 final quality report](docs/architecture/final-quality-report.md)

`SPEC.md` is normative for domain behavior. Historical M3/M4 reports remain in `docs/` as evidence and are indexed separately; they do not override the current contracts.

## Current release boundary

The dev deployment is designed for trusted local users. Optional Auth provides password login and revocable sessions. Match and Profiles endpoints remain public on the configured Gateway. Public multi-user deployment still requires TLS, authorization, isolation and an exposure review. [Auth service](docs/auth-service.md).
