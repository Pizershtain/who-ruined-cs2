# HTTP API and versioned contracts

**Status:** canonical route and contract index. The API is local-first and mounted under `/api/v1`. The browser uses Gateway on port 5173. Swagger is available on Core?s diagnostic port 3000 at `/api/docs`.

## Contract ownership

`@who-ruined/contracts` owns public Zod schemas. API controllers validate transport input and application use cases project persisted data into those schemas. The browser may format values, but it must not infer parser output or recalculate ratings.

Public errors use `api-error@1`:

~~~json
{
  "error": {
    "code": "REPORT_NOT_READY",
    "message": "Human-readable diagnostic",
    "details": {}
  },
  "requestId": "request-correlation-id"
}
~~~

Clients branch on `error.code`, not on the localized/backend diagnostic message. Responses also carry `x-request-id`.

## Routes

| Method | Route | Success result |
| --- | --- | --- |
| GET | `/health` | process/database health |
| POST | `/matches` | 202; streamed upload and `match-upload@1` admission or duplicate reuse |
| GET | `/jobs/:id` | job stage/status |
| GET | `/matches?cursor=...` | paginated match list |
| GET | `/matches/:id` | match summary |
| GET | `/matches/:id/rounds` | normalized rounds |
| DELETE | `/matches/:id` | 204; deletion intent/finalization |
| GET | `/matches/:id/analytics` | `m2-1` match analytics |
| GET | `/matches/:id/players/:playerId/analytics` | one player from `m2-1` |
| GET | `/matches/:id/report` | compatible `m3-score-1` report |
| GET | `/matches/:id/players/:playerId/report` | compatible player report |
| POST | `/matches/:id/rescore` | 202; compatible scoring-report RESCORE job |
| GET | `/matches/:id/experimental-participation-rating` | `m4.3-participation-rating@2` for H3, `@1` for H2 |
| GET | `/matches/:id/experimental-participation-explanation` | `m4.6-participation-explanation@2` for H3, `@1` for H2 |
| GET | `/matches/:id/radar` | `player-radar@2` for H3, `player-radar@1` for historical H2 |
| GET | `/matches/:id/evp` | `evp-report@1` |
| GET | `/matches/:id/measured-stats` | coverage-aware verified measurements |
| GET | `/matches/:id/replay` | `m4.7-replay-metadata@1`; `?version=2` opts into map images and altitude layers |
| GET | `/matches/:id/replay/rounds/:roundId` | `m4.7-replay-round@1` |

Exact input validation and HTTP response annotations live with the capability controllers in `apps/core/api/src/modules`.

Profiles has separate public routes under `/players/:steamId/profile`. See the [Gateway route policy](api-gateway-and-service-layout.md#routes) for routing, diagnostic endpoints and upstream availability errors.

Optional Auth exposes `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` and `GET /auth/me` under the same `/api/v1` origin. These use `auth@1` response and error schemas. See the [Auth API](auth-service.md#routes).

Rating and explanation routes are enabled by default and can be disabled with `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=0`. They return the policy of the stored result. The server rejects query-string policy selectors with `INVALID_POLICY_SELECTOR`. [H3 DTOs and historical compatibility](h3-frontend-handoff.md).

## DTO and artifact versions

| Version | Purpose | Persistence/exposure |
| --- | --- | --- |
| `1` | normalized match domain | embedded in analytics/canonical result |
| `m2-1` / `m2-artifact-1` | factual analytics / match+analytics artifact | read API and canonical result |
| `m3-score-1` | legacy scoring report | compatibility read API |
| `match-result@2` / `@1` | canonical persisted H3 / historical H2 result | private artifact |
| `m4.3-participation-rating@2` / `@1` | H3 / H2 rating DTO | public experimental read API |
| `m4.6-participation-explanation@2` / `@1` | H3 / H2 explanation and important moments | public experimental read API |
| `evp-report@1` | experimental EVP awards, candidates and evidence | separate immutable artifact and public read API |
| `player-radar@2` / `@1` | eight axes, match averages and award attribution | read-only projection from stored M2, H3 or H2, and optional EVP |
| `m4.7-replay-index@1` | persisted replay index | private artifact |
| `m4.7-replay-round@1` | persisted round reconstruction | public round read DTO |
| `m4.7-replay-metadata@1` | replay availability/round metadata | public replay read DTO |
| `m4.7-replay-metadata@2` | replay metadata with versioned radar images and layers | opt-in public replay read DTO; see [map compatibility](replay-maps.md#http-and-artifact-compatibility) |

Historical persisted versions and policy IDs are compatibility identities. They must not be renamed even when internal TypeScript names improve.

## Rating response boundary

The active response contains:

- player/team identity, coverage and availability;
- `rating.value` or `null` with a typed reason;
- raw six-family inputs, aggregate terms and final attributions;
- deterministic ordering and award pools;
- factual base analytics and explicit limitations.

The explanation response contains typed family reasons, confirmed evidence, aggregate/base adjustments, transforms and important moments. It may expose event/round identifiers needed by the UI, but it does not expose `internal.recomputeSeed`, policy digests or the full prepared participation sidecar.

Neither endpoint parses a demo or writes the database during GET.

## Error codes

The authoritative list is `publicApiErrorCodes` in `packages/contracts/src/api-errors.ts`. It currently covers:

- request/validation: `INVALID_REQUEST`, `INVALID_QUERY`, `INVALID_POLICY_SELECTOR`, `REQUEST_REJECTED`, `SIZE_LIMIT`;
- lookup/state: `JOB_NOT_FOUND`, `MATCH_NOT_FOUND`, `PLAYER_NOT_FOUND`, `MATCH_ACTIVE`, `REPORT_NOT_READY`;
- upload/storage: `UPLOAD_BUSY`, `QUEUE_SATURATED`, `UPLOAD_STORAGE_INVALID`, `STORAGE_UNAVAILABLE`, `STORAGE_FAILURE`, `INGESTION_PERSISTENCE_FAILED`;
- demo/support: `INVALID_DEMO`, `INCOMPLETE_MATCH`, `UNSUPPORTED_MODE`, `UNSUPPORTED_ROSTER_SIZE`, `SOURCE_DEMO_UNAVAILABLE`;
- result integrity: `REPORT_CORRUPT`, `REPORT_POLICY_MISMATCH`;
- EVP reuses `REPORT_NOT_READY`, `REPORT_CORRUPT` and `REPORT_POLICY_MISMATCH`; safe `details.resource/reason` distinguishes not-created, missing, corrupt, binding and policy states without widening frontend error handling;
- replay: `REPLAY_UNAVAILABLE`, `REPLAY_CORRUPT`, `REPLAY_ROUND_NOT_FOUND`;
- participation sidecar compatibility/fingerprint/policy/roster/staleness failures;
- feature gate: `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED`;
- last-resort `INTERNAL_ERROR`.

Unknown server exceptions are reduced to a safe `INTERNAL_ERROR`; stack traces and private paths are not returned.

## Null, partial and unavailable values

`null` means unavailable, not zero. Analytics also carries `AVAILABLE`, `PARTIAL` or `UNAVAILABLE` capability states. The rating carries a typed availability status and per-player coverage. Replay metadata can be unavailable independently of the match result.

Consumers must preserve those distinctions. A fallback to a legacy score is not permitted when the active participation rating is absent.

## Detailed references

- [M2 analytics semantics](api-m2.md)
- [Participation rating arithmetic and error behavior](api-participation-rating.md)
- [Experimental EVP persistence and API](evp.md)
- [Player radar projection and frontend handoff](player-radar.md)
- [Storage and publication](storage-lifecycle.md)
- [Frontend DTO adapters](frontend.md)
- [Scoring semantics](scoring.md)
