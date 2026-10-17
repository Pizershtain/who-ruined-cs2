# Frontend ↔ backend integration E2E

Validated locally on 2026-10-17. This document deliberately omits local demo
paths, filenames, nicknames, Steam IDs, match IDs and job IDs. Real `.dem`,
`.dem.info`, SQLite and generated reports remain outside Git.

## Runtime

The verified development topology is three local processes sharing the existing
SQLite database and `data/` artifact directory. No schema migration was needed.
From the repository root in three PowerShell windows, after dependencies and a
build are available:

```powershell
# API
$env:DATA_DIR = (Resolve-Path .\data).Path
$env:DATABASE_URL = 'file:../data/app.db'
.\node_modules\.bin\pnpm.cmd --filter @who-ruined/api dev
```

```powershell
# Worker
$env:DATA_DIR = (Resolve-Path .\data).Path
$env:DATABASE_URL = 'file:../data/app.db'
.\node_modules\.bin\pnpm.cmd --filter @who-ruined/worker dev
```

```powershell
# Web (Vite proxy targets localhost:3000 by default)
npm.cmd run dev:web
```

Open <http://localhost:5173>. API health is
<http://localhost:3000/api/v1/health>. Stop each process with `Ctrl+C`.
For a different API proxy target, set `API_URL` before starting the web process.
The browser calls same-origin `/api`; the API does not enable general CORS.

First-time setup remains `npm.cmd run setup:windows`; the non-destructive
project build is `npm.cmd run build`. Do not run `db:push` merely to start an
existing database. Follow the root README for a genuinely new database.

## Real-demo evidence

One external real demo was followed end-to-end in detail:

| Check | Observed result |
| --- | --- |
| Upload | HTTP success; new match/job, `duplicate=false` |
| Worker stages | `QUEUED → PARSING → NORMALIZING → VALIDATING → FEATURIZING → SCORING → COMPLETED` |
| Basic report | `de_dust2`, stable roster score `5:13`, 18 valid rounds, 10 players in two five-player rosters |
| Identity | 10 parsed display names and 10 valid string SteamID64 values; internal nickname links and separate Steam links |
| Independent sidecar | all 18 round-score transitions and all 10 K/D/A rows PASS against adjacent `.dem.info` |
| M2 | 10 player rows; match/player analytics decoded through shared schemas |
| M3 | 10 player rows, 18 round rows, full coverage, experimental marker; MVP belongs to the 10-player field and Who Ruined to the losing five |
| Player report | matching player identity, per-player episodes and all 18 round rows |
| Dedup | second upload returned the same match/job with `duplicate=true`; no new match row |
| Rescore | alternate registered config produced a new scoring job/report and matching version/hash; observed `SCORING → COMPLETED`, with no parse stage |

An earlier external demo also completed upload/worker/report generation, but
only its terminal state was observed; intermediate stages are not claimed for
that run.

The batch validator independently discovered 9 external demos with adjacent
sidecars: 9 PASS, 0 PARTIAL, 0 FAIL, 0 SKIPPED. This is separate from internal
consistency. The batch scorer processed 9/9 with 0 failures. The reports were
written only under ignored `data/reports/`, use anonymized identifiers and were
not committed. The authoritative game-mode field was absent for the detailed
demo, so that subcheck is SKIPPED rather than PASS.

## HTTP and browser checks

Observed HTTP behavior:

- 200 for M1, M2 match/player and M3 match/player reports;
- 202 for RESCORE, followed by a terminal completed job;
- 409 for legacy/missing scoring artifacts;
- 404 for missing match and missing player reports;
- 422 for an unknown scoring configuration and for an invalid demo;
- SHA-256 re-upload dedup returned `duplicate=true`.

The browser was checked through the accessibility tree on the live real report,
not a preview fixture. It showed the real map/score, two stable rosters, 10 rows,
localized M2/M3 columns, experimental and relative-index warnings, coverage,
MVP/Who Ruined, round selection with a server-provided player ledger, player
drill-down, separate Steam link, and positive/error/all episode filters. The
large episode list is paginated in the client. Direct deep-link load and refresh
were also exercised. Advanced replay/video is still described as future work.

The wrong-extension and maximum-size states are covered by the upload validator
and focused unit tests; they were not produced from a genuine demo during this E2E.
Likewise, worker failure presentation and report-not-ready timing remain
automated/synthetic checks, not observed failures of the successful real run.

## Integration fixes and boundaries

- Added shared schemas for round/player scoring projections and a typed M3 API
  client/query layer.
- Connected match and player routes to live M3 reports while retaining M1/M2
  when M3 is unavailable.
- Enforced match, roster, unique-player and losing-roster membership at the UI
  adapter boundary.
- Rendered only backend-computed components, leaders, episodes and round net;
  unavailable values remain unavailable.
- Removed probability-like confidence presentation for ranking margins and
  added the experimental/relative-index/no-confirmed-harm semantics.
- Kept internal player links separate from external Steam links.
- Added bounded episode rendering and focused contract/integration tests.
- Kept `/preview/*` synthetic and development-only; it is never a live fallback.

Open integration limitations:

1. Episode `explanationKey` is not yet mapped to localized prose; the UI shows
   the neutral backend type and facts.
2. RESCORE has a typed client function but no product selector/control.
3. Episode delivery is not server-paginated; only rendering is bounded.
4. General cross-origin browser access is not configured; use the Vite/Docker
   proxy for local operation.
5. Steam/FACEIT import, 2D replay, trajectories and clips remain unimplemented.
