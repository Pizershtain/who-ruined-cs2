# Auth service

Auth at `apps/services/auth` owns Who Ruined accounts, token lifecycles and manual player links. It runs as an optional NestJS process with its own Prisma Client, migrations and dedicated PostgreSQL 17 cluster. Gateway exposes the Auth routes listed below. Core and Profiles keep their public routes and their private publication protocol independently of Auth.

## Within Auth

| Data | Responsibility |
| --- | --- |
| `AuthUser` | Permanent UUID, display name, status and timestamps |
| `AuthPassword` | Unique canonical login and Argon2id password hash |
| `AuthExternalIdentity` | Reserved relation for provider-verified identities. The primary key is `(provider, providerUserId)`. |
| `AuthPlayerLink` | User-selected SteamID64 and in-game nickname, keyed by the account UUID |
| `AuthSession`, `AuthRefreshToken` | Session family with absolute/idle expiry, revocation and token-digest history for reuse detection |
| `AuthLoginLimit` | PostgreSQL counters for independent source-address and canonical-login limits |

Usernames accept 3–32 ASCII letters, digits, underscores and hyphens, starting with a letter or digit. ASCII case is folded before uniqueness checks. Display names support Unicode. Passwords are not normalized and are limited to 1,024 UTF-8 bytes. The operator CLI requires at least 12 characters and allows long passphrases. Argon2id uses a random salt per password. The default cost is 19 MiB, two iterations and parallelism one. Environment settings can raise the bounded cost. Login performs a dummy Argon2id verification for unknown accounts and uses the same credential error for invalid passwords and disabled accounts. [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

The dedicated PostgreSQL container prevents Core's existing PostgreSQL admin role from reading Auth. Auth connects as `wrc_auth`, a non-superuser limited to its database, and applies only its own migrations. The provisioner uses a separate admin secret. The runtime sees the Auth database network and the private Gateway link. Core, Profiles and Web have no connection to the database network. Profiles owns the published match statistics and aggregates.

## Tokens and request protection

- Access tokens are ES256 JWTs valid for 12 minutes by default. They contain `iss`, `aud`, `sub` (account UUID), `sid` (session UUID), `iat` and `exp`. The issuer is `<AUTH_ORIGIN>/api/v1/auth`, the audience is `who-ruined-api`, `typ` is `at+jwt` and `kid` identifies the configured P-256 public key.
- Refresh tokens use 32 cryptographically random bytes. Auth stores only their SHA-256 digests and tracks rotation with a session-row lock. A second use of a spent token revokes the family. Logout revokes the family and clears the cookie. Session tokens have a 30-day absolute lifetime and a 7-day idle lifetime by default. Password rotation and account disable revoke existing families. Repeated logout returns 204.
- The browser receives a host-only `HttpOnly; Secure; SameSite=Strict; Path=/` production cookie named `__Host-wrc_refresh`. The explicit `local-dev` mode accepts exact `http://127.0.0.1:<port>` and uses `wrc_refresh_dev`. Use the configured origin consistently. LAN HTTP can serve public routes, while Auth requires loopback HTTP or a deployed HTTPS configuration.
- Cookie writes (login, refresh and logout) require an exact `Origin` and matching Gateway-supplied host and scheme. If Fetch Metadata is supplied, `Sec-Fetch-Site` must be `same-origin`. Missing or foreign Origin is rejected. SameSite adds a separate browser control. Gateway overwrites forwarded IP, host and scheme before proxying.
- Default login limits are 20 attempts per minute per source and six per canonical login, shared across replicas through PostgreSQL. Each process allows up to two concurrent Argon2id checks. JSON login requests are limited to 4 KiB. Auth responses use `Cache-Control: no-store`. Logs contain request IDs and event or status information.

## Routes

| Method and route | Success | Credentials used |
| --- | --- | --- |
| `POST /api/v1/auth/login` | 200, tokens DTO and refresh cookie | JSON username and password |
| `POST /api/v1/auth/register` | 201, tokens DTO and refresh cookie | Same-origin JSON username and password, with an optional `steamId` |
| `POST /api/v1/auth/refresh` | 200, new tokens DTO and rotated cookie | Refresh cookie |
| `POST /api/v1/auth/logout` | 204, cleared cookie | Refresh cookie when present |
| `GET /api/v1/auth/me` | 200, account DTO | Bearer access JWT and active Auth session |
| `GET /api/v1/auth/player-link` | 200, current user's `auth-player-link@1` | Bearer access JWT and active Auth session |
| `PUT /api/v1/auth/player-link` | 200, saved link | Bearer access JWT, active Auth session and same-origin JSON with `steamId` and `nickname` |
| `DELETE /api/v1/auth/player-link` | 200, `UNLINKED` | Bearer access JWT, active Auth session and same origin |

The Auth schemas live at [packages/contracts/src/auth.ts](../packages/contracts/src/auth.ts). Private `/api/v1/auth/health` and `/api/v1/auth/ready` are available on the service network. Readiness queries the owned schema. Operator commands and diagnostic routes are private. If Auth is stopped, Gateway returns `503 AUTH_UNAVAILABLE` for its routes. Public reads and jobs continue on their existing upstreams.

Registration uses the same password rules as the operator CLI and creates an active account, its credential, an optional manual player link and the first session in one transaction. The login keeps its entered case for display and is canonicalized for authentication and uniqueness. If that login already exists, the endpoint returns `409 USERNAME_TAKEN`. After a lost response, use the login form with the same credentials. Registration has a separate maximum of five attempts per minute per source IP, capped by the configured login IP limit, and shares the existing per-process Argon2 limit. A linked account uses the login as a fallback nickname until the user changes it in About me.

The player link is an account setting saved in one `AuthPlayerLink` row per user UUID. The response is either `UNLINKED` or `LINKED` with `steamId`, `nickname`, `source: MANUAL` and `verificationStatus: UNVERIFIED`. The SteamID64 uses the Profiles identifier rules and may be selected by more than one account. The authenticated session supplies the only user ID for the operation. Removing the link only removes that account setting. Public player history reads from Profiles and manual links never write to `AuthExternalIdentity` or award ownership.

## Operator workflow

Run from the repository on Windows.

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\auth-dev-user.ps1 -Operation create -Username dev-user -DisplayName Developer
powershell -ExecutionPolicy Bypass -File .\scripts\auth-dev-user.ps1 -Operation check -Username dev-user
~~~

The startup command includes Profiles and Auth by default. The script keeps generated PostgreSQL secrets and the private signing key under the ignored `_local-dev/auth` directory. Use `-Operation rotate-password` to set your own password through a hidden prompt. The CLI also offers `revoke-sessions` and `disable`. Repeating `create` returns the existing account without changing its password. The dev CLI checks the environment and owned database before writing. The stop script preserves both database volumes and the signing key. Keep the key across routine restarts. See [local operations](local-dev.md).

For a public deployment, terminate HTTPS at the trusted Gateway and configure the exact public HTTPS origin. The supplied local Nginx listener serves HTTP. A TLS deployment needs a TLS listener with the trusted forwarded scheme and host derived from that listener, together with production secret provisioning. Keep Auth off untrusted networks and keep the signing key private.

## Future sign-in and authorization

`authenticateWithPassword` verifies a local credential, then calls the shared `issueTokens(userId)` path. A future Steam or FACEIT entry point can verify the provider response, use the unique provider identity to find or create the account under a transaction, and call the same issuance path. Adding a provider leaves the access token contract unchanged. Do not bind accounts on the basis of a SteamID submitted by the client. Account linking and conflict handling will be defined with the provider integrations. RBAC is a separate future task.

Services can verify access JWTs independently using an operator-distributed trusted public key and configured issuer/audience. Pin ES256 and check signature, key ID, token type, expiry, issued-at time and UUID claims. The existing verifier is in [tokens.ts](../apps/services/auth/src/tokens.ts). Distribute public keys through trusted configuration, and plan overlapping verification keys before introducing signing-key rotation. Treat headers or a user ID supplied separately by a client as untrusted. Local signature verification has no revocation feed, so a previously issued JWT can still verify offline until its expiry. `/me` checks live session and account state. Future sensitive operations that require immediate revocation need their own fail-closed server-side check.
