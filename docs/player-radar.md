# Player radar projection

The player report supports historical Radar v1 and the H3 Radar v2 projection.

`GET /api/v1/matches/:id/radar` projects stored M2 facts and, when present, the validated `evp-report@1`. It returns `player-radar@2` for H3 `match-result@2` and retains `player-radar@1` for historical H2. Both versions use the same eight axes and normalization. [H3 fields and award highlights](h3-frontend-handoff.md#radar-and-evp).

## Axis registry and normalization

The axis order is a contract. `radar-normalization@1` applies one fixed linear cap to every comparable player; values above the cap remain visible through the raw value and `scaleExceeded=true` while geometry stays at 1.

| Axis | Primary raw value | Unit | Fixed geometry cap | Availability |
| --- | --- | --- | ---: | --- |
| `MULTIKILL` | rounds with 2–5 enemy kills inside the player's counted H2 rounds / counted rounds × 10 | count / 10 rounds | 4 | complete kill facts reconstruct the stored M2 aggregate |
| `ASSISTS` | non-flash assists inside counted rounds / counted rounds × 10 | count / 10 rounds | 6 | assist facts reconstruct the stored M2 assist aggregate |
| `FLASH` | confirmed enemy blind seconds inside counted rounds / counted rounds | seconds / round | 4 | every included enemy blind has a finite non-negative duration; unknown target/team relations are not guessed |
| `TRADES` | confirmed trade kills inside counted rounds / counted rounds × 10 | count / 10 rounds | 3 | trade facts reconstruct the stored M2 trade count |
| `CLUTCH` | reconstructed won 1vX rounds inside counted rounds / counted rounds × 10 | count / 10 rounds | 1 | alive context reconstructs the stored M2 clutch aggregate |
| `ENTRY` | opening kills inside counted rounds / counted rounds × 10 | count / 10 rounds | 3 | opening events reconstruct the stored M2 opening counts; deaths are secondary context |
| `UTILITY` | confirmed enemy HE + inferno damage inside counted rounds / counted rounds | damage / round | 20 | damage and the target HP ledger are complete for the included player/rounds; unknown relations are not guessed |
| `OBJECTIVES` | confirmed bomb plants + defuses inside counted rounds / counted rounds × 10 | actions / 10 rounds | 4 | the stored scenario is `BOMB` and objective events reconstruct both M2 counts |

Plants and defuses are exposed separately in `secondaryMetrics`; their action count is not EVP objective points. Clutch points are also secondary and never substituted for clutch wins. Hostage and unknown scenarios do not receive a fabricated bomb-objective zero.

## Match comparisons and missing data

For every axis the match average is the arithmetic mean of available primary raw values with the same definition: the numerator and denominator use that player's exact `countedRoundIds`. Different exposure lengths remain comparable as per-round rates and set incomplete coverage. `comparisonPoolSize` is the actual number of included participants. Missing analytics, a missing or inconsistent source value, missing counted-round IDs, a zero verified-round denominator or an inapplicable scenario excludes that player from that axis only. A confirmed numeric zero remains available and participates in the average.

When a complete source channel is available, the implementation reconstructs each full-match M2 aggregate from normalized facts/events before projecting a subset. A mismatch makes the affected axis unavailable. For a globally `PARTIAL` FLASH or UTILITY channel, a player's scoped value is exposed only when that player's counted-round evidence is complete; an incomplete player is excluded without invalidating independently verifiable players. This prevents an old or incomplete artifact from turning absent event evidence into a precise zero. Events from `excludedRoundIds` never enter either a primary value or its secondary evidence.

FLASH and UTILITY additionally fail closed per player. A confirmed enemy blind with a missing, invalid or negative `blindDuration` makes only that player's affected FLASH projection unavailable. Friendly and self flashes never enter the enemy numerator. For UTILITY, missing `rawHealthDamage`, an invalid or contradictory `healthAfter`, an unknown attacker/target relation, or an already-corrupt target HP chain makes the affected player's projection unavailable. A missing `healthAfter` remains usable only when a valid damage value and a previously trustworthy HP state determine the next state exactly. A later valid `healthAfter` may re-establish the ledger for subsequent events, but it does not retroactively make the uncertain event attributable. Corruption on an unrelated player's independent target chain does not invalidate other players.

`incompleteCoverage` is true when the pool excludes a participant or the relevant global M2 channel is partial. An empty pool has an unavailable comparison and a null average. No unavailable state is converted to zero.

## Award attribution

EVP highlighting comes only from an awarded candidate in the validated stored report. The awarded primary specialization maps to its corresponding axis. A secondary highlight is emitted only when the report contains the independently confirmed secondary specialization. Source metrics, thresholds, achievement strength and evidence are copied from `evp-report@1`; high values alone never create a highlight.

MVP highlighting is narrower. It is emitted only for a positive stored H2 family contribution whose exact event belongs to that player in the role represented by the axis. Sharing a round with a multikill, an assist or another player's event is insufficient. A context anchor additionally requires a positive stored `factorContributions.CONTEXT` value for its winning tag; an unknown anchor, a negative centered factor or a post-plant combat event does not become an objective highlight. The DTO deliberately labels this as a positive H2 factor, not the decisive cause of the MVP award. Baseline, centering, cross-family transforms and unresolvable contributions remain in `h2Explanation` and are not redistributed among axes.

All six H2 families remain available in every calculated player's `h2Explanation`, including negative `CONTEXT`, `DIRECT_HARM`, baseline sources and transformations. A historical non-H2 canonical result has no inferred MVP or H2 explanation.

## API compatibility and frontend handoff

A historical match with no EVP pointer returns a radar with `evpReportSchemaVersion: null` and no EVP highlighting. A partial, stale, missing or corrupt EVP pointer remains a typed report error rather than being ignored. Partial M2 data can produce a mixed response with available and unavailable axes.

The player report uses these presentation rules.

1. draw geometry only when `geometryValue` is non-null;
2. place `rawValue` and its unit outside each point;
3. show `matchAverage`, pool size and incomplete-coverage state in the tooltip;
4. style MVP/EVP points from their attribution objects, not from magnitude;
5. show `scaleExceeded` without clipping the displayed raw number;
6. open axis evidence and `secondaryMetrics` on click, while keeping the complete `h2Explanation` reachable for non-axis and negative factors.

Stable IDs and reason codes are backend data. Localized user-facing labels belong to the frontend.

### Response fields

The endpoint is `GET /api/v1/matches/:id/radar`; it accepts no query parameters and returns `player-radar@1` with normalization identity `radar-normalization@1`.

- `axisDefinitions` is the stable registry in this exact order: `MULTIKILL`, `ASSISTS`, `FLASH`, `TRADES`, `CLUTCH`, `ENTRY`, `UTILITY`, `OBJECTIVES`.
- `players[].axes[].rawValue` is the display value in the definition's unit. It is never replaced by geometry or rounded by the backend.
- `geometryValue` is `min(1, rawValue / normalization.maximum)` and is only for drawing the polygon.
- `scaleExceeded=true` means the raw value exceeded the fixed geometry cap. The UI must still show the untruncated `rawValue`.
- `matchAverage` and `comparisonPoolSize` describe the available comparison pool for that axis. `comparisonIncompleteCoverage` warns that at least one participant or source channel was excluded/partial.
- `secondaryMetrics` contains factual supporting counts or totals. It is empty when the axis is unavailable.
- `mvpAttribution` and `evpAttribution` are nullable evidence objects, not styling inferred from a high value. MVP and EVP attribution remain mutually exclusive through `awardState`.
- `h2Explanation` embeds the six-family H2 explanation when the player's H2 rating is available. The full match explanation remains available from `GET /api/v1/matches/:id/experimental-participation-explanation`; neither endpoint attributes a causal mistake.

### Zero, null and unavailable

- `availability="AVAILABLE"` with `rawValue=0` is a confirmed zero. It is drawn at the origin and included in the match average.
- `availability="UNAVAILABLE"` always carries a typed `reasonIfUnavailable`; `rawValue` and `geometryValue` are `null`, `scaleExceeded` is false, and evidence/secondary metrics are empty.
- `null` never means zero. An empty comparison pool has `average=null`, `comparisonPoolSize=0` and `reasonIfUnavailable="COMPARISON_POOL_EMPTY"`.
- A bad FLASH or UTILITY event excludes only the affected player's axis when other players remain independently verifiable.

### API errors

The standard `api-error@1` envelope is used:

| HTTP | Code | Meaning |
| ---: | --- | --- |
| 404 | `MATCH_NOT_FOUND` | no readable match exists for the opaque ID |
| 409 | `REPORT_NOT_READY` | the canonical result or required EVP state is not ready |
| 409 | `REPORT_CORRUPT` | stored bytes, bindings, relations or the radar projection fail integrity checks |
| 409 | `REPORT_POLICY_MISMATCH` | the stored canonical/EVP policy is incompatible |
| 422 | `INVALID_QUERY` | an unexpected query parameter was supplied |

The anonymized, schema-valid frontend fixture is [`examples/player-radar-anonymized.json`](examples/player-radar-anonymized.json). It intentionally contains one participant with confirmed zero values so a consumer can test all fields without using a real SteamID, nickname, match ID or evidence identifier.
