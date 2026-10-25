# Frontend handoff: M3-C8/P7.2-F backend contract

This document is an API handoff only. No React, CSS, page, component, route, or
frontend state code is part of P7.2-F.

## Request

```text
GET /api/v1/matches/{matchId}/experimental-participation-rating
GET /api/v1/matches/{matchId}/experimental-participation-rating?policy=H1
```

Omitting `policy` means PRIMARY H2. H1 is a permanent frozen fallback, not a
deprecated compatibility mode. Do not synthesize arbitrary multipliers in the
client. The endpoint is default-off and may return 404 when the server feature
is disabled.

## Contract identity

| Field | Value/meaning |
|---|---|
| `schemaVersion` | `m3c8-participation-rating-report@1.0.0-experimental` |
| `scorerVersion` | `m3c8-p7.2-f-rating-projector@1.0.0-experimental` |
| `experimental` | Always `true` |
| `calibrated` | Always `false` |
| `causalBlame` | Always `false` |
| `policy.selector` | `H2` or `H1` |
| `scenario` | `BOMB`, `HOSTAGE`, or `UNKNOWN` |

Treat the DTO from `@who-ruined/contracts` as authoritative. Do not calculate
ratings, families, award pools, availability or Steam links in the frontend.

## Player fields

| Field | UI-facing meaning |
|---|---|
| `playerId`, `teamId` | Stable API identities; team is roster-based, not T/CT. |
| `displayName` | Match nickname. It may be shown according to existing privacy policy. |
| `steamId`, `steamProfileUrl` | Nullable. SteamID is a string; never parse as a JS number. |
| `availability.status` | Controls whether numeric rating can be rendered. |
| `availability.reason` | Machine-readable detail; nullable. |
| `coverage.*` | Verified/absent/partial/unknown/global counts and T/CT opportunities. |
| `rating` | Nullable. Never substitute 0 or 1 when null. |
| `rating.value` | Experimental numeric estimate. |
| `rating.rawFamilyInputs` | Five non-harm input families plus once-S2 Direct Harm. |
| `rating.finalAttribution` | Six values that reconstruct the final score with origin 1. |
| `rating.aggregates` | `P`, `N`, positive, saturated negative and policy harm terms. |
| `rating.kernelDetails` | Context/objective factors and S2 diagnostics. |
| `baseStats` | K/D/A, KDA, ADR and KAST projection from M2. Nullable where M2 is unavailable. |
| `analytics` | Full factual M2 player analytics with existing units/status semantics. |

`finalAttribution` is score attribution, not six independently saturated event
values. Its sum plus origin 1 reconstructs `rating.value`. Use labels that make
this distinction clear.

## Availability handling

| Status | Required behavior |
|---|---|
| `CALCULATED_RESEARCH_ONLY` | `rating` is present. Show experimental status. |
| `PARTICIPATION_ABSENT_GT_2_ROUNDS` | `rating=null`; state that at least three full absences were verified. Do not call this blame. |
| `PARTICIPATION_EVIDENCE_UNKNOWN` | `rating=null`; evidence cannot determine participation. |
| `PARTIAL_COVERAGE_INSUFFICIENT` | `rating=null`; partial-round exclusion left insufficient evidence. |
| `WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE` | `rating=null`; required verified opportunities are insufficient. |
| `UNKNOWN_APPLICABILITY` | `rating=null`; scenario/model applicability is unknown. |

`ROUND_GLOBAL_EVIDENCE_MISSING` appears in `coverage.causeCodes` and is not a
player absence. A non-zero `partialRounds` does not necessarily prevent a
rating: those opportunities may be excluded while remaining verified rounds
are sufficient.

## Awards

The backend returns both selected player ID and pool metadata.

- Render an award only when `playerId` is non-null.
- `incompletePool=true` means fewer than ten players were calculated; preserve
  the warning near the award.
- MVP uses all calculated players.
- Who Ruined normally uses calculated players on the losing stable roster.
- `scope=DRAW_ALL_ELIGIBLE` means the match score was genuinely tied and all
  calculated players were eligible for the minimum.
- `scope=UNAVAILABLE` is not a draw.
- `tied=true` requires communicating the exact tie and deterministic tie-break.
- `close` currently represents exact ties only; no broader closeness threshold
  is approved for this model.

The phrase “Who Ruined” remains product branding. A low rating, ordinary death,
or missing trade is not proof of a tactical error, intent, or causal blame.

## Errors

Map errors by `error.code`, not localized backend text. Important actions:

| Code | Suggested action |
|---|---|
| `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED` | Feature unavailable on this server. |
| `PARTICIPATION_SIDECAR_BACKFILL_REQUIRED` | Ask the operator to run the documented backfill command. |
| `PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO` | Original demo is required before this model can be prepared. |
| `PARTICIPATION_SIDECAR_SCHEMA_MISMATCH` | Server/artifact version mismatch; do not fall back silently. |
| `PARTICIPATION_SIDECAR_INVALID` | Artifact failed validation; do not display partial numbers. |
| `PARTICIPATION_SIDECAR_POLICY_MISMATCH` | Frozen policy identity mismatch; do not display numbers. |
| `PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH` | Immutable content check failed. |
| `PARTICIPATION_SIDECAR_STALE` | Artifact belongs to a different source/version. |
| `PARTICIPATION_SIDECAR_ROSTER_MISMATCH` | Player/team binding failed. |
| `UNSUPPORTED_MODE` | Client sent an unsupported policy selector. |
| `UNSUPPORTED_ROSTER_SIZE` | Model is not applicable to this roster. |

Do not replace one of these failures with P2 or an approximate participation
rating under the same UI label. The existing P2 endpoint remains independently
available under its own feature flag and schema.

## Units and ordering

- Kills/deaths/assists and round counts are counts.
- ADR is HP per verified played round according to M2 availability rules.
- KAST is percent.
- Blind time is seconds; grenade damage is HP.
- Ratings and family values are dimensionless experimental model quantities.
- `ordering` is calculated players from highest to lowest rating.
- `losingTeamOrdering` is highest to lowest within the losing team; for a draw
  it matches the all-player calculated order.

The backend returns all numeric values as JSON numbers and rejects non-finite
results. Formatting and localization remain frontend responsibilities.

## Local integration check

```powershell
$env:ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1'
npm.cmd run build
npm.cmd run dev
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/matches/<matchId>/experimental-participation-rating'
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/matches/<matchId>/experimental-participation-rating?policy=H1'
```

OpenAPI: `http://127.0.0.1:3000/api/docs`. Full mathematical and error details
are in `docs/api-m3c8-participation-rating.md`.
