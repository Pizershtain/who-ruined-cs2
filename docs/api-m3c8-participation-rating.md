# M3-C8/P7.2-F experimental participation rating API

This is an additive, local-only, read-only experimental endpoint. It does not
replace `m3-score-1`, P2, C2+S2 P6, M2 analytics, or any persisted report.
It is not a probability of causing a loss and does not establish intent.

## Route and feature flag

```http
GET /api/v1/matches/{matchId}/experimental-participation-rating
GET /api/v1/matches/{matchId}/experimental-participation-rating?policy=H2
GET /api/v1/matches/{matchId}/experimental-participation-rating?policy=H1
```

`ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1` must be set on the API. It is
default-off. The worker uses the same flag to create the prepared sidecar for
new parse jobs. A GET request never parses a demo, queues a job, writes a
sidecar, modifies SQLite, or overwrites an old report.

For an existing match with a retained original demo, create the sidecar
explicitly before calling the endpoint:

```powershell
$env:DATABASE_URL = 'file:../data/app.db'
$env:DATA_DIR = '<local-data-directory>'
npm.cmd run experimental:participation:prepare -- <matchId>
```

The response schema is
`m3c8-participation-rating-report@1.0.0-experimental`. OpenAPI is available at
`/api/docs` and `/api/docs-json`.

## Frozen policy selector

| Selector | Role | Policy ID | SHA-256 digest | Harm multiplier |
|---|---|---|---|---:|
| omitted / `H2` | PRIMARY | `P72B_D_P10_N5_K025_A015_H2` | `7ac1d2d3afcffa9d4682e2979f06f4dad8d42f270ec0e858bac93019724baf48` | 2 |
| `H1` | FALLBACK, not deprecated | `P72B_D_P10_N5_K025_A015_H1` | `3d299d81f8e8cd336ec6288431fa83240f6a0209bfeed3b80f89930ab88f5c75` | 1 |

Both selectors use one immutable prepared input. Switching H2 → H1 → H2 does
not reparse the demo and does not alter the sidecar. Arbitrary multipliers and
selectors such as `H3` are rejected with HTTP 422.

Prepared-input lineage remains
`3c3ab8e042609295bf32cad7223a388f33876d89bcee5045bd006261cae0a744`.
S2 has already been applied once by the C2+S2 kernel; H1/H2 only multiply the
resulting `H_S2` value.

## Score arithmetic and family fields

For the five non-harm family inputs `v_i` and the once-transformed Direct Harm
`H_S2`:

```text
P = sum(max(v_i, 0))
N = sum(max(-v_i, 0))
g(z) = z                                      when z <= 0.25
     = 0.25 + 0.15*log1p((z-0.25)/0.15)      otherwise
rating = 1 + 10P - g(5N) + h*H_S2
h = 2 for H2; h = 1 for H1
```

`rating.rawFamilyInputs` contains the five `v_i` plus `DIRECT_HARM=H_S2`.
`rating.aggregates` contains `P`, `N`, `10P`, `-g(5N)`, and `hH_S2`.
`rating.finalAttribution` is a deterministic display attribution:

- each positive non-harm family receives `10*max(v_i,0)`;
- the aggregate negative term `-g(5N)` is distributed proportionally across
  negative non-harm families by `N_i/N`;
- Direct Harm receives `h*H_S2`.

This attribution is not an independent physical value for an event. It exists
so that `1 + sum(finalAttribution) == rating.value` within `1e-12`. The API
reports both raw and final meanings under different field names.

## Response outline

The following is a synthetic, abbreviated example. IDs and values are not from
a real player or demo.

```json
{
  "schemaVersion": "m3c8-participation-rating-report@1.0.0-experimental",
  "matchId": "synthetic-match-01",
  "experimental": true,
  "calibrated": false,
  "causalBlame": false,
  "scorerVersion": "m3c8-p7.2-f-rating-projector@1.0.0-experimental",
  "policy": {
    "selector": "H2",
    "policyId": "P72B_D_P10_N5_K025_A015_H2",
    "policyDigest": "7ac1d2d3afcffa9d4682e2979f06f4dad8d42f270ec0e858bac93019724baf48",
    "harmMultiplier": 2
  },
  "prepared": {
    "schemaVersion": "m3c8-participation-prepared@1.0.0-experimental",
    "preparedInputDigest": "3c3ab8e042609295bf32cad7223a388f33876d89bcee5045bd006261cae0a744",
    "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sourceBindingDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "scenario": "BOMB",
  "applicability": { "status": "SUPPORTED", "reason": null },
  "match": {
    "map": "de_synthetic",
    "quality": "VALID",
    "totalRounds": 21,
    "validRounds": 21,
    "teams": [
      { "teamId": "team-a", "score": 13 },
      { "teamId": "team-b", "score": 8 }
    ]
  },
  "players": [
    {
      "playerId": "player-01",
      "teamId": "team-a",
      "displayName": "Player 01",
      "steamId": null,
      "steamProfileUrl": null,
      "availability": { "status": "CALCULATED_RESEARCH_ONLY", "reason": null },
      "coverage": {
        "verifiedRounds": 20,
        "absentFullRounds": 0,
        "partialRounds": 0,
        "unknownRounds": 0,
        "globalExcludedRounds": 1,
        "countedOpportunities": 20,
        "excludedOpportunities": 1,
        "sideExposure": { "T": 8, "CT": 12 },
        "causeCodes": ["ROUND_GLOBAL_EVIDENCE_MISSING"]
      },
      "rating": {
        "value": 1.4,
        "rank": 2,
        "losingTeamRank": null,
        "rawFamilyInputs": {
          "COMBAT": 0.04,
          "SUPPORT": 0.01,
          "DEATH_RELATED": -0.02,
          "DIRECT_HARM": -0.01,
          "CONTEXT": 0.002,
          "OBJECTIVES": 0
        },
        "aggregates": {
          "positiveMass": 0.052,
          "negativeMass": 0.02,
          "positiveTerm": 0.52,
          "negativeTerm": -0.1,
          "harmTerm": -0.02
        },
        "finalAttribution": {
          "COMBAT": 0.4,
          "SUPPORT": 0.1,
          "DEATH_RELATED": -0.1,
          "DIRECT_HARM": -0.02,
          "CONTEXT": 0.02,
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
    "losingTeamId": "team-b",
    "outcome": "DECIDED",
    "mvp": { "playerId": "player-05", "awardPoolSize": 10 },
    "whoRuined": {
      "playerId": "player-09",
      "awardPoolSize": 5,
      "scope": "LOSING_TEAM_ELIGIBLE"
    }
  },
  "provenance": {
    "sidecarReadOnly": true,
    "originalDemoParsedAtRequest": false
  }
}
```

The real response always contains exactly ten player rows for a valid canonical
5v5 match and includes complete M2 `analytics` for each player. The abbreviated
example intentionally omits repeated analytics and kernel-detail fields.

## Availability and null semantics

`rating` is non-null only for `CALCULATED_RESEARCH_ONLY`.

| Status/code | Meaning |
|---|---|
| `CALCULATED_RESEARCH_ONLY` | Numeric experimental rating is available. |
| `PARTICIPATION_ABSENT_GT_2_ROUNDS` | At least three full-round absences were directly verified for this player. |
| `PARTICIPATION_EVIDENCE_UNKNOWN` | Participation evidence cannot establish presence or absence. |
| `PARTIAL_COVERAGE_INSUFFICIENT` | Reserved typed status for insufficient coverage after partial-round exclusion. |
| `WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE` | Required side/mode opportunities are insufficient. |
| `UNKNOWN_APPLICABILITY` | Scenario or required model applicability is unknown. |
| `ROUND_GLOBAL_EVIDENCE_MISSING` | Round-level cause code; that round is excluded for every player. |

Unavailable values are `null`, never zero or rating `1.0`. `partialRounds` are
excluded only from that player's opportunities. `globalExcludedRounds` are
separate from absence and apply to everyone.

## Awards, pools and ties

- MVP is the maximum rating among all calculated eligible players.
- Who Ruined is the minimum rating among calculated eligible players on the
  losing stable roster.
- For a genuine score draw, `losingTeamId=null`, `outcome=DRAW`, and Who Ruined
  uses all calculated eligible players with scope `DRAW_ALL_ELIGIBLE`.
- Unknown outcome is not treated as a draw.
- `eligiblePoolSize` and each `awardPoolSize` are explicit.
- `incompletePool=true` when fewer than ten player ratings are calculated.
- Exact score ties are reported through `tied` and `tiedPlayerIds`; the selected
  row is resolved by the stable prepared `profileKey`. `close` currently means
  an exact tie only because no additional close-gap product threshold is frozen.

Teams use roster-based stable IDs. T/CT is never used as team identity.

## Error responses

Errors use the existing envelope:

```json
{
  "error": {
    "code": "PARTICIPATION_SIDECAR_BACKFILL_REQUIRED",
    "message": "Prepared sidecar is unavailable."
  },
  "requestId": "opaque-request-id"
}
```

| HTTP | Code | Meaning |
|---:|---|---|
| 404 | `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED` | Feature flag is not enabled. |
| 404 | `MATCH_NOT_FOUND` | Canonical match record does not exist. |
| 409 | `INCOMPLETE_MATCH` | Compatible M2 artifact is unavailable. |
| 409 | `PARTICIPATION_SIDECAR_BACKFILL_REQUIRED` | Sidecar missing but retained original demo can be backfilled. |
| 409 | `PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO` | Sidecar and original demo are unavailable. |
| 409 | `PARTICIPATION_SIDECAR_INVALID` | Corrupt gzip/JSON or invalid typed content. |
| 409 | `PARTICIPATION_SIDECAR_SCHEMA_MISMATCH` | Unsupported sidecar schema version. |
| 409 | `PARTICIPATION_SIDECAR_POLICY_MISMATCH` | Prepared-input or H1/H2 identity mismatch. |
| 409 | `PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH` | Immutable content fingerprint mismatch. |
| 409 | `PARTICIPATION_SIDECAR_STALE` | Match/source/parser/normalizer binding mismatch. |
| 409 | `PARTICIPATION_SIDECAR_ROSTER_MISMATCH` | Player/profile/stable-team binding mismatch. |
| 422 | `UNSUPPORTED_MODE` | Policy is neither H2 nor H1. |
| 422 | `UNSUPPORTED_ROSTER_SIZE` | Match is not canonical 5v5. |

No error includes the sidecar path, demo filename, stack, SteamID, or source
SHA. The runtime resolves exactly one deterministic path from the trusted match
record. A request cannot supply a filename or filesystem path.

## Legacy compatibility

`GET /api/v1/matches/{matchId}/experimental-rating` remains controlled by
`ENABLE_EXPERIMENTAL_RATING`. Omitting its `model` still returns the existing
P2 `m3c8-integration-1` response. The new participation flag and route do not
change `report`, player reports, rescore, analytics, worker M2 artifacts, or the
database schema.
