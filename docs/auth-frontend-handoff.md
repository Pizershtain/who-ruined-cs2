# Frontend handoff for Auth

Use the same browser origin for Web and the Auth API. The default Docker dev stack includes Auth at `http://127.0.0.1:5173`. Use relative paths and the [auth@1 schemas](../packages/contracts/src/auth.ts). Core and Profiles calls keep their existing public behavior.

## Session flow

1. Sign in with `POST /api/v1/auth/login`, JSON `{ "username": "dev-user", "password": "<entered password>" }`. The response is `{ accessToken, tokenType: "Bearer", expiresIn, user: { id, username, displayName } }`. Read `expiresIn` as seconds. A future provider-only account may have a null username. Display text using `displayName`.
2. Keep the access JWT in memory and send `Authorization: Bearer <accessToken>` for `GET /api/v1/auth/me`. It returns the user object directly. Account IDs are unrelated to Steam player IDs.
3. After reload, call `POST /api/v1/auth/refresh` to obtain a fresh access JWT, then call `/me` when a live account/session check is needed. Refresh uses the browser cookie and returns the same shape as login. Serialize refresh across pending callers and same-origin tabs, for example with a Web Lock where supported. A sent refresh can consume the cookie even if the response is lost, so avoid blind retries after an ambiguous network failure. A confirmed 401 takes the UI to the signed-out state.
4. Sign out with `POST /api/v1/auth/logout`. On 204, discard the in-memory JWT and current user. On a temporary failure, distinguish the local UI state from confirmation of server-side logout.

Use `credentials: "same-origin"`. A browser supplies the Origin and Fetch Metadata headers for these requests. The client does not read, store or construct the refresh cookie. Store neither passwords nor tokens in web storage, URLs or client logs. Keep guest, checking, signed-in and Auth-unavailable states distinct. Auth errors belong in the login/session UI, so the user can keep using public matches and player profiles.

Registration sends `POST /api/v1/auth/register` with `username`, `password` and an optional `steamId`. On 201, consume the same token DTO and refresh cookie as login and open `/profile`. After a lost response, the user can try signing in with the chosen credentials.

## Errors

Error responses use `{ error: { code, message }, requestId }`. Branch on the machine code and localize the visible text. Gateway may also reject oversized or malformed requests before Auth handles them.

| Status | Codes | UI handling |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Validate request format |
| 401 | `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `SESSION_EXPIRED` | Show the shared credential error or enter the signed-out state for a failed session check |
| 403 | `AUTH_ORIGIN_NOT_ALLOWED` | Verify the browser is on the configured origin |
| 404 / 408 / 413 / 414 | `NOT_FOUND`, `REQUEST_TIMEOUT`, `SIZE_LIMIT`, `REQUEST_URI_TOO_LONG` | Handle transport/request failure |
| 409 | `USERNAME_TAKEN` | Show that the login is already taken |
| 429 | `RATE_LIMITED` | Respect `Retry-After` |
| 503 | `AUTH_UNAVAILABLE` | Show a retryable Auth-only failure |

For manual verification, see the [operator workflow](auth-service.md#operator-workflow). For frontend fixtures, use an arbitrary UUID and synthetic access token in a contract-shaped mock. Include a refresh failure and an outage where public APIs remain available.
