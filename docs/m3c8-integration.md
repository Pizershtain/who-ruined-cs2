# M3-C8/P2 experimental integration contract

This is an additive, feature-flagged backend surface. It does not replace
`m3-score-1`, write a score to SQLite, or claim a calibrated causal verdict.

## Endpoint and rollout

Set `ENABLE_EXPERIMENTAL_RATING=1`, restart the API, then request:

```text
GET /api/v1/matches/{matchId}/experimental-rating
```

The default is disabled (`404 EXPERIMENTAL_RATING_DISABLED`). Old artifacts
without `m2-artifact-1` analytics return `409`. Non-5v5 rosters, including
Wingman, return `422 UNSUPPORTED_ROSTER_SIZE`; the 5v5 policy is never silently
reused. The endpoint computes from the stored M2 artifact and checked-in frozen
reference. It neither reparses the demo nor refits at request time.

Response schema is `m3c8-integration-1`; metric version is
`m3c8-integration-metrics-0.2.0`; kernel is `m3c8-kernel-0.2.0`; policy is
`m3c8-family-balanced-rnd@0.2.0`. The development reference hash is
`05278a5b8ca66bfaa2f9cb6a3aac175526dfe8f26a62595373d4dacc94d9c380`.

## Frontend handoff

Consume `ExperimentalRatingReport` from `@who-ruined/contracts`; do not
reconstruct metrics or ratings. Every metric is `{ value, status, unit, source }`.
A `null` value is never zero. Preserve `ratingStatus`, `causeCodes`,
`dataQualityFlags`, `referenceStatus`, `calibrated=false`, and
`causalBlame=false` in product logic.

Each player contains identity and separate Steam URL; K/D/A, KDA ratio, ADR and
KAST; rated Combat, Support and Direct Harm; descriptive Objectives,
opening/trade and alive-state context; flash, HE, inferno and smoke facts;
T/CT and round exposure; exact family decomposition; and per-round facts.

Objectives are not rated. A death is not tactical blame. Direct Harm is one
family, not an independent ranking. Team kills remain descriptive facts; their
linked ally HP is the single rated physical consequence, avoiding a redundant
sparse-axis charge. Direct Harm has zero baseline: no observed harm contributes
exactly zero, never a bonus.

## Availability and semantics

The M2 artifact persists normalized LIVE boundaries but not the P3
research-only clean-boundary ledger. Runtime ratings therefore return
`ratingStatus=PARTIAL_COVERAGE`, cause `NORMALIZED_BOUNDARY_ONLY`, and flag
`P3_CLEAN_BOUNDARY_NOT_PERSISTED`. P3-clean computation stays research-only
until its provenance receives a separately reviewed persistence contract.

RND is explicitly `ROSTER_SCHEDULED_CONVENTION`; participation is not
independently verified. The reference uses the same 67-match design corpus.
There is no independent holdout, scientific calibration, or human outcome set.

## Privacy-safe real-derived examples

- `tests/fixtures/m3c8-bomb-calculated.json`: 21-round BOMB match.
- `tests/fixtures/m3c8-bomb-tie.json`: 30-round BOMB tie.
- `tests/fixtures/m3c8-hostage-tie.json`: 24-round HOSTAGE tie.

They were produced by `m3c8p2/generate-api-examples.mjs` through parser →
normalizer → M2 → integration kernel. Names, SteamIDs, private identifiers,
paths and filenames are replaced. They are contract fixtures, not independent
correctness labels.

## 67-demo verification

The runtime pass parsed 67/67 demos and emitted 67 reports and 670/670 numeric
player values. Sixty-four matches had a losing team; three were ties. All 670
decompositions reconstructed exactly. The observed range was -0.1194–1.1147,
median 0.9557 and mean 0.9265. The mean is deliberately not forced to 1.00,
because centering Direct Harm would reward absence of harm. The negative outlier is allowed by the unbounded
experimental formula and is a calibration risk, not evidence of causal blame.

The stricter corrected P3-clean experiment had 649 eligible profiles and 21
withheld; its range was 0.6685–1.1818. See
`m3c8p2/M3C8_P2_RESULTS.md` for deltas and unresolved gates.
