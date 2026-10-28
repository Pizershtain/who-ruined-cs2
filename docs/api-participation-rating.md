# Active participation rating API

> M4.5 retirement note: the earlier
> `GET /api/v1/matches/{matchId}/experimental-rating` P2/C2+S2 endpoint is no
> longer registered and is absent from OpenAPI. This document describes the
> sole remaining experimental rating endpoint. H2/H1 selection is owner-only;
> HTTP policy selection is rejected.

This backend-only, local-first endpoint exposes one active owner-selected
participation rating. It remains experimental, uncalibrated and non-causal; an
ordinary death or low score is not proof of a tactical mistake or intent.

## Route and activation

```http
GET /api/v1/matches/{matchId}/experimental-participation-rating
```

Set `ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` on API and worker.
`ACTIVE_RATING_POLICY=H2` is the default PRIMARY policy; `H1` is the permanent
FALLBACK. Policy is selected only by backend configuration and the local owner
CLI. Every HTTP query parameter named `policy`, including `H1` and `H2`, is
rejected with `422 INVALID_POLICY_SELECTOR`.

The response schema is `m4.3-participation-rating@1`. It contains one rating
per player (or `null` plus a typed reason), all six families, K/D/A and factual
M2 analytics, coverage, ordering, MVP and Who Ruined pools. It deliberately
does not contain a policy selector, policy digest, alternative rating,
prepared input or recompute seed.

## Frozen arithmetic

For five non-harm inputs `v_i` and the already-S2-transformed `H_S2`:

```text
P = sum(max(v_i, 0))
N = sum(max(-v_i, 0))
g(z) = z                                  when z <= 0.25
     = 0.25 + 0.15*log1p((z-0.25)/0.15)  otherwise
rating = 1 + 10P - g(5N) + h*H_S2
h = 2 for PRIMARY H2; h = 1 for FALLBACK H1
```

The frozen internal identities are unchanged:

| Backend selector | Policy ID | SHA-256 digest | `h` |
| --- | --- | --- | ---: |
| H2 | `P72B_D_P10_N5_K025_A015_H2` | `7ac1d2d3afcffa9d4682e2979f06f4dad8d42f270ec0e858bac93019724baf48` | 2 |
| H1 | `P72B_D_P10_N5_K025_A015_H1` | `3d299d81f8e8cd336ec6288431fa83240f6a0209bfeed3b80f89930ab88f5c75` | 1 |

`1 + sum(rating.finalAttribution) == rating.value` within `1e-12`.
`rawFamilyInputs.DIRECT_HARM` is `H_S2`; it is not transformed again.

## Response outline

This example is synthetic and abbreviated:

```json
{
  "schemaVersion": "m4.3-participation-rating@1",
  "reportVersion": "match-result@1",
  "matchId": "synthetic-match-01",
  "experimental": true,
  "calibrated": false,
  "causalBlame": false,
  "scenario": "BOMB",
  "players": [
    {
      "playerId": "player-01",
      "teamId": "team-a",
      "displayName": "Player 01",
      "steamId": null,
      "availability": { "status": "CALCULATED_RESEARCH_ONLY", "reason": null },
      "rating": {
        "value": 1.4,
        "rawFamilyInputs": {
          "COMBAT": 0.04,
          "SUPPORT": 0.01,
          "DEATH_RELATED": -0.02,
          "DIRECT_HARM": -0.01,
          "CONTEXT": 0.002,
          "OBJECTIVES": 0
        },
        "arithmetic": {
          "origin": 1,
          "reconstructed": 1.4,
          "tolerance": 1e-12,
          "exactWithinTolerance": true
        }
      }
    }
  ],
  "awards": {
    "eligiblePoolSize": 10,
    "incompletePool": false,
    "outcome": "DECIDED",
    "mvp": { "playerId": "player-05", "awardPoolSize": 10 },
    "whoRuined": {
      "playerId": "player-09",
      "awardPoolSize": 5,
      "scope": "LOSING_TEAM_ELIGIBLE"
    }
  },
  "provenance": { "originalDemoParsedAtRequest": false }
}
```

The authoritative runtime type and OpenAPI schema are exported by
`@who-ruined/contracts`.

## Availability and awards

Numeric `rating` exists only for `CALCULATED_RESEARCH_ONLY`. The preserved null
states are `PARTICIPATION_ABSENT_GT_2_ROUNDS`,
`PARTICIPATION_EVIDENCE_UNKNOWN`, `PARTIAL_COVERAGE_INSUFFICIENT`,
`WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE` and `UNKNOWN_APPLICABILITY`.
Unavailable is never converted to zero or 1.0.

MVP is the maximum among all calculated eligible players. Who Ruined is the
minimum among calculated players on the losing stable roster. A genuine draw
uses all calculated players and scope `DRAW_ALL_ELIGIBLE`; unknown outcome is
not treated as a draw. Pool sizes, incomplete-pool state and ties are explicit.

## Canonical-result errors

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 404 | `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED` | Feature flag is off. |
| 404 | `MATCH_NOT_FOUND` | Match is absent or deleting. |
| 409 | `REPORT_NOT_READY` | Canonical result is not ready. |
| 409 | `REPORT_CORRUPT` | File missing, invalid, wrong schema/checksum or wrong DB binding. |
| 409 | `REPORT_POLICY_MISMATCH` | Owner must rebuild to the configured H2/H1 policy. |
| 422 | `INVALID_POLICY_SELECTOR` | Public policy selection is forbidden. |

Legacy matches not yet migrated retain the older typed sidecar/backfill errors.
No GET parses a demo, creates files, queues a backfill or modifies SQLite.

## Owner rebuild

```powershell
$env:ACTIVE_RATING_POLICY = 'H1'
npm.cmd run rating:rebuild -- --dry-run
npm.cmd run rating:rebuild -- --apply
```

Restart API/worker with the same policy only after the apply summary is
verified. Full storage, migration and lifecycle details are in
`docs/m4.3-compact-result-and-lifecycle.md`.
