# Milestone status

## M4.5 — legacy experimental retirement and backend closure

The obsolete `GET /api/v1/matches/:id/experimental-rating` endpoint, its P2
and C2+S2 response DTOs, old feature flag, rating-only projector and preparation
CLI have been removed. The shared C2+S2 family-input kernel and worker-side
prepared-profile builder remain internal because the active frozen H2/H1
policies depend on them.

The current `experimental-participation-rating` endpoint remains opt-in,
owner-selected through `ACTIVE_RATING_POLICY`, and policy-neutral over HTTP.
The M4.5 Docker smoke completed one real upload, worker parse, compact-result
publication, H2 read, production-report read, RESCORE, API/worker restart and
post-restart H2 read. The retired URLs returned 404 and an HTTP policy selector
returned typed 422. The raw upload and temporary worker files were absent after
completion; the disposable data directory was removed after verification.

M4.5 is **PASS / LOCAL ONLY / OWNER GIT REVIEW PENDING**. The active rating is
still experimental and non-causal. M5 evaluation and public-hosting security
remain separate work.

## M4.4 — backend hardening (superseded owner gate)

Implemented finite HTTP, upload/queue and canonical-gzip limits; strict route
inputs; request correlation; local CORS/origin policy; cross-match result
binding; and Docker PID/memory/CPU/no-new-privileges constraints. The isolated
Docker checks covered real uploads, dedup, restart, deletion, corruption,
512 MiB boundary behavior, concurrency backpressure and reversible H2/H1 owner
policy changes. The full automated suite passes. Final acceptance remains
`PARTIAL / OWNER GATE` at that milestone: the old default-off C2+S2 route was
then preserved for backward compatibility. M4.5 resolves that owner gate by
retiring the route. Git-state checks remain intentionally unexecuted because
the work explicitly prohibits all Git operations.

## M0/M1 — accepted on three real demos

Office (`cs_office`, 13:8), Dust2 (`de_dust2`, 3:13) and Train
(`de_train`, 10:13) still pass the real golden suite. All have ten players, two
stable roster-derived teams, exact side changes, valid round winners and exact
score transitions. Every K/D/A row matches the external `.dem.info` sidecar.
The Train pre-freeze suicide remains an all-phase scoreboard fact and is not
leaked into live analytics.

## M2 — implementation complete, independent validation partial

Implemented without M3 scoring:

- normalized hurt, blind, grenade, bomb and freeze-economy facts with event
  context (phase, stable team, side, time, alive counts, bomb state, equipment;
  unavailable money is `null`);
- deterministic K/D/A, ADR, actual HP damage, KAST, openings, multikills,
  trades/untraded deaths/trade participation, survival, 1vX and alive-state
  advantage/disadvantage facts;
- flash, HE, inferno and smoke factual analytics, friendly utility and team
  damage, team kills and suicides;
- versioned `m2-1` contract, worker `FEATURIZING` stage, gzip artifact, match
  and per-player API endpoints, OpenAPI routes and an anonymized frontend JSON
  fixture;
- factual categories `POSITIVE_CONTRIBUTION`, `ERROR` and `NEUTRAL`. Ordinary
  deaths are neutral facts; no score or blame verdict exists.

The three real demos pass exact deterministic M2 aggregate regression checks.
An isolated Dust2 upload completed upload → SQLite → worker → parser →
normalization → validation → feature computation → JSON.gz → API. The match,
analytics and per-player endpoints returned valid versioned payloads; a second
upload returned the same match/job with `duplicate: true`.

M2 is **not declared fully acceptance-closed** because no independent external
reference for ADR/KAST/trades/clutches/utility damage was supplied. Internal
consistency and deterministic regression are passed; independent metric
reconciliation remains open. The expanded M2.5 batch positively covers real
team kills; the overtime fixture is still open.

## Acceptance gates

| Gate | Status |
| --- | --- |
| Parser capability on 3 real Source 2 demos | PASS |
| M0/M1 K/D/A and score reconciliation against `.dem.info` | PASS (3/3) |
| Stable roster teams and side swap | PASS (3/3) |
| M2 deterministic unit tests, missing/null semantics and 5-second trade boundary | PASS |
| M2 real-demo internal aggregate golden tests | PASS (3/3) |
| Worker/SQLite/JSON.gz/API integration and SHA dedup | PASS (Dust2 isolated run) |
| Independent ADR/KAST/trade/utility reference | OPEN — reference unavailable |
| Positive real team-kill fixture | PASS (2 events in the 9-demo M2.5 batch) |
| Overtime/expected-`PARTIAL` fixture | OPEN |
| Docker Compose backend upload/read/restart/delete | PASS — isolated real-demo run |
| M3-B exact v1 scorer and experimental successor | IMPLEMENTED — calibration gates remain open |

The original M2 gate completed successfully with 31 tests. The M2.5 gate below
supersedes that count with the expanded regression suite.

## Recorded future requirements

M3 must show MVP and Who Ruined simultaneously, provide internal clickable
player analysis, distinguish contribution to victory from contribution to
defeat, support “Положительный вклад / Ошибки / Все действия”, and keep Steam
profile links separate. A later milestone may investigate Steam share codes,
`steam://` and technically/legal available FACEIT links. None is implemented
here.

## M2.5 — validation infrastructure

`pnpm validate:demos "F:\CS2 Demos"` processed all 9 discovered demos in
isolated child processes. All 9 had matching `.dem.info` files and finished
`PASS`: exact 10-player K/D/A, every round score transition, M1 invariants and
M2 mathematical checks passed. Exported JSON was scanned for paths, filenames,
SteamID patterns and display-name fields; no personal-data match was found.

The expanded real batch contains 2 team kills, 4 live suicides, 10 non-live
suicides and 7 detected reconnect sequences. It contains no overtime. Synthetic
tests therefore cover overtime side switches, corrupt/truncated native-parser
failure isolation, simultaneous event ordering, exact trade-window boundaries,
team/world deaths, post-round exclusion, clutch, utility and economy math.

The batch exposed and fixed incorrect scoreboard treatment of deaths after a
terminal event. The correct deterministic distinction is based on objective
terminal ordering, duplicate round deaths and delayed C4 death behavior; the
fix reconciles all 9 matches without changing expected reference data.

M2.5 final gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`
completed successfully. The full run executed 38 tests, including 3 configured
real-demo golden tests; skipped tests: 0.

## M3-A — scoring model design

Design only; no scoring engine or ranking API is implemented. The restored
`SPEC.md` 1.0.0 v1 formula is retained verbatim as a compatibility baseline.
The proposal separates Performance, Impact and Mistakes, documents explicit
conflicts with later requirements, supplies numerical examples, and defines
calibration, fairness, abstention and false-positive gates. M3-B is blocked on
the owner decisions listed in `docs/m3-scoring-proposal.md` section 10.

M3-A gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed;
38 tests passed, including 3 configured real-demo golden tests, with 0 skipped.

## M3-B — experimental scoring engine

Implemented without frontend changes:

- exact `scoring-v1-compat@1.0.0`, including all nine findings, original
  cumulative team-kill damage policy, thresholds and SPEC §11.2 fixture;
- separately versioned successor with positive shortfall and bundled confirmed
  harm, mandatory eligible-match leader, all-player MVP, close/tie warnings,
  live-suicide policy and score-neutral friendly-fire research episodes;
- immutable hashed configurations for 75/25, 50/50, 25/75, low/high harm
  severity and flash-support sensitivity;
- gzip report persistence, `SCORING` worker stage, stored-artifact `RESCORE`,
  versioned match/player report endpoints, per-round evidence ledgers and an
  anonymized frontend fixture;
- `pnpm score:demos "F:\CS2 Demos"` isolated comparison and a Git-ignored
  anonymous research journal.

The M3-B real run parsed and scored all 9 discovered demos with 0 failures.
The baseline successor assigned one losing-team leader in every eligible
match; v1 produced a clear leader in 5/9 and abstained in 4/9. Three matches
changed leader under at least one predeclared sensitivity variant. These nine
matches were not used to fit coefficients. They independently confirm only the
existing `.dem.info` K/D/A and score transitions; derived score correctness is
mathematical/internal, not externally labelled.

Open gates: real overtime input, independent ADR/KAST/trade/utility ground
truth, human-labelled episode review and holdout calibration. Until those are
closed, every M3 result remains `experimental` and non-causal.

M3-B gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed.
The final test run executed 56 tests: 53 automated unit/contract/integration
tests plus 3 real golden-demo reconciliations; failures 0, skipped 0. The
separate M2.5 batch returned 9 PASS / 0 PARTIAL / 0 FAIL / 0 SKIPPED, and the
M3 comparison scored 9/9 with 0 file failures. A real Train worker → SQLite →
JSON.gz → rescore → HTTP API/OpenAPI check completed; frontend source was not
changed.

## M3-C8/P2 — experimental integration readiness

Implemented on isolated branch `codex/m3c8-p2-integration-readiness` without
replacing `m3-score-1`, changing frontend, or adding a database migration. The
additive feature-flagged endpoint returns K/D/A, Combat, Support, descriptive
Objectives, Direct Harm, opening/trades, grenades, round context, units and
availability statuses in a versioned shared contract.

The audit correction fitted P1 references on 649 eligible profiles instead of
all 670. All 649 comparable values changed slightly (maximum absolute delta
0.0003069), with no losing-five order change. Linked lethal POSTPLANT context
was restored without a second reward. The runtime pass parsed 67/67 demos,
built 67 reports and 670 player values; three matches were ties.

Runtime values remain `PARTIAL_COVERAGE` because P3 clean-boundary provenance
is not persisted in M2 artifacts. Open gates are an independent holdout and
reference, participation masks, reviewed persisted boundaries, calibration,
human labels, a bounded-tail policy, and a distinct non-5v5 policy. Technical
frontend integration is ready behind the flag; production promotion is not.

## M4.3 — compact result and match lifecycle

Backend-only M4.3 introduces one canonical `match-result@1` gzip JSON per new
completed match, a policy-neutral in-file recompute seed, owner-only H2/H1
selection, explicit historical migration and safe match deletion. The worker
publishes and validates the result before recording its SQLite binding, then
removes the raw demo unless debug retention was explicitly selected. Startup
reconciliation finishes a cleanup interrupted after the DB pointer.

The public participation endpoint now returns
`m4.3-participation-rating@1` with one active rating and no policy/prepared
fields. HTTP policy selectors are rejected. H2 → H1 → H2 is performed through
the local `rating:rebuild` dry-run/apply CLI from the same result, without the
demo, cache or sidecar. The frozen math and policy digests were not changed.

Real checks covered BOMB, HOSTAGE, a draw, disconnect/9-of-10, partial and
unknown states, same-SHA dedup after raw deletion, delete/re-upload, active-job
delete rejection, crash-window source reconciliation, canonical-only P2 and
RESCORE, migration preservation and typed missing-source blocking. The 88-match
parity rerun had 839 comparable calculated profiles and zero numeric, status or
award deltas. An isolated backend-only Docker run completed real upload, read,
restart, H2/H1 owner switching, dedup and delete with one result and no durable
raw/cache/sidecar/report duplicates.

Detailed commands, measurements and acceptance evidence are in
`docs/m4.3-compact-result-and-lifecycle.md` and `docs/m4.3-test-evidence.md`.
Scoring remains experimental and public hosting remains out of scope.
