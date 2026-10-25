# M3-C8 experimental integration contract

P6 adds the explicitly selected `m3c8-c2-s2@1.0.0-experimental` mode. Its
prepared inputs are created from the original demo by the worker and persisted
in a separate immutable sidecar. The legacy P2 response remains the default;
no production scorer, database schema, M2 DTO or legacy API behavior changed.

This is an additive, feature-flagged backend surface. It does not replace
`m3-score-1`, write a score to SQLite, or claim a calibrated causal verdict.

## Endpoint and rollout

Set `ENABLE_EXPERIMENTAL_RATING=1`, restart the API, then request:

```text
GET /api/v1/matches/{matchId}/experimental-rating
```

The unchanged request above returns P2. C2+S2 must be selected explicitly:

```text
GET /api/v1/matches/{matchId}/experimental-rating?model=c2-s2
```

The default is disabled (`404 EXPERIMENTAL_RATING_DISABLED`). Old artifacts
without `m2-artifact-1` analytics return `409`. Non-5v5 rosters, including
Wingman, return `422 UNSUPPORTED_ROSTER_SIZE`; the 5v5 policy is never silently
reused. The endpoint computes from the stored M2 artifact and checked-in frozen
reference. It neither reparses the demo nor refits at request time.

For C2+S2, request-time code reads only the validated sidecar and the matching
M2 artifact. It does not parse or refit. `model=p2` is an explicit alias for
the legacy response; any other selector returns `422 UNSUPPORTED_MODE`.

Response schema is `m3c8-integration-1`; metric version is
`m3c8-integration-metrics-0.2.0`; kernel is `m3c8-kernel-0.2.0`; policy is
`m3c8-family-balanced-rnd@0.2.0`. The development reference hash is
`05278a5b8ca66bfaa2f9cb6a3aac175526dfe8f26a62595373d4dacc94d9c380`.

The C2+S2 response schema is `m3c8-c2s2-integration-1`; model version is
`m3c8-c2-s2@1.0.0-experimental`; policy digest is
`3c3ab8e042609295bf32cad7223a388f33876d89bcee5045bd006261cae0a744`;
reference is `p5-c2-p51-s2-development-67@1`. It returns all six families,
per-tag Context and per-axis Objectives factors, raw/soft Direct Harm,
per-round Direct Harm allocation, full M2 player analytics, and worst-to-best
full/losing-team ordering where all required profiles are calculated.

## Prepared-input sidecar

The relative path under `DATA_DIR` is:

```text
experimental/c2s2/{matchId}/{demoSha256}.{policyDigest}.m3c8-c2s2-prepared-sidecar-1.json.gz
```

The filename binds the artifact to the match, source bytes and frozen policy.
The JSON body repeats and validates `matchId`, full demo SHA-256, parser and
normalizer versions, model/reference identifiers and schema version. It stores:

- every valid round's P3-clean boundary, evidence and withheld reasons;
- supported `hostage_hurt`/`hostage_rescued` actions;
- enemy/ally armor axes;
- the per-profile physical-anchor ledger with one record per retained anchor;
- the complete 11-tag registry and every observed anchor/tag relation;
- ten prepared B+/C+ inputs with typed calculated/withheld/unknown status.

Writes use gzip to a random same-directory temporary path followed by rename.
The content-addressed final path is never overwritten: a valid existing file is
reused, while a corrupt or conflicting file fails closed. `data/experimental/`
is ignored by Git because the local sidecar can contain stable player IDs.

New parse jobs build the sidecar before the raw demo is no longer available
when `ENABLE_EXPERIMENTAL_RATING=1`. Existing matches can be backfilled with:

```powershell
npm.cmd run experimental:c2s2:prepare -- <matchId> [<matchId> ...]
```

The command verifies the raw file SHA-256 and reports each match independently.
`--all` is supported for a deliberately selected database. It does not mutate
the demo, normalized artifact or database. If the sidecar is absent and the
source is unavailable, HTTP returns `409 C2S2_SOURCE_DEMO_UNAVAILABLE`; if the
source exists but backfill has not run, it returns
`409 C2S2_SIDECAR_UNAVAILABLE`. Invalid/stale sidecars have separate 409 codes.

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

P2 retains its original normalized-boundary semantics and response. C2+S2
uses only the separately persisted P3-clean evidence; there is no fallback from
missing C2 inputs to normalized LIVE boundaries. WITHHELD and UNKNOWN remain
non-numeric. The model is experimental and uncalibrated.

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

The P6 source-demo → sidecar → C2+S2 run reparsed exactly the accepted 67-demo
development corpus (the nine later holdout demos were excluded). It produced
670 profiles: 604 calculated, 36 withheld and 30 unknown. Against the frozen
research reference, maximum absolute rating difference and the maximum
difference for each of Combat, Support, Death-related, Direct Harm, Context
and Objectives were all exactly zero. All 59 comparable full-match orders and
57 comparable losing-team orders/last places therefore remain identical.

The sidecars contained 1,178 clean rounds, 95 supported hostage actions,
24,286 armor rows, 51,627 physical anchors and 21,901 observed context tags.
This is exact development-corpus parity, not independent calibration.

## Earlier P2 verification

The runtime pass parsed 67/67 demos and emitted 67 reports and 670/670 numeric
player values. Sixty-four matches had a losing team; three were ties. All 670
decompositions reconstructed exactly. The observed range was -0.1194–1.1147,
median 0.9557 and mean 0.9265. The mean is deliberately not forced to 1.00,
because centering Direct Harm would reward absence of harm. The negative outlier is allowed by the unbounded
experimental formula and is a calibration risk, not evidence of causal blame.

The stricter corrected P3-clean experiment had 649 eligible profiles and 21
withheld; its range was 0.6685–1.1818. See
`m3c8p2/M3C8_P2_RESULTS.md` for deltas and unresolved gates.
