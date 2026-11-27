# Parser and M2 compatibility

**Status:** current evidence record. The parser/domain boundary is summarized in [the architecture map](backend-map.md).

## Current parser

`@laihoe/demoparser2@0.42.3` successfully reads the primary snapshot,
participation supplement and replay ticks for two `de_vertigo` demos from CS2
build 14200. The worker's in-memory pipeline validated 16 and 17 rounds and
produced H3 ratings for all ten players in each match. Version 0.42.0 read
their headers and rosters but failed to decode events and ticks with
`EntityNotFound`.

Upload deduplication includes the parser version. Once API and worker both
run 0.42.3, reuploading a failed 0.42.0 demo starts a new analysis. Stored
reports retain their original parser version. Historical upgrades and exact
comparison baselines still require their recorded parser version.

The fixture tables below record the separate 0.42.0 run. Only maps, versions,
counts, field names and anonymous aggregates are committed.

## Real fixtures

| Fixture | Map | Patch | Players | Rounds | Raw deaths | Live deaths | `player_hurt` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Office | `cs_office` | 14191 | 10 | 21 | 152 | 152 | 635 |
| Dust2 | `de_dust2` | 14191 | 10 | 16 | 111 | 111 | 491 |
| Train | `de_train` | 14190 | 10 | 23 | 181 | 180 | 729 |

All headers are Source 2 (`valve_demo_2`). `parseHeader`, `parsePlayerInfo`,
`listGameEvents`, `parseEvents` and `parseTicks` completed on every fixture.
Player info provides `name`, `steamid` and `team_number`; identity remains a
string through side changes. The Train-only extra death is a pre-freeze suicide
kept in the M1 scoreboard but excluded from live M2 features.

## Observed event fields

Counts are Office / Dust2 / Train. Zero means absent in that match, not parser
incompatibility.

| Event | Count | Fields used by M2 |
| --- | ---: | --- |
| `player_death` | 152 / 111 / 181 | actor/victim/assister SteamID, `assistedflash`, weapon, headshot, tick |
| `player_hurt` | 635 / 491 / 729 | actor/victim SteamID, remaining health/armor, raw health/armor damage, weapon, hitgroup, tick |
| `player_blind` | 53 / 123 / 158 | thrower/victim SteamID, duration, entity ID, tick |
| `flashbang_detonate` | 46 / 82 / 88 | thrower SteamID, entity ID, position, tick |
| `hegrenade_detonate` | 63 / 49 / 49 | thrower SteamID, entity ID, position, tick |
| `inferno_startburn` / `expire` | 49 / 49 / 42 | thrower SteamID, entity ID, position, tick |
| `smokegrenade_detonate` | 49 / 52 / 78 | thrower SteamID, entity ID, position, tick |
| `bomb_beginplant` | 0 / 10 / 18 | actor SteamID, site, tick |
| `bomb_begindefuse` | 0 / 2 / 7 | actor SteamID, kit flag, tick |
| `bomb_planted` | 0 / 10 / 15 | actor SteamID, site, C4, tick |
| `bomb_defused` | 0 / 2 / 2 | actor SteamID, site, C4, tick |
| `bomb_exploded` | 0 / 2 / 1 | actor SteamID, site, C4, tick |

Every selected event tick is sampled for `team_num`, `team_rounds_total`,
`is_alive`, `game_time`, `current_equip_value`, `inventory`, armor, helmet and
defuser. Ten player rows were returned at sampled real ticks. `cash` is omitted
by this parser version and therefore stays `null`.

`item_pickup` exists (1059 / 871 / 1299 rows) with player, item, defindex,
silent and tick, but has no donor/source and does not distinguish purchase from
pickup. It cannot support a truthful drop-given/drop-received metric.

## Derived feature support

| Feature | Status | Constraint |
| --- | --- | --- |
| K/D/A, survival, multikills, openings | Available | Live rounds only; scoreboard K/D/A remains all-phase for `.info` reconciliation. |
| Enemy/team damage and ADR | Available | Chronological remaining-HP cap; raw `dmg_health` overkill is not summed. |
| KAST | Available | Kill, credited assist, survival or matched traded death. |
| Trades/untraded/trade participation | Available | Deterministic one-to-one match, inclusive 5-second window, no future event. |
| 1vX clutch facts | Available | Stable roster, live death sequence and validated winner; no intent claim. |
| Advantage/disadvantage kill facts | Available | Uses event-tick alive counts when present; availability is explicit. |
| Team damage, team kills, suicides | Available | Synthetic regressions cover all paths; the expanded nine-demo batch contains two real team kills. |
| Bomb facts | Available on bomb maps | Office correctly has none; begin/complete events remain distinct. |
| Flash analytics | Available | Enemy/friendly victims and duration; flash assists come from death rows. |
| HE damage | Available | Direct hurt attribution plus actual-HP cap. |
| Molotov/incendiary damage | Partial | Reliable combined `inferno`; grenade subtype cannot be distinguished. |
| Smoke effectiveness | Unavailable | Detonation is factual; usefulness requires a spatial/tactical model. |
| Economy | Partial | Freeze inventory/equipment/armor/kit available; cash/spend/drop attribution unavailable. |

## Anonymous M2 regression aggregates

These values are exact outputs from the demos and protect determinism. They are
not an independent performance-statistics reference.

| Map | Events | Kills/deaths/assists | Enemy/team damage | Trades | Openings | Plant/defuse/explode | Flash/HE/inferno/smoke throws |
| --- | ---: | --- | --- | ---: | ---: | --- | --- |
| `cs_office` | 1306 | 152 / 152 / 40 | 16986 / 330 | 20 | 21 | 0 / 0 / 0 | 46 / 63 / 49 / 49 |
| `de_dust2` | 1192 | 111 / 111 / 43 | 12114 / 33 | 12 | 16 | 10 / 2 / 2 | 82 / 49 / 49 / 52 |
| `de_train` | 1640 | 179 / 180 / 62 | 19387 / 72 | 26 | 23 | 15 / 2 / 1 | 88 / 49 / 42 / 78 |

All three still match `.dem.info` independently for every player K/D/A and
every score transition. No external ground truth was supplied for ADR, KAST,
trades, clutches or utility damage, so those checks are explicitly internal.
The original three pinned fixtures contain neither overtime nor a positive
team-kill case. The expanded batch below adds real team-kill coverage.

## M2.5 batch expansion

The validator later expanded coverage to 9 real demos: `de_mirage` (1),
`de_train` (5), `de_dust2` (2) and `cs_office` (1), covering 16–24 rounds and
final scores from 13:6 through 11:13. All 9 adjacent `.dem.info` references
match every K/D/A row and round score transition after the terminal-death phase
fix. Two real team kills are now positively covered. Seven reconnect sequences
were detected from ordered disconnect/connect events. Overtime remains absent.

The committed report is intentionally not stored because it is a generated
runtime artifact; `data/reports/` is Git-ignored. Its schema exports only a hash
prefix, map, stable-team-order score, anonymous counts, check statuses and
explanations.
