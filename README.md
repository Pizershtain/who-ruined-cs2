# Who Ruined CS2

Local-first CS2 demo analysis. The repository contains the validated M0/M1
vertical slice, M2 factual analytics and an experimental M3-B backend:
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

## Local development

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
are deterministic, versioned and explicitly experimental. See
`docs/frontend-backend-contract.md`; `tests/fixtures/m3-scoring-report.json` is
the anonymous frontend fixture.

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

M3-C scoring calibration and M4 robustness remain outside this gate.
No public deployment is configured.

## Frontend and translations

See [docs/frontend.md](docs/frontend.md) for Windows setup, routes, API integration,
design previews, localization checks and backend requirements. Translation instructions
are in [AGENTS.md](AGENTS.md). Start with `pnpm.cmd run setup:windows`, then
`pnpm.cmd run dev:web` (http://localhost:5173, Ctrl+C to stop).
