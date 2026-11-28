# Equipment snapshot reconstruction

The research contract is `h2-e6-economy@1-research`. The maintained offline
comparison uses [parser equipment sampling](../../../packages/parser-adapter/src/equipment-sampling.ts),
[worker binding](../../../apps/core/worker/src/rating-equipment.ts) and
[economy evidence](../../../packages/scoring/src/h3/economy-evidence.ts).

## Snapshot identity

One observation is bound to match, round, roster player, stable team, current
side, tick and phase (`FREEZE_END` or `ROUND_END`). It retains:

- current and round-start equipment value;
- inventory names, inferred primary/secondary and grenade names;
- active weapon name and entity handle;
- armor, helmet and defuse kit;
- raw `balance`, round spend and total spend;
- terminal alive observation;
- provenance, availability and uncertainty reasons.

Stable team identity always comes from the roster. T/CT comes from the round
snapshot and can change at halftime.

## Selection and duplicates

The reconstructor groups by round/player/phase. Repeated copies with the same
evidence ID are deduplicated. Multiple value-identical rows remain one factual
snapshot with duplicate provenance. Conflicting rows are not ordered into an
invented truth: their equipment/inventory/money fields become unavailable with
`CONFLICTING_SNAPSHOTS` and `NO_ARBITRARY_SNAPSHOT_SELECTION`.

This is stricter than two current consumers:

- M2 sums every finite `ECONOMY_SNAPSHOT` while counting unique observed
  rounds. A repeated normalized snapshot could therefore inflate
  `freezeEquipmentValueTotal` without inflating its denominator.
- H2 builds a map from `round|player`; a later duplicate overwrites an earlier
  one. The selected value can therefore depend on event order.

Normal production parsing presently emits one row per player at each selected
freeze tick, so the 10-match real sample did not reproduce conflicting
freeze rows. The edge remains characterized by synthetic tests and is not
silently repaired in E6.

## Field-level availability

Equipment value may be usable while inventory is absent. That snapshot is
`PARTIAL`, not `UNAVAILABLE`, and can support a value comparison but not a
weapon-specific claim. Zero equipment is a confirmed zero. A missing value is
`null`; neither is replaced by the other.

Team comparison requires at least two counted players and a value for every
counted comparison player. This avoids treating an arbitrary subset median as
the team economy. Ratios require a positive opponent median, so zero never
creates `Infinity`.

