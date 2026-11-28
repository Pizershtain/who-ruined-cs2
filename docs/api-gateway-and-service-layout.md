# API Gateway and service layout

Compose serves Web and the public HTTP API at `http://127.0.0.1:5173`. Browser requests use relative `/api/v1/…` paths. Gateway dispatches requests to the process that owns the route and streams the response.

## Repository and ownership

~~~text
apps/
  gateway/             Nginx image and public route policy
  web/                 React/Vite application and static build
  core/
    api/               Core HTTP API, jobs and stored match reads
    worker/            Parser, normalization, H3, awards, replay and publication
    prisma/            Core Prisma schema and all Core migration history
  services/
    profiles/          Profiles HTTP, synchronization and owned Prisma schema
    auth/              Authentication HTTP, operator CLI and owned Prisma schema
packages/              Public contracts and domain/infra libraries
infra/docker/          Application images and database provisioning
tests/gateway/         Docker HTTP regression suite with synthetic upstreams
docker-compose.yml     Deployment entry point
~~~

Gateway routes browser traffic to Web, Core, Profiles and Auth. Nginx covers the required streaming, HTTP routing, body limits, timeouts and response handling with configuration. The Gateway image requires no Node dependencies and holds no databases, credentials or product calculations. [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

Core's API and worker share a database and artifact root. Profiles owns its database, login and migrations. It polls `http://api:3000` on the Compose network using Core's versioned, bearer-authenticated publication feed. Core commits publication revisions with match pointers and never waits on a subscriber. Replay, idempotency and failure recovery remain owned by Profiles. [Profiles protocol](player-profiles.md#publication-protocol).

## Routes

| Method | Public path | Destination |
| --- | --- | --- |
| GET | `/healthz` | Gateway liveness |
| GET | `/api/v1/health` | Core health |
| GET, POST | `/api/v1/matches` | Core match list or upload |
| GET, DELETE | `/api/v1/matches/:id` | Core match detail or deletion |
| GET | `/api/v1/jobs/:id` | Core job |
| GET | `/api/v1/matches/:id/{rounds,analytics,report,measured-stats}` | Core match data |
| GET | `/api/v1/matches/:id/{experimental-participation-rating,experimental-participation-explanation,evp,radar}` | Core rating and analytics |
| GET | `/api/v1/matches/:id/players/:playerId/{analytics,report}` | Core player data |
| GET | `/api/v1/matches/:id/replay`, `/api/v1/matches/:id/replay/rounds/:roundId` | Core replay |
| POST | `/api/v1/matches/:id/rescore` | Core RESCORE |
| GET | `/api/v1/players/:steamId/profile`, `/api/v1/players/:steamId/profile/matches` | Profiles read model |
| POST | `/api/v1/auth/{login,refresh,logout}` | Auth token lifecycle |
| GET | `/api/v1/auth/me` | Auth account |
| GET, PUT, DELETE | `/api/v1/auth/player-link` | Auth account's manual SteamID64 setting |
| GET, HEAD | SPA pages and static assets outside the API namespace | Web |

Core and Profiles allow HEAD on read routes and OPTIONS for their upstream CORS policies. Auth allows only the stated same-origin methods and rejects query strings. Gateway forwards Auth cookies and Origin only as specified by its route policy. The raw API path must use canonical separators and safe ASCII segments, with encoded colons allowed in opaque IDs. Gateway sends the same normalized path that matched the allowlist.

The internal `/api/v1/internal/match-publications` feed and `/api/v1/internal/match-publications/:id` snapshot are excluded for every HTTP method. Encoded separators, traversal and other ambiguous API paths cannot enter the proxy. Unknown API routes return JSON 404. Core Swagger at `/api/docs` and Profiles readiness at `/api/v1/ready` use the direct loopback diagnostic ports documented in the [local runbook](local-dev.md#urls).

## Operations and failure cases

~~~powershell
# Full development stack
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
# Full stack without Auth
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 -WithoutAuth
# Full stack without Profiles
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 -WithoutProfiles
# Core and PostgreSQL only, starting from a stopped stack
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 -CoreOnly
# Preserve the development database volume and artifact root
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
~~~

- `/healthz` reports the Gateway process independently of upstream state. Check `/api/v1/health` through Gateway for Core and the loopback Profiles diagnostic port for the synchronization checkpoint.
- An unreachable upstream produces JSON `503 UPSTREAM_UNAVAILABLE`. A stalled upstream produces `504 UPSTREAM_TIMEOUT`. Upstream JSON errors, including upstream 503s, retain their own code and request ID. Structured edge logs include the public request ID, edge request ID, method, status and latency. Gateway replaces incoming forwarding and request-ID headers with values generated at the edge.
- Gateway resolves upstreams at request time through Docker DNS. If Profiles stops, Core requests keep working. If Core stops, Profiles can still serve its last committed projection. Worker processing and Profiles polling have no dependency on Gateway. Restore an individual Compose service to resume routing. The direct diagnostic ports remain bound to loopback.
- If Auth is unreachable, its routes return `503 AUTH_UNAVAILABLE`. Core and Profiles retain their own routing and data lifecycle. Auth readiness, migrations and operator operations are private. See the [Auth service](auth-service.md).
- API request and response buffering is disabled. The Gateway ceiling is 2049 MiB, with room for multipart framing around Core's 2 GiB maximum configurable demo limit. Core still enforces its lower configured limit. The edge uses 15 seconds for headers, 3 seconds to connect and 60 seconds of idle time for body or upstream I/O. POST and DELETE are never retried by Gateway.
- Same-origin traffic needs no cross-origin exception. Other browser origins are evaluated by upstream CORS policy. The trusted local and LAN deployment uses HTTP. External deployment needs its own TLS and authentication policy, and correct explicit origins if terminating HTTPS in front of Gateway.
- Validate the rendering before a local launch. The dev script combines Compose files, checks loopback bindings and verifies the exact `_local-dev/data` mount. Only the separate Windows LAN helper exposes the Gateway origin on a private subnet. See the [local runbook](local-dev.md#optional-home-lan-access).

## Add a service

Place a separately deployable capability under `apps/services/<name>`. Give it an entry point, owned data and migrations as needed, and health checks. Publish versioned contracts through `packages/contracts`. Add its Compose configuration, boundary rules and an explicit method/path allowlist in [routes.conf](../apps/gateway/config/routes.conf), then extend the [Gateway HTTP tests](../tests/gateway/gateway.test.mjs). Declare versioned cross-service dependencies and how the consumer catches up after a restart.

Local checks are `npm.cmd run quality:fast` and `npm.cmd run test:gateway`. The latter starts Docker with synthetic HTTP fixtures and no PostgreSQL. CI runs both as separate jobs. PostgreSQL integration uses a separately named test database as described in the [development guide](development.md#quality-gates).
