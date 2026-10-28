# Local Windows development stand

This stand runs the current API, worker and merged frontend in Docker. It is
localhost-only and keeps all mutable state under ignored `_local-dev/`; it does
not mount or migrate the repository's owner `data/` directory.

## Requirements and start

Verified toolchain: Node.js 22.17.0, npm 10.9.2, pnpm 11.25.0, Docker Engine
29.7.2 and Docker Compose 5.5.1. Start Docker Desktop first, then run from the
repository root in Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
```

The script creates `_local-dev/data`, prints the complete resolved Compose
configuration, saves it as `_local-dev/compose.resolved.yml`, and refuses to
start unless both `/data` mounts resolve to that directory and every published
port uses `127.0.0.1`. It builds and starts project `wrc-local-dev` with the
existing migrations, the participation feature flag enabled and owner policy
H2.

- Web: http://127.0.0.1:5173
- API health: http://127.0.0.1:3000/api/v1/health
- Swagger: http://127.0.0.1:3000/api/docs
- OpenAPI JSON: http://127.0.0.1:3000/api/docs-json

If port 3000 is occupied, choose another loopback API port. The container web
proxy still talks to API over the Compose network:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 -ApiPort 3301
```

## Logs, stop and restart

Follow backend logs and inspect service state:

```powershell
docker compose -p wrc-local-dev -f .\docker-compose.yml -f .\docker-compose.local-dev.yml logs -f api worker
docker compose -p wrc-local-dev -f .\docker-compose.yml -f .\docker-compose.local-dev.yml ps
```

The upload response contains `jobId`. Its current state is available at
`http://127.0.0.1:3000/api/v1/jobs/<jobId>`.

Stop only this stand without deleting containers, images, volumes or data:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
```

Run `dev-up.ps1` again to restart or rebuild. `_local-dev/data/app.db` and
`_local-dev/data/results/*/*.match-result@1.json.gz` survive stop/restart. A
quick restart of the already-created stand is:

```powershell
docker compose -p wrc-local-dev -f .\docker-compose.yml -f .\docker-compose.local-dev.yml restart
```

There is deliberately
no automatic cleanup command. If the owner later chooses to clear the stand,
first stop it and remove only `_local-dev`; never use `down -v`, `prune`, or a
global Node process kill.

## Data isolation and rating policy

The SQLite database is `_local-dev/data/app.db`. Uploads, temporary parser
artifacts and canonical `match-result@1.json.gz` files share the same isolated
tree. Before uploading, confirm that `_local-dev/compose.resolved.yml` contains
`source: ...\_local-dev\data` for both `/data` mounts and never the owner
`...\data` path.

`ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` and
`ACTIVE_RATING_POLICY=H2` are supplied to API and worker. HTTP callers cannot
select H1. To switch the isolated backend to permanent fallback H1 without
reparsing, stop the stand, rebuild the stored owner-selected result through the
existing CLI, then start both services with H1:

```powershell
$env:LOCAL_DATA_DIR = (Resolve-Path .\_local-dev\data).Path
$env:ACTIVE_RATING_POLICY = 'H1'
docker compose -p wrc-local-dev -f .\docker-compose.yml -f .\docker-compose.local-dev.yml run --rm --no-deps worker pnpm --filter @who-ruined/worker rating:rebuild -- --dry-run
docker compose -p wrc-local-dev -f .\docker-compose.yml -f .\docker-compose.local-dev.yml run --rm --no-deps worker pnpm --filter @who-ruined/worker rating:rebuild -- --apply
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 -RatingPolicy H1
```

Use the same flow with `H2` to return to primary. Never add `?policy=H1` to an
HTTP request: that is intentionally rejected with typed 422
`INVALID_POLICY_SELECTOR`. The retired `/experimental-rating` route remains
unavailable.

## Manual browser check

1. Open http://127.0.0.1:5173 and select a supported `.dem` from an external
   read-only source such as `F:\CS2 Demos`; the browser uploads a copy.
2. Follow the job page until the API reports `COMPLETED`, then open the match.
3. Open a player from the roster. Confirm basic match, M2 and legacy report
   data load without a CORS/network error.
4. Independently inspect
   `/api/v1/matches/<matchId>/experimental-participation-rating`; it returns the
   single owner-selected H2 or H1 model. The current frontend does not yet call
   this new DTO, so absence of H2/H1 presentation in the UI is a frontend
   integration task, not a backend failure.
5. Refresh the match page, stop and start the stand, and open the same URL
   again to confirm persistence.

The readiness smoke used one fresh external Dust2 upload: 10 players, 16
rounds, completed job, M1/M2 and legacy report available, H2 canonical result
available, and the same result readable after restart. This is one smoke run,
not a repeat of the three-demo golden suite or the full corpus.

## Troubleshooting

- **Docker is unavailable:** start Docker Desktop and wait for Engine Running.
- **Port is occupied:** use `-ApiPort 3301` for API; release 5173 before start.
- **Proxy/CORS:** the browser must use web port 5173 and relative `/api/v1/...`;
  Compose web proxies to `http://api:3000`. Both localhost and 127.0.0.1:5173
  are allowed origins.
- **Migration failure:** inspect `docker compose ... logs api`; a new dev DB
  must show all migrations applied. Do not run reset or `db push` on owner data.
- **Participation 404:** confirm the API and worker both have
  `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` in the resolved config.
- **`409 REPORT_POLICY_MISMATCH`:** run the owner rebuild dry-run/apply for the
  chosen H2/H1 policy, then restart both backend services with that policy.
- **Frontend shows base data but no H2/H1:** this is expected until the separate
  frontend integration consumes the active participation DTO.
