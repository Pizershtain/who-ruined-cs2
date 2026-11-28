# Isolated local Docker runbook

**Status:** current Compose operations. For installation, native hot reload, environment variables and checks, use [development](development.md).

## Start

From the intended worktree:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
~~~

Optional parameters:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1 `
  -ApiPort 3010 -WebPort 5184 -PostgresPort 54330 -ProjectName wrc-other-worktree
~~~

The script combines `docker-compose.yml` and `docker-compose.local-dev.yml` under project `wrc-local-dev` by default. Before starting it verifies:

- API and worker mount exactly `<worktree>\_local-dev\data` at `/data`;
- that path is not the owner `data` directory;
- Gateway and diagnostic published ports are loopback-only and distinct. The Web container has no published port;
- a password-redacted effective configuration is saved at `_local-dev\compose.resolved.yml`.

The script creates an ignored random PostgreSQL password, starts PostgreSQL 17 with a named persistent volume, waits for its healthcheck, enables participation rating, runs `prisma migrate deploy` in the API container and gives the worker separate resource limits.

The default starts Web, Gateway, the Core API and worker, Profiles, Auth and their databases. Use `http://127.0.0.1:<WebPort>` for local Auth and see the [operator workflow](auth-service.md#operator-workflow) for account provisioning.

| Launch flags | Services started |
| --- | --- |
| None | Full stack |
| `-WithoutAuth` | Web, Gateway, Core and Profiles |
| `-WithoutProfiles` | Web, Gateway, Core and Auth |
| `-WithoutAuth -WithoutProfiles` | Web, Gateway and Core |
| `-CoreOnly` | Core API, worker and PostgreSQL |

The existing explicit `-Profiles` and `-Auth` flags still select the named optional services. To change a running stack to a reduced configuration, run [the stop command](#stop) first, then start with the desired flags.

## URLs

- Web and public API: `http://127.0.0.1:<WebPort>` (5173 by default). Requests to `/api/v1` go through Gateway.
- Gateway liveness: `http://127.0.0.1:<WebPort>/healthz`
- Core diagnostic health: `http://127.0.0.1:<ApiPort>/api/v1/health`
- Core diagnostic Swagger: `http://127.0.0.1:<ApiPort>/api/docs`
- Profiles diagnostic readiness: `http://127.0.0.1:<ProfilesPort>/api/v1/ready` (when Profiles is running)
- PostgreSQL for explicitly configured native clients: `127.0.0.1:<PostgresPort>`

## Inspect

~~~powershell
docker ps --filter label=com.docker.compose.project=wrc-local-dev
docker logs wrc-local-dev-gateway-1 --tail 30
docker logs wrc-local-dev-api-1 --tail 30
~~~

Use job/public error codes and request IDs rather than private container paths when reporting a problem.

## Stop

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
~~~

This stops containers and preserves `_local-dev\data`, the generated local secret and the named PostgreSQL volume. It does not remove volumes, images or owner data.

When Auth is enabled, its separate PostgreSQL volume and signing key are also preserved. Loopback Auth stays unavailable when the site is accessed by a LAN-IP HTTP URL.

## Optional home-LAN access

The normal command binds to loopback. To expose the same stack's Gateway port to devices on the current private subnet, run PowerShell as administrator:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up-lan.ps1
~~~

The script keeps Gateway bound to `127.0.0.1`, adds Windows `portproxy` for the private IPv4 address and limits the firewall rule to `LocalSubnet`. Core, Profiles diagnostics and PostgreSQL remain on loopback. Use `-Profiles` to include Profiles in the startup.

To remove the LAN rule and stop the stack:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down-lan.ps1
~~~

To close LAN access without stopping Docker, add `-KeepStackRunning`. If automatic address detection is ambiguous, pass `-LanAddress 192.168.x.x` to `dev-up-lan.ps1`.

## Isolation rules

- Give simultaneous worktrees distinct `ProjectName`, API/web/PostgreSQL ports, artifact roots and database volumes/schemas.
- Do not edit the resolved mount to point at another worktree or `data`.
- For simultaneous native refactor/stable instances, use the [native isolated setup](development.md#native-development-with-an-isolated-database) with distinct PostgreSQL schemas, data paths and ports.
- Do not run owner policy rebuild, migration, cleanup or demo processing against a data root you did not explicitly select.

## Smoke checklist

After an authorized local start:

1. health returns successfully;
2. the web shell loads at 5173;
3. an already processed isolated match opens without reading a demo;
4. rating/explanation either returns the real DTO or a typed unavailable state;
5. replay availability is independent of the match report;
6. stop the profile and confirm `_local-dev\data` and the PostgreSQL volume remain.

Uploading a real demo is a separate, explicit test authorization. A synthetic preview is not an integration smoke.
