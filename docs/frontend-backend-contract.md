# M3-B frontend/backend contract

The live frontend consumes the versioned `m3-score-1` DTO through
`@who-ruined/contracts`. The anonymous fixture at
`tests/fixtures/m3-scoring-report.json` remains a contract/test fixture only;
it is never used as a fallback for a failed live request.

## Endpoints

```text
GET  /api/v1/matches/:id/report?version=<tag>&configHash=<sha256>
GET  /api/v1/matches/:id/players/:playerId/report?version=<tag>&configHash=<sha256>
POST /api/v1/matches/:id/rescore
Content-Type: application/json
{"scoringVersion":"scoring-successor@0.1.0-alpha75-beta25","configHash":"<optional sha256>"}
```

If version/hash is omitted on GET, the baseline successor is selected. Rescore
returns HTTP 202 with `matchId`, `jobId`, resolved `scoringVersion` and
`configHash`; poll the existing `/jobs/:id`. Unknown config is 422. Missing
match/player is 404. A missing scoring report, unfinished match or old artifact
without `m2-artifact-1` analytics is 409. `PARTIAL`, `UNSUPPORTED` and
`INSUFFICIENT_COVERAGE` are report states, never fake completed verdicts.

The shared player response schema is a projection of the same report: one
player row, that player's episodes, and the matching per-round ledger rows.
The client validates every response with Zod and verifies `matchId`, roster
`teamId`, unique player membership and losing-roster scope before presentation.

## Rendering semantics

- `experimental` is visible on live match and player reports.
- `mvp` and `whoRuined` are nullable. MVP is global; Who Ruined is losing-team
  only. They may both belong to the losing team but normally represent different
  players.
- The UI displays the score value, absolute `margin`, close/tie state, coverage
  and the `relativeIndex` disclaimer. It never appends `%` or calls the relative
  index a probability.
- `noConfirmedHarm=true` is explained as a relative positive shortfall, not a
  proven harmful action.
- Server values are shown as separate Performance, Context Contribution and
  Confirmed Harm fields. Null remains unavailable; the UI does not recalculate.
- Action filters use server episodes. Backend episode type, neutral facts,
  confidence and evidence strength are preserved; the frontend adds no blame
  labels.
- A nickname is an internal player-analysis link. A separate link opens the
  Steam profile from the existing identity DTO.
- `rounds` supplies the server-computed player net ledger for a selected round.
  Tick/event anchors are facts, not an interactive 2D replay.

Every finding/episode carries scorer/config provenance, player, round, tick(s),
source event IDs, observed facts, confidence/evidence strength and an
`explanationKey`. Research episodes have `significance=null` and cannot affect
the displayed score.

## Compatibility and errors

The M2 report remains visible if M3 is absent. HTTP 409 for a legacy or
not-ready scoring artifact shows a re-upload instruction; 404, 422, malformed
responses and network failures remain explicit errors. There is no synthetic
fallback in live routes. `/preview/*` is registered only by the development
build and remains clearly synthetic.

The browser uses same-origin `/api` paths through the Vite proxy. The API does
not enable general browser CORS; direct cross-origin browser clients are not a
supported local configuration. Docker passes the internal API address to the
same proxy.

See `docs/integration-e2e.md` for the verified runtime and real-demo evidence.
