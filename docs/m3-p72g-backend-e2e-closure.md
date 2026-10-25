# M3-C8/P7.2-G backend E2E closure

Date: 2026-10-25
Status: **PASS / LOCAL ONLY / OWNER GIT REVIEW PENDING**

This is a backend-only closure. No frontend code, production scoring formula,
frozen H1/H2 policy, parser/normalizer semantics, DTO predecessor, or database
schema was changed. No Git mutation or publication was performed.

## Runtime under test

The E2E used a new disposable SQLite database, private data directory, private
logs, and localhost-only API ports. It did not use or mutate the normal local
application database. Both real processes had
`ENABLE_EXPERIMENTAL_PARTICIPATION_RATING=1`; the API also enabled the legacy
experimental route for compatibility checks.

One minimal runtime defect was corrected: the API had hard-coded
`0.0.0.0`. Local execution now defaults to `127.0.0.1` through
`API_BIND_HOST`; Docker Compose explicitly supplies `0.0.0.0` inside the
container. Three focused tests cover the default, explicit container address,
and whitespace fallback.

The first HOSTAGE upload exceeded the normal 250 MiB upload ceiling and
correctly returned HTTP 413 `SIZE_LIMIT`. The isolated API was restarted with
the existing `MAX_UPLOAD_BYTES` override set to 600 MiB for that authorized
test only. The checked-in default was not raised.

## Gate C: brand-new HTTP ingest

`FRESH-INGEST-01` is an anonymized alias for a previously authorized real BOMB
demo ingested into the empty disposable database.

| Check | Result |
|---|---|
| Multipart `POST /api/v1/matches` | 202, `duplicate=false` |
| Observed job stages | PARSING → NORMALIZING → VALIDATING → FEATURIZING → SCORING → COMPLETED |
| Participation sidecar before first rating GET | PASS |
| Manual preparation/backfill used | No |
| Map / score / rounds | `de_cache`, 13:3, 16 |
| Canonical rows / calculated | 10 / 10 |
| Partial profile | P09, one player-scoped excluded round, rating retained |
| H2 MVP / Who Ruined | P02 / P09 |
| MVP / losing pools | 10 / 5 |
| Maximum attribution reconstruction error | `2.220446049250313e-16` |
| Maximum `(H2-H1)-H_S2` error | `6.678685382510707e-17` |
| H2 default = explicit H2 = repeated H2 | PASS |
| Sidecar hash and mtime unchanged by GET | PASS |
| Demo parsed at rating request | No |

The worker published one complete gzip sidecar atomically. No `.tmp` artifact
remained. Four fresh parse jobs ultimately produced four sidecars; GET requests
created no jobs.

## Gate D: real specialty cases over Nest HTTP

| Alias | Scenario | Score | Result |
|---|---|---:|---|
| HOLDOUT-05 | BOMB | 13:3 | 10 rows, 9 calculated, P03 null after 12 verified full-round absences; MVP P09, Who Ruined P02; pools 9/4; incomplete pool true |
| HOLDOUT-01 | HOSTAGE | 12:12 | 10/10 calculated; true DRAW; `losingTeamId=null`; Who Ruined `DRAW_ALL_ELIGIBLE`, pool 10; stable-team side swap and non-zero objective evidence observed |
| WITHHELD-REAL-01 | BOMB | completed | 10 rows, 9 calculated; P05 null with `WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE`; no substitute 0 or 1.0 |

For HOLDOUT-05, persisted evidence confirmed round 3 as
`PRESENT_VERIFIED / DISCONNECT_AFTER_DEATH`: death tick preceded the disconnect.
Round 16 was globally excluded for all ten profiles; an independent raw-boundary
inspection reconfirmed `NO_UNIQUE_RAW_ROUND_END`. One player's absence did not
withhold the other nine profiles.

For HOLDOUT-01, both stable rosters were observed on both sides across the
match. The HOSTAGE response had two profiles with non-zero objective-family
input; no BOMB-only award assumption appeared in the DTO.

All calculated specialty rows passed six-family reconstruction and policy
delta checks below `1e-12`. Maximum observed errors were:

- HOLDOUT-05 reconstruction `2.220446049250313e-16`, policy delta
  `1.6479873021779667e-16`;
- HOLDOUT-01 reconstruction `4.440892098500626e-16`, policy delta
  `1.5200514458246772e-16`.

## Error, OpenAPI and legacy checks

Actual HTTP responses in the isolated environment:

| Condition | HTTP / code |
|---|---|
| Feature disabled in separate localhost process | 404 `EXPERIMENTAL_PARTICIPATION_RATING_DISABLED` |
| Unknown policy H3 | 422 `UNSUPPORTED_MODE` |
| Unknown match | 404 `MATCH_NOT_FOUND` |
| Missing sidecar, retained source | 409 `PARTICIPATION_SIDECAR_BACKFILL_REQUIRED` |
| Missing sidecar and source unavailable | 409 `PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO` |
| Corrupt gzip | 409 `PARTICIPATION_SIDECAR_INVALID` |
| Fingerprint mismatch | 409 `PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH` |
| Frozen policy mismatch | 409 `PARTICIPATION_SIDECAR_POLICY_MISMATCH` |

All inspected error envelopes were free of local paths, demo names, SteamIDs,
player names, hashes, and stack traces. Test artifacts were restored after each
negative request.

The real `/api/docs-json` contained the route, H2/H1 enum, fixed ten-row
response, schema `m3c8-participation-rating-report@1.0.0-experimental`, and
200/404/409/422 responses.

Legacy real HTTP remained operational:

- P2 no-selector schema `m3c8-integration-1`, ten players;
- M2 analytics schema `m2-1`, ten players;
- production report schema `m3-score-1`, ten players;
- isolated RESCORE completed using the unchanged scorer version/config hash.

## Corpus and regression

The 88-match retrospective was rerun from the original retained demos after
the E2E work:

| Measure | Result |
|---|---:|
| Matches | 88/88 PASS |
| Profiles | 880 |
| Calculated | 839 |
| Absence excluded | 9 |
| Participation unknown | 1 |
| Model unknown | 30 |
| Insufficient exposure | 1 |
| Partial profiles / salvaged | 6 / 5 |
| Award checks | 352 |
| Maximum H1/H2 reference error | `4.440892098500626e-16` |
| Maximum attribution error | `0` |
| Maximum policy-delta error | `3.2656169435263394e-16` |

Final commands:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

- lint: 11/11 tasks PASS;
- typecheck: 18/18 tasks PASS;
- tests: 18/18 tasks, 121 tests PASS;
- API focused: 28/28 PASS;
- three optional standard-command real-demo goldens: SKIPPED, not counted as PASS;
- build: 11/11 tasks PASS;
- `git diff --check`: no whitespace errors; existing Windows line-ending warnings only.

Docker Compose propagation was inspected: the participation flag reaches both
API and worker, while the API container explicitly binds `0.0.0.0`. Docker was
not launched in this gate, so no Docker runtime PASS is claimed.

## Acceptance matrix

| Gate | Status |
|---|---|
| A — preflight, dependency closure, isolated environment | PASS |
| B — baseline lint/typecheck/test/build | PASS |
| C — fresh HTTP upload and automatic sidecar | PASS |
| D — disconnect, draw, HOSTAGE, partial/withheld, error and legacy HTTP | PASS |
| E — full regression, 88-match parity and privacy | PASS |
| F — local owner handoff, index empty, no Git mutation | PASS |
| Docker runtime | SKIPPED; static Compose propagation verified |
| Frontend/browser | OUT OF SCOPE; no frontend file changed |

## Remaining limitations

- The rating remains experimental, uncalibrated, and non-causal.
- Existing matches still require explicit controlled backfill when their
  sidecar predates P7.2-E. GET never performs it.
- A source demo larger than the configured upload ceiling requires an explicit
  operator size override; the default remains 250 MiB.
- Partial-v1 excludes the affected player's entire partial-round contribution,
  including confirmed harm, because a complete opportunity denominator is not
  proved.
- BOMB and HOSTAGE are supported but their absolute ratings are not asserted
  to be cross-mode calibrated.
- Docker runtime and frontend rendering were not tested in this backend-only gate.

Engineering is complete locally. Git review, staging, commit, push and merge
remain solely the owner's responsibility.
