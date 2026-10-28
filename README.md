# Who Ruined CS2

Local-first CS2 demo analysis. The repository contains the validated M0/M1
vertical slice, M2 factual analytics and an experimental M3-B backend/UI integration:
parser → normalized facts → deterministic features → versioned scoring reports.

> Status: **M0 and M1 passed on three external real golden demos:** Office,
> Dust2 and Train. The `.dem`/`.dem.info` files remain outside Git. The required
> three-demo count is met. A later nine-demo batch contains two real team-kill
> cases; the overtime gate remains open. M2 derived metrics pass unit tests and real-demo consistency checks,
> but independent ADR/KAST/trade ground truth is not available.

## Start with Docker

Requirements: Docker Desktop with Compose.

```bash
docker compose up --build
```

- UI: <http://localhost:5173>
- API health: <http://localhost:3000/api/v1/health>
- OpenAPI: <http://localhost:3000/api/docs>

Both published ports bind to host loopback. Uploaded demos and SQLite data remain under `./data` and are ignored by Git.

The backend upload path streams multipart data directly to a random file under
`DATA_DIR/uploads`; it does not buffer the complete demo in the Node heap. The
local default `MAX_UPLOAD_BYTES` is 536870912 bytes (512 MiB), with a separate
256 MiB free-space reserve. Both values are finite and configurable. The 512
MiB default was selected from a read-only audit of the available local corpus;
it is a supported upload ceiling, not a promise that every demo below it will
parse within the worker timeout or memory limit.

For an isolated Compose run, set `LOCAL_DATA_DIR` to a dedicated empty host
directory and optionally set `API_PORT` to a free loopback port. `DATA_DIR`
inside the containers remains `/data`:

```powershell
$env:LOCAL_DATA_DIR = '<dedicated-empty-directory>'
$env:API_PORT = '3301'
docker compose -p wrc-isolated up --build api worker
```

Never point an isolated test at the normal `./data` directory. The API
container is limited to 512 MiB RAM / 1 CPU and the native-parser worker to 2
GiB RAM / 2 CPUs by the supplied Compose file. Upload failures use stable
codes: `SIZE_LIMIT` (413), `INVALID_DEMO` (415/422),
`INGESTION_PERSISTENCE_FAILED` (503), and `STORAGE_UNAVAILABLE` (507).

## Local development

For the isolated Windows Docker stand used for manual real-demo verification,
including start, logs, stop, restart and H2/H1 owner policy commands, see
[`docs/local-dev.md`](docs/local-dev.md).

Node.js 22.17+ and pnpm 11.25 are pinned for this milestone.

```bash
pnpm install
copy .env.example .env
pnpm db:generate
pnpm db:push
pnpm dev
```

On PowerShell set `DATABASE_URL=file:../data/app.db` if your environment does not load `.env` automatically (Prisma resolves it relative to `prisma/schema.prisma`).

## Mandatory real-demo probe

```bash
pnpm parser:probe -- C:\path\to\match.dem
```

The command calls `parseHeader`, `parsePlayerInfo`, `listGameEvents`,
`parseEvents`, and event-adjacent `parseTicks`, then writes a sanitized probe
report. It never stores player values. The committed cross-fixture report in
`docs/compatibility.md` also records the manual three-demo reconciliation. See
`tests/golden/README.md` for the path variables and skip behavior.

With an external `.dem.info` sidecar, run the real reconciliation without
copying either file into the repository:

```powershell
$env:GOLDEN_OFFICE_DEMO_PATH = 'C:\external\office.dem'
$env:GOLDEN_OFFICE_INFO_PATH = 'C:\external\office.dem.info'
$env:GOLDEN_DUST2_DEMO_PATH = 'C:\external\dust2.dem'
$env:GOLDEN_DUST2_INFO_PATH = 'C:\external\dust2.dem.info'
$env:GOLDEN_TRAIN_DEMO_PATH = 'C:\external\train.dem'
$env:GOLDEN_TRAIN_INFO_PATH = 'C:\external\train.dem.info'
pnpm test:golden
```

The M1 scoreboard displays the parsed nickname and keeps a separate Steam
profile link for every validated SteamID64. SteamID64 is always handled as a
string.

## M2 API

- `GET /api/v1/matches/:id/analytics` returns schema `m2-1`.
- `GET /api/v1/matches/:id/players/:playerId/analytics` returns one player's
  factual metrics and contribution/error/neutral facts without a score.
- `tests/fixtures/m2-match-analytics.json` is an anonymized synthetic fixture
  for frontend integration; it is not real-demo evidence.

See `docs/api-m2.md` for availability/null semantics and metric definitions.

## M3-B scoring API

- `GET /api/v1/matches/:id/report?version=...&configHash=...`
- `GET /api/v1/matches/:id/players/:playerId/report?version=...&configHash=...`
- `POST /api/v1/matches/:id/rescore` with `{ "scoringVersion": "...", "configHash": "..." }`

Rescore reads the stored `m2-artifact-1` and never reparses the demo. Reports
are deterministic, versioned and explicitly experimental. The live UI consumes
the shared M3 contracts without recalculating scores or falling back to fixtures. See
`docs/frontend-backend-contract.md`; `tests/fixtures/m3-scoring-report.json` is
the anonymous frontend fixture.

## Active participation result

The participation-aware candidate remains on a separate, default-off backend
route, but M4.3 now exposes one owner-selected active policy:

```text
GET /api/v1/matches/:id/experimental-participation-rating
```

Set `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` for both the API and worker.
Set `ACTIVE_RATING_POLICY=H2` (default PRIMARY) or `H1` (permanent FALLBACK) on
the backend. HTTP `?policy=` selection is forbidden. New completed matches keep
one `match-result@1` gzip JSON and delete the source only after verified
publication and SQLite binding. GET never parses or backfills.

To change the owner policy without a demo, cache or sidecar:

```powershell
$env:ACTIVE_RATING_POLICY = 'H1'
npm.cmd run rating:rebuild -- --dry-run
npm.cmd run rating:rebuild -- --apply
```

See `docs/api-participation-rating.md` for the versioned DTO, availability
codes, award pools and errors. `docs/frontend-handoff-participation-rating.md` is
the backend-only handoff. Storage, migration, deletion and recovery are in
`docs/m4.3-compact-result-and-lifecycle.md`. Historical migration is explicit:

```powershell
npm.cmd run result:migrate -- --dry-run
npm.cmd run result:migrate -- --apply
```

Migration never deletes legacy files automatically.

The obsolete P2/C2+S2 HTTP route was retired in M4.5. Historical files are not
deleted automatically, while the shared prepared-input kernel remains internal
because H2/H1 reconstruction depends on it.

## Batch validation

```powershell
pnpm validate:demos "F:\CS2 Demos"
pnpm score:demos "F:\CS2 Demos"
```

The validator recursively discovers arbitrary `.dem` names, matches adjacent
`.dem.info` sidecars, isolates each native parse in a child process, and writes
an anonymized JSON report under `data/reports/`. A failed or truncated demo is
reported as `FAIL` without stopping the remaining batch. The exported report
contains SHA-256 prefixes and anonymous aggregates, not paths, filenames,
nicknames or SteamID values.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

M3-C scoring calibration remains experimental. M4.2 isolates the synchronous
native parser behind an owned OS-process boundary, applies a real wall-clock
hard timeout, and uses renewable lease tokens plus immutable publication for
bounded worker recovery. Relevant worker settings are `JOB_LEASE_MS`,
`JOB_HEARTBEAT_MS`, `MAX_JOB_ATTEMPTS`, `CHILD_KILL_GRACE_MS`,
`MAX_PARSE_ARTIFACT_BYTES` and `MAX_PARSE_ARTIFACT_OUTPUT_BYTES`. Deletion,
retention and compact-result lifecycle are implemented in M4.3. M4.4 adds
finite upload/queue admission, strict HTTP inputs, bounded gzip inflation and
container resource limits; see `docs/m4.4-backend-hardening.md`. Public
deployment remains out of scope.
No public deployment is configured.

For a concise map of backend components and the `.dem` to HTTP data flow, see
[`docs/backend-map.md`](docs/backend-map.md).

## Frontend and translations

See [docs/frontend.md](docs/frontend.md) for Windows setup, routes, API integration,
design previews, localization checks and backend requirements. Translation instructions
are in [AGENTS.md](AGENTS.md). Start with `pnpm.cmd run setup:windows`, then
`pnpm.cmd run dev:web` (http://localhost:5173, Ctrl+C to stop).
