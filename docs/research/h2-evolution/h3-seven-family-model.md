# H3 seven-family model

`h3-seven-family@1-research` evaluates the frozen participation pool through
seven families. The [typed coverage matrix](../../../packages/scoring/src/h3/coverage.ts)
records the fact level, disposition, H3 treatment and source. `H2_FAMILY_COVERAGE`
records the frozen family where the property is at least partially scored.
`NEWLY_SCORED` means the property had no own H2 input. `PARTIALLY_SCORED`
identifies a narrower existing input and records what changed or why the
remainder stays diagnostic. The kind binding is checked on the native corpus.

| H3 family | Input and attribution |
| --- | --- |
| COMBAT | Frozen physical anchors, including the strongest component of a linked terminal hurt/kill. |
| SUPPORT | Frozen assists and verified blind intervals, plus a bounded budget for observable utility usage. |
| DEATH_RELATED | Full E2 neutralization of each exact eligible traded-death anchor. Other death anchors and frozen centering retain their ordinary semantics. |
| DIRECT_HARM | Frozen friendly-harm kernel, existing softening and ×2 projection. |
| CONTEXT | E7 action-level R2 and Economy B replacements in the same one-winner context selection. Whole-sequence and survival supplements are disabled here. |
| OBJECTIVES | Frozen plant, defuse, hostage rescue and hostage harm, with applicability and caps. |
| ROUND_IMPACT | A verified clutch conversion, postplant conversion or recovery sequence, selected once per player-round. |

The common projector uses `P = Σ max(v, 0)`, `N = Σ max(−v, 0)` over the
six non-harm families. The experimental result is `1 + 10P − g(5N) + 2H`,
where `g` is frozen softening and `H` is already softened DIRECT_HARM. Utility
and ROUND_IMPACT enter raw family inputs before projection. The result includes
a version and policy digest, raw family inputs, final attributions, action
ledger, per-round coverage and event anchors. The reconstruction tolerance is
`1e-12`. Research ranking reuses the existing selector and excludes exactly
the profiles withheld by frozen H2. The production report retains its six
families and existing entry point.

## Utility with verified effect

U2 retains `0.010` per distinct qualifying use, a diminishing series
`[1, 0.60, 0.35, 0.20]`, and a `0.022` player-round cap. Observed usage keeps
the base weight. A flash with a confirmed positive enemy interval and a matching
entity can use `1.25 ×` that weight. Without entity linkage, a positive confirmed
effect in a player/round/utility-type bundle raises at most one usage slot to
that weight. The slot is an ordering convention for the bundle, independent
of which physical grenade caused the effect. Damage, blindness, assists and
friendly harm retain their existing physical attribution. The amount of
damage or duration earns no second award. Missing effect data is identified
separately from a verified use with no observed enemy effect. This preserves
credit for known usage, including smokes whose effectiveness is unavailable.

Round utility credits contribute `0.1 × Σ credit / countedRounds` to SUPPORT.
The common projection determines the resulting rating effect, which can
differ from the usage budget when SUPPORT is below its centered baseline.

## ROUND_IMPACT rules

**Clutch conversion.** Confirm an exact 1v2 or worse from E4 and link at least
one subsequent attributed enemy elimination by the lone player. Require an
exact terminal state, the player surviving and a confirmed win by their
roster team. Use `0.08 + 0.02 × (initial opponents − 2)`. Entry evidence,
actor-owned transition event IDs and the normalized terminal winner bind the
award. Passive survival, a team win alone and an objective action already
recognized in OBJECTIVES cannot qualify by themselves.

**Postplant conversion.** Require one confirmed plant, a later confirmed
terminal defuse or explosion, a confirmed team win with the player alive,
and their own attributed enemy elimination that reduces a confirmed numerical
deficit strictly between the two objective events. CT additionally owns the
defuse. T additionally owns the plant and must have a confirmed explosion.
The award is `0.065`. The plant, enemy transition and terminal objective
are separate evidence anchors. A plant, defuse, explosion or kill on its own
cannot qualify. Frozen postplant CONTEXT and OBJECTIVES still describe their
respective individual properties.

**Deficit recovery sequence.** Require at least two uninterrupted attributable
enemy eliminations by the same player, each improving an exact negative
alive-count difference. A squad recovery must regain parity. A lone player
can qualify through verified progress short of parity, including in a lost
round. A different player's death transition breaks the chain. The award is
`min(0.08, 0.035 + 0.0125 × (eliminations − 2) + 0.010 if parity recovered)`.
An earlier best chain is retained on ties. The strongest single recovery
can qualify unless a clutch or postplant conversion already covers that
player-round. Priority is clutch, postplant, then recovery. A player receives
one sequence award even when the same transitions satisfy multiple rules.

These rules share a `0.14` player-round cap and a `0.08` cap on mean points per
frozen counted round. The raw family input is `0.1 × capped mean`. Ambiguous
same-tick transitions cannot anchor awards. A valid coverage window with no
qualifying pattern gives a verified zero. With no complete coverage, the
family is `UNAVAILABLE` with null raw and final values and is omitted from
projection. Partial coverage reports an evidenced lower bound under the
same denominator and includes observed and withheld round IDs. H3 never
promotes an unavailable frozen player to a calculated row.

## Coverage decisions

The registry distinguishes the action from its context and its outcome. One
death can support two players' physical facts, a one-winner action context
and a separately proven sequence. The sequence award applies once per
player-round and never reuses E5's sequence supplement. Captured survival,
active-weapon carryover, purchases of uncertain origin, raw balances, KAST
and match wins do not establish an additional attributable outcome. They
are recorded as informational or unavailable in the matrix. The three
ROUND_IMPACT rules and the usage weights are experimental parameters.
Observed rating movement does not establish tactical or causal accuracy.

## Post-implementation coverage audit

| Area | What the code verifies | What still stays outside scoring |
| --- | --- | --- |
| Combat and deaths | COMBAT pays the strongest verified anchor once. E2 edits both prepared variants atomically with `0.1 × abs(anchor.base)` for the matched own death. Restoring the original centered baseline can yield positive family input, with no new points assigned to the death itself. Tests cover a known trade, unknown tick rate and unchanged COMBAT. | Opening and state-of-death labels do not prove a distinct preventable action. Suicide and world deaths carry the ordinary debit. Trade chains consist of independent links and have no additional chain-length payoff. |
| Utility | E8 uses E3 usage, interval and HP evidence. H2 already pays effective enemy HP, blind intervals and assists. Team hit/kill within that target's blind interval already competes in CONTEXT. E8 now values effect-linked application within U2. Tests cover exact and bundle effects, unknown smoke, friendly effects, unchanged COMBAT and zero standalone effect credit. | Smoke visibility, causal flash assistance outside the known window, blind duration without evidence and thrown-but-unobserved grenades. |
| State and objectives | The E7 R2 branches distinguish initial lead, consolidation, recovery and parity. In H3 they keep their per-action scope. Objective conversion provides a separate confirmed outcome. Tests cover a state replacement, sequences at parity or in a lost round, lack of owner events, and T/CT objective conversion. | Standalone state, attempted objectives, and hostage outcomes without a reliable actor-to-terminal link. Existing verified hostage actions still score under OBJECTIVES. |
| Economy and survival | E6-B feeds the common context winner. Clutch and postplant awards require productive actions and confirmed survival, while solo progress can qualify in losses. Tests cover complete and incomplete pools, coexistence with R2, no duplicate COMBAT, passive survival and unknown timeline coverage. | Buy quality, exact spend per item, donor ownership, independent carryover credit and save intent. See [E6 inclusion](h3-economy-coverage.md). |
| Match summaries | H3 uses the frozen participation pool and denominators for its seven-family projection. Tests verify frozen H2 equality, exact reconstruction and withheld players. | M2 KAST/ADR, EVP specializations, and Radar axes remain distinct from scoring inputs. Paying the composites again would repeat underlying actions. |

The audit cross-checked the actual consumers [`computeMatchAnalytics`](../../../packages/features/src/index.ts),
[`prepareEvpMatchInput`](../../../packages/scoring/src/evp-input.ts),
[`buildPlayerRadar`](../../../packages/scoring/src/player-radar.ts),
[parser normalization](../../../packages/parser-adapter/src/normalization-mapping.ts),
and [H2 input preparation](../../../apps/core/worker/src/prepared-participation-input.ts).

## Properties with no separate score

The 24 `INFORMATIONAL_ONLY` and 6 `UNAVAILABLE` entries in the matrix give
the reason per property. The following groups summarize the boundary.

- Self-blind, headshot and weapon choice describe an action or personal
  equipment. They do not prove an additional team result. Opening and
  state-of-death details describe context without proving blame.
- Live counts, a clutch opportunity, teammate availability, side changes and
  technical events support qualification. Availability itself earns no points.
  Clutch loss carries no extra penalty. Passive survival carries no reward.
- Attempts, phase changes and terminal winners support sequence attribution.
  A generic objective or round-win bonus would repeat shared team facts.
  Hostage outcomes lack a reliable actor-to-terminal link beyond observed
  hostage actions.
- Current and initial gear, balance, accumulated spend, inventory, armor,
  helmet and kit describe resources. Pickup may represent different kinds
  of acquisition. Missing item identity prevents ownership or purchase
  attribution. Carryover establishes continuity without proving a decision
  or incremental benefit. Neither tactical saving nor itemized buy quality
  is observable at the required confidence.
- Movement is descriptive. Smoke effectiveness, unobserved throws, intent and
  counterfactual tactical effects lack evidence. Match-level efficiency, KAST,
  ADR, score and awards are composite or downstream views. Adding points for
  those summaries would repay their inputs.

## Reproduce the native evaluation

Use the [maintained H2/H3 comparison CLI](../../h3-comparison.md) with the frozen
E8 report as baseline. The comparison verifies every demo binding and the
digest of each full H3 result, including its evidence and family attribution.

## Final native run

The [run report](e8-real-demo-results.json) includes all 123 files. H3 evaluated
100 matches and 983 calculated profiles across 80 bomb and 20 hostage matches.
Five files failed the production 5v5 roster requirement and 18 lacked
sufficient verified rounds or eligible profiles. The preliminary run
incorrectly treated those five roster exclusions as errors inside the
preparation schema. The final runner checks roster eligibility first and
retains each exclusion with normalized event counts and roster sizes.

All 15 normalized event kinds observed in the full corpus have matrix
bindings. The 68 properties include 6 newly scored, 12 partial, 20 fully
scored, 24 informational and 6 unavailable entries.

| ROUND_IMPACT outcome | Awards |
| --- | ---: |
| Clutch conversion | 141 |
| Deficit recovery sequence | 294 |
| Postplant conversion | 10 |

The family gives positive credit to 331 players. For 634, the observed
coverage yielded zero points, and for 18 the family was unavailable. There
were 17,057 complete and 1,753 withheld
counted player-rounds. The action ledger records 1,882 exact E2 removals
and 4 links without a consistent prepared anchor. The utility ledger
records 3,828 entity-confirmed and 2,167 bundle-confirmed effect weightings.

H3 moves the mean eligible score by `+0.10987` versus frozen H2, with a
maximum shift of `+0.55300`. Five hypothetical MVP and fourteen Who Ruined
assignments changed. The complete E2 removal restores centered death input
and helps explain why the shift is materially larger than the E7 debit-only
arm. These shifts call for calibration if H3 is considered for release.
The runner directly checked unchanged H2 eligibility, reproducibility on
each prepared demo and seven-family reconstruction within `1e-12`.
