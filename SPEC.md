# WHO RUINED CS2 — Implementation Specification

**Version:** 1.0.0 · **Status:** implementation-ready specification · **Date:** 2026-10-15  
**Product:** local-first web app that ingests a Counter-Strike 2 `.dem` replay, reconstructs rounds, calculates explainable performance and error indicators for ten players, and shows a cautiously labeled "Who Ruined?" ranking.  
**Language:** Russian UI, English code names. **This document is normative**: implement it rather than improvising missing game logic. All numeric thresholds below are *initial product policy*, not established truths about optimal CS2 play.

## 0. Executive decisions and hard constraints

1. MVP runs locally via Docker Compose with a React/Vite/TypeScript frontend, NestJS/TypeScript HTTP API, standalone Node.js worker, Prisma + PostgreSQL 17, shared packages, and `@laihoe/demoparser2` behind an adapter. Monorepo via pnpm workspaces + Turborepo. Do not introduce Redis, microservices, ML, Steam sign-in, match-link download, paid APIs or LLM-generated verdicts into MVP.
2. Upload **only a local `.dem`**; do not claim to support direct CS2 match links, `.dem.bz2`, POV demos, incomplete demos, Source 1 demos or nonstandard modes. Reject unsupported input explicitly.
3. Analyze a standard competitive-style 5v5 CS2 match with two stable squads, playable rounds and side swaps; any side/round uncertainty leads to `PARTIAL` or `UNSUPPORTED` instead of made-up results. Premier/Competitive/FACEIT are eligible if parsing and validation pass. Overtime may be supported if valid team identity survives side changes; otherwise partial analysis with no ranking.
4. The app cannot establish intent, in-game voice communication, visibility/lines of sight, sophisticated tactical correctness, or causal responsibility solely from the basic event stream. **Never label an unsupported inference as a proven mistake**. In MVP, display verified facts with neutral phrasing; "ruiner" is explicitly a playful evidence-based index, not proof of fault.
5. Rankings must be reproducible for a given input + algorithm version + config. Fixed arithmetic rules, no randomization, locale-independent math, stable tie breaks. Use no match outcome, future events or scoreboard ranking when scoring an individual event unless the formula explicitly says otherwise.
6. The losing team's ordering is the main Who Ruined view; show the winning team separately. If the match is tied, unfinished, partially parsed, or has insufficient evidence, show statistics and **no named "winner/ruiner"**.
7. **No empirical round-win probability in v1.** The probabilities in preliminary discussions were illustrations only. A future trained, evaluated, calibrated model may be added behind a separate versioned interface. Do not hard-code pseudo probabilities.
8. Ensure clean boundaries: parser adapter → immutable normalized data → verified features → versioned scoring → explanations → API → UI. Schema validation and explicit provenance at each stage.

## 1. Goals, non-goals, definition of done

### Goals
- From a user-supplied valid complete demo, obtain reliable teams, players, map, rounds, round winners, death/kill/assist events, damage where verifiable, bomb events and utility where available.
- Show match scoreboard plus raw and derived metrics (kills/deaths/assists, ADR, KAST, openings, traded deaths, untraded openings, team damage, flash-related information only if verifiable).
- Explain every negative contribution using round number + tick + reason code + confidence/provenance. No opaque magic number.
- Deterministically generate a relative ranking over the **losing squad** with uncertainty label, score breakdown and evidence coverage.
- Persist locally; allow re-analysis of one stored normalized match under another scoring version without parsing again.
- Add fixtures, golden-demo reconciliation, invariant/property tests and hand-review evaluation methodology.

### Non-goals for MVP
- Downloading a replay from a CS2 share code, Steam integration, FACEIT API, external demo sources.
- Aim/movement/heatmaps/line-of-sight/visible enemies/crosshair placement/shot accuracy/optimal utility trajectories/voice inference.
- ML win probability or global cross-match skill rating, ELO, cheating detection, role classification.
- Definitive "bad decision" labels for isolated deaths, buying patterns, saves and 1vX outcomes.
- Public multi-tenant security posture in local release; a hardening plan is specified for deployment.

### Acceptance gates
- `docker compose up --build` results in functioning UI (`http://localhost:5173`) and API (`http://localhost:3000`). Health endpoint returns OK.
- Upload valid test demo, get job status updates, complete a results page without server crash. Unsupported input yields meaningful status and error.
- Core unit tests pass 100%; parser golden fixture tests pass using at least 3 *real, user-provided or legally redistributable* demos; no demo is invented or downloaded without permission.
- Matches marked `VALID` satisfy invariants in §5; other matches show partial findings with no ruin verdict.
- Features and ranking are deterministic in independent runs and explainable via stored evidence IDs.
- Real validation with labeled cases must be completed **before** any claim that ranking finds actual causes of defeat; till then UI marks scores `EXPERIMENTAL`.

## 2. Stack and repository

```
who-ruined-cs2/
  apps/
    web/                  # Vite React Router TS, Tailwind, TanStack Query
    api/                  # NestJS REST, upload, job queue, reports
    worker/               # Node process polls PostgreSQL-backed jobs
  packages/
    contracts/            # shared Zod schemas and DTOs
    parser-adapter/       # @laihoe/demoparser2 pinned, conversion layer
    match-domain/         # immutable entities, round builder, validation
    features/             # pure metric calculation
    scoring/              # pure deterministic scorer, configurable version
    reports/              # human-readable evidence templates
    testkit/              # builders/fixtures
  prisma/schema.prisma
  docs/
    compatibility.md
    limitations.md
    scoring.md
    eval.md
    decisions.md
  tests/golden/README.md
  data/uploads/.gitkeep
  data/cache/.gitkeep
  docker-compose.yml
  Dockerfile.api
  Dockerfile.worker
  Dockerfile.web
  pnpm-workspace.yaml
  turbo.json
  .env.example
  README.md
  AGENTS.md
```

Dependency direction: web→contracts; api→contracts/reports/database; worker→parser-adapter/match-domain/features/scoring/reports/database; scoring→contracts only; parser-adapter→external parser; **never** import parser in scoring or web. TypeScript strict mode everywhere, no `any` in domain/scoring, Zod parsing on IO.

Use Node LTS supported by the pinned parser native binary (verify on development OS + Docker linux/amd64). Pin package versions and lockfile at first implementation; document installed versions. Use Prisma PostgreSQL 17 for persistence and the filesystem for demos and large normalized JSON `.json.gz`; PostgreSQL transactions own jobs/metadata. Do not use PostgreSQL as a high-volume per-tick store.

## 3. Ingestion pipeline and background jobs

### 3.1 Upload
- `POST /api/v1/matches` multipart field `demo`, `.dem` only; MIME is not trusted. Limit 250 MiB initially via configuration. Stream to randomly generated path inside `DATA_DIR/uploads`; never honor client filename as path.
- Compute SHA-256 during stream. Deduplicate by `(fileHash, parserVersion, normalizerVersion)`; return existing match/job if matching valid artifact. Record original display filename escaped in UI.
- Require CS2 Source 2 header parser validation (`parseHeader`) and nonempty valid 5v5 round reconstruction; do not trust extension/header alone. Reject malformed, empty, oversized or truncated files with typed errors. Do not run external commands with uploaded filename.
- Local retention 14 days default for raw demo, reports retained; a cleanup job deletes raw files with no active parse and records that reparse is unavailable, configurable retention. Delete file on failed validation according to configurable policy.
- Worker must enforce max one concurrent native parse by default, timeout 120 seconds per file (configurable), and memory cap at container level; no need for real-time progress within native parsing.

### 3.2 State machine
`QUEUED → PARSING → NORMALIZING → VALIDATING → FEATURIZING → SCORING → COMPLETED`  
Any state → `FAILED` with safe error code; `VALIDATING → PARTIAL` for insufficient quality (store obtainable stats, **no ranking**); `QUEUED → CANCELLED` optional after MVP. Idempotent jobs, retries up to 2 for explicitly transient failures, no retry for malformed/unsupported file. Job claim uses an atomic conditional PostgreSQL update (`WHERE status='QUEUED'`); heartbeat and stale lease recovery run on worker restart. Single worker is default.

### 3.3 Parser adapter capability probe (mandatory implementation gate)
- Before implementing feature computation, make an executable `pnpm parser:probe path/to/demo.dem` diagnostic that calls `parseHeader`, `parsePlayerInfo`, `listGameEvents`, `parseEvents`, and selected `parseTicks` with *only fields known supported by installed parser*. Dump sanitized schema/column names and counts to `docs/compatibility.md` (no player PII in committed file).
- Candidate event families: `round_start`, `round_freeze_end` (or derived phase marker), `round_end`, `round_officially_ended`, `player_death`, `player_hurt`, `bomb_planted`, `bomb_defused`, `bomb_exploded`, `player_blind`, grenade detonation events. Event availability and exact names **must be probed**, not assumed. Parser may expose normalized props with slightly different names across versions.
- `parseTicks` only around event ticks when absolutely needed to resolve health/team/side and interpolate intervals; do not query every tick by default.
- Native parser return values must be normalized into TS arrays and Zod-validated, field aliases handled centrally; missing properties become `null`, not `0`.
- If `team_num`, `user_steamid`, `attacker_steamid`, victim/assister role or winning side cannot be obtained reliably, mark dependent features `UNAVAILABLE` with reason and coverage. No guessed 5v5 rosters.
- Record source versions in every persisted report (`parserLibraryVersion`, `normalizerVersion`, `featureVersion`, `scoringVersion`, `configHash`).

## 4. Canonical domain model

Use branded string IDs in TS for MatchId/TeamId/PlayerId/RoundId/EventId to prevent identity mixups. All times have integer `tick`, and `secondsFromRoundStart` only if tick-rate is reliable.

```ts
type Side = 'T' | 'CT';
type Quality = 'VALID' | 'PARTIAL' | 'UNSUPPORTED';
type EvidenceStrength = 'DIRECT' | 'DERIVED' | 'HEURISTIC';
type Availability = 'AVAILABLE' | 'UNAVAILABLE';
interface MatchData {
  schemaVersion: '1'; matchId: string; fileSha256: string;
  map: string | null; tickRate: number | null;
  teams: Team[]; players: Player[]; rounds: Round[];
  events: MatchEvent[]; quality: Quality; qualityIssues: QualityIssue[];
  provenance: { parser: string; parserVersion: string; normalizedAt: string };
}
interface Team { id: string; playerIds: string[]; label: string; }
interface Player { id: string; steamId: string | null; displayName: string; teamId: string; }
interface Round {
  id: string; ordinal: number; startTick: number; freezeEndTick: number | null;
  endTick: number; winnerTeamId: string | null; winnerSide: Side | null;
  sideByTeamId: Record<string, Side>; scoreBefore: Record<string, number>;
  scoreAfter: Record<string, number>; isPistol?: boolean;
  isOvertime?: boolean; isValid: boolean; issues: string[];
}
type MatchEvent = {
  id: string; kind: string; roundId: string; tick: number;
  actorId: string | null; targetId: string | null; assisterId: string | null;
  attrs: Record<string, string | number | boolean | null>;
  source: { eventName: string; rowIndex: number };
};
interface FeatureValue {
  key: string; playerId: string; roundId?: string;
  value: number | null; status: Availability; coverage: number;
  evidenceEventIds: string[]; ruleVersion: string;
}
interface Finding {
  id: string; playerId: string; roundId: string; tick: number;
  code: string; category: 'NEGATIVE'|'POSITIVE'|'FACT';
  magnitude: number; confidence: number; weight: number;
  weightedValue: number; evidenceEventIds: string[];
  strength: EvidenceStrength; explanationKey: string;
}
```

**Event ID:** `${roundOrdinal}:${eventName}:${parserRowIndex}`, stable per parsing version. **Player ID:** when available valid unique SteamID64; otherwise canonical anonymous per-match roster key, and classify identity quality as partial. **Team ID:** stable roster-based identifier, not CT/T; never treat side as team. Keep exact original display strings separate from IDs and sanitize all user-visible text. Side switches are recorded on each round; `scoreBefore/After` always keyed by stable team IDs.

## 5. Normalization and validation rules

- Generate all round intervals from trustworthy phase/round events: `startTick ≤ freezeEndTick (if any) ≤ endTick`; strict ordinal order. Intervals must not overlap. An event belongs to one round interval by tick; ambiguous boundary events are flagged, not arbitrarily double-counted. Prefer post-freeze interval for playable action, but stats may include pre-freeze events only if explicitly warranted.
- `round_start` and `round_end` alone may not reliably represent full live periods or official scoring in every demo type. Validate against score transitions and server phase properties; record fallback path. Exclude warmup, remakes and incomplete rounds. Do not naively treat halftime as an extra playable round.
- Exactly two stable teams, five unique active players on each for all scored rounds; disconnects/substitutions and bot participation => `PARTIAL` unless specifically implemented and tested. A 5v5 round has at most 10 unique human players participating; duplicates must be resolved deterministically or rejected.
- Every `player_death` has distinct victim; killer can be null (suicide/world); teamkills marked `friendlyFire`; exact 1 death per player per round (without respawn). Kills exclude teamkills and world kills; deaths include world/team deaths. Use observed roster/alive state, not team count from UI.
- Round winner must match persisted score transition (+1 exactly for winner, other unchanged) except clearly documented exceptional demo rules; otherwise mark round invalid.
- Competitive CS2 rounds include a side swap; derive winner team via the sideByTeam map for that exact round and check score before/after. Do not equate T with the team for all rounds.
- ADR = sum of **enemy actual HP lost** from verified damage events, capped by victim current HP, divided by *valid rounds player participated in*. Prevent double counting damage and apply chronology by tick; if damage events missing, return `UNAVAILABLE` instead of 0. Do not include friendly/self/fall/world damage. An event's `dmg_health` and `health_before/after` semantics must be probed and tested.
- KAST per played valid round = at least one enemy kill OR credited assist OR alive at round end OR death traded under §6; percent = 100 * count/rounds played. If assist/trade/survival source unavailable, `KAST` unavailable or partial with explicit coverage; never silently approximate official KAST.
- For every derived metric store counted denominator and feature coverage, not just a formatted percent.
- Score is available only if >= 90% of playable rounds are valid **and** both rosters/winner/kill events have >= 95% coverage, and >= 8 valid rounds. Otherwise `PARTIAL`, no ruiner rank. Team side and round outcome must be 100% valid for every *scored* round. These are engineering thresholds to revisit in evaluation.

## 6. Deterministic feature definitions v1

Everything below uses **valid scored rounds only**, in event tick order. If two events share tick, preserve parser event order and use event-type priority only for a known semantics rule; mark ambiguous simultaneity when needed.

### 6.1 First contact and trade
- `openingKill`: first **enemy-vs-enemy** player death caused by opposing player in a round, credited to killer; `openingDeath` credited to victim. A teamkill or world death before this event does not count as opening duel; it still changes alive counts.
- `trade`: after a teammate X is killed by opposing killer K, another living member of X's team kills **K** within 5.0 seconds (time derived from validated tick rate); X's death is `traded`, revenge killer gets `tradeKill`. A death can be assigned to **one** trade only, earliest eligible unmatched death of same team to that killer. A kill can trade at most one death. At exact boundary `≤5.0s` counts. If tick rate unreliable trade unavailable. No trade across round boundary. Same-tick ordering ambiguity => no trade unless event order demonstrably reliable. This is v1's defined custom rule, not a claim to reproduce official KAST or Awpy (which uses 5.25s).
- `openingUntradedDeath`: opening death not traded as defined above.
- `entryImpact` counts opening kills but is not conflated with traded openings. Deaths alone are not 'bad entry'.

### 6.2 Team damage and known harmful events
- `teamKill`: teammate killed by player (direct player_death), excluding suicides/world. Credited as verified harmful event, confidence 1.0.
- `teamDamageHP`: actual HP reduction inflicted on teammate by attacker, excluding self and damage already accounted for by equivalent duplicate rows; cap to victim's before-event HP, with same hygiene as ADR. If available, v1 treats team damage as negative independent of intent, but never infers griefing.
- `teamFlashSeconds`: only if the parser provides verifiable flash duration on a teammate and reliable thrower attribution. If not, `UNAVAILABLE` with zero contribution (and annotate coverage); do **not** infer from `player_blind` alone without thrower linkage.
- `objective`: bomb plant/defuse recorded as facts; v1 positive credit only for verified defuse and successful plant that leads to a round outcome, not broad causal credit.

### 6.3 Kill context
For each enemy kill, determine alive teammates/opponents *immediately before* the kill, from roster minus earlier deaths. Compute `killLeverage` with deterministic state-dependent factor:
- Base contribution `1` per enemy kill.
- If killer team is outnumbered immediately before kill (`alliesAlive < enemiesAlive`), multiplier `1.25`.
- Else if teams equal, multiplier `1.0`.
- Else (team ahead), multiplier `0.85`.
- No "garbage-time" judgment in MVP; the outcome cannot prove an earlier kill was useless. Never penalize a player for kills after round decided unless a verified objective event ended the round, in which case exclude post-end artifacts entirely.
- `openingKill` gets additional 0.4 positive credit, `tradeKill` gets 0.25 credit. These additive bonuses are preliminary scoring constants.

### 6.4 No pseudo tactical penalties
The following are **informational only** (`FACT`, not `NEGATIVE`): untraded death; opening death; unsuccessful 1vX; team behind on deaths; dying with unused utility; no teammate physically near; saving a weapon; losing a clutch; low ADR; low K/D; losing with >1-player advantage; unconverted bomb plant; last surviving player. A future reviewed heuristic may detect an avoidable mistake, but cannot simply map these facts to blame.

## 7. Scoring v1: explicit mathematics, coverage and ranking

### 7.1 Findings
For each valid round, create findings (weights are **index points**, not probability or units of rounds):

| Code | Type | Trigger | `magnitude` | confidence | base weight |
|---|---|---|---:|---:|---:|
| `ENEMY_KILL` | POSITIVE | enemy killed | killLeverage | 1 | 1.00 |
| `OPENING_KILL` | POSITIVE | credited opening | 1 | 1 | 0.40 |
| `TRADE_KILL` | POSITIVE | qualifying revenge | 1 | 1 | 0.25 |
| `ENEMY_DAMAGE` | POSITIVE | actual enemy HP lost | hp/100 | 1 if verified | 0.35 |
| `BOMB_DEFUSE` | POSITIVE | verified successful defuse | 1 | 1 | 0.30 |
| `BOMB_PLANT_WIN` | POSITIVE | verified plant + attacking side wins round | 1 | 1 | 0.15 |
| `TEAM_KILL` | NEGATIVE | friendly player kill | 1 | 1 | 2.50 |
| `TEAM_DAMAGE` | NEGATIVE | actual teammate HP lost | hp/100 | 1 if verified | 1.00 |
| `TEAM_FLASH` | NEGATIVE | verified flash of teammate attributable to thrower | seconds/5, capped at 1 per victim/throw | 0.9 | 0.40 |

Score each finding: `weightedValue = magnitude * confidence * weight`. `ENEMY_DAMAGE` double-counts kills somewhat deliberately, hence small coefficient; calibrate empirically later. **Never subtract a separate penalty for ordinary deaths.** For each player in match: `positive = sum(POSITIVE weightedValue)` and `negative = sum(NEGATIVE weightedValue)`; `net = positive - negative`. Unavailable findings do not become false zero stats: feature coverage and missing category badges are reported. A team kill can trigger both `TEAM_KILL` and `TEAM_DAMAGE`, but damage must reflect only independently verified actual HP lost and this combination is explicitly intentional, tested, versioned.

### 7.2 Relative per-round performance + underperformance
The users expect a relative rank even when nobody teamkills, so define an additional **descriptive underperformance** index rather than fabricating tactical mistakes.

For player p, `performanceRate(p) = net(p) / playedValidRounds(p)`.
For losing team L, `teamMeanRate = mean(performanceRate(p) for p in L)` (5 players only).
`shortfall(p) = max(0, teamMeanRate - performanceRate(p))`.
`harmRate(p) = negative(p) / playedValidRounds(p)`.
`ruinRaw(p) = 0.75 * shortfall(p) + 0.25 * harmRate(p)`.

`ruinRaw` measures **relative shortfall plus verified friendly harm**; it is not the probability of causing the defeat. For presentation use **within-team relative scale**: `displayIndex(p) = 0` if `max(ruinRaw) == min(ruinRaw)`; else `round(100 * (ruinRaw(p) - minRaw)/(maxRaw-minRaw))`. This makes the worst player 100 even if the difference is tiny, so MUST pair index with absolute `ruinRaw`, margin and confidence disclaimer. For same raw score, sort by ascending `performanceRate`, then stable player ID. If spread `maxRaw-minRaw < 0.15` or top-two gap `< 0.10`, **no single clear ruiner**; UI states 'Явного руинера нет' and lists the ranking without crown. Thresholds are provisional policies, not validated findings.

### 7.3 Evidence coverage and verdict quality
- `eligibleForRanking`: conditions §5, all 5 losing-team players have ≥ 8 valid rounds, >=95% identity, kill & round coverage.
- `coverageScore`: simple average of availability proportions for critical `(rounds, identities, deaths, enemy damage, team damage)`; unavailable optional utility does not invalidate ranking but is separately shown.
- Badge `EXPERIMENTAL` always until human evaluation passes; `LOW_EVIDENCE` if enemy damage/team damage source unavailable or other optional core categories absent.
- **Do not expose `displayIndex` as percent chance, absolute player quality, cross-match comparison, or objectively demonstrated causality.** API fields should be named `relativeIndex`, `ruinRaw`, `confidenceLevel: 'EXPERIMENTAL'|'LOW_EVIDENCE'`, not `probabilityOfRuining`.
- Attribution to specific errors: show actual negative findings first (friendly damage/teamkill), then separate "performance facts" (limited kill/damage contribution, opening outcomes) **without mislabeling them as errors**. If no verified harmful findings, explicitly say 'Подтверждённых вредных действий не найдено; порядок основан на сравнении вклада игроков'.

### 7.4 Determinism and numerical rules
- Compute using JS double, reject `NaN/Infinity`, sum values in stable order `(roundOrdinal,tick,eventId,code)`; persist numeric values with 6 decimal places for reconciliation; `displayIndex` rounds once at the end (Math.round, nonnegative).
- Config is immutable versioned JSON in `packages/scoring/config/v1.json`, all constants named and validated, SHA-256 content hash saved with reports.
- Scoring NEVER fetches from DB, reads a demo, calls external services or uses nondeterminism.

## 8. Reports and user experience

### Pages
1. `/` upload dropzone, accepted `.dem`, 250 MiB default, recent local analyses, limitation notice.
2. `/jobs/:jobId` status polling every 2 seconds while active, errors with recovery instructions. Stop polling in terminal state.
3. `/matches/:id` header map, score, both stable squads, round timeline; `Who Ruined?` losing team conditional. Statistics table: K/D/A, ADR/KAST only when fully available, opening kills/deaths, trades, friendly harm, contribution, relativeIndex. Separate summary: `положительный вклад`, `подтверждённый вред`, `относительное отставание`.
4. `/matches/:id/players/:playerId` round breakdown, findings with confidence, evidence source, event tick. Link back to timeline with tick number (no promise of direct CS2 playback seek).
5. `PARTIAL` page: recovered stats, exact unavailable features and reasons, NO ranking.

### Language policy
- Phrases `заруинил`, `виноват`, `ошибка` permitted only as UI branding or on verified harm finding (friendly fire). No automated statement that a standard death is a critical mistake.
- Examples: `Раунд 9: нанёс 46 HP урона союзнику` (DIRECT); `Раунд 13: первая смерть не была разменяна за 5 секунд` (FACT, not blame); `Самый низкий индекс вклада среди проигравшей команды` (DERIVED).
- No arbitrary natural-language AI interpretation in v1; fixed localized templates keyed by finding code and data.
- Accessibility: keyboard-operated uploader, logical focus management, status text in addition to colors, ARIA for progress/alerts, mobile-friendly layout.

## 9. REST API and error semantics

Base: `/api/v1`; JSON UTF-8 except multipart upload. NestJS validation pipes, DTO Zod schemas, OpenAPI auto-generated with manually documented examples.

| Method | Path | Response | Contract |
|---|---|---|---|
| GET | `/health` | `{status:'ok',version}` | health only |
| POST | `/matches` | `202 {matchId, jobId, duplicate}` | `multipart demo` uploaded; `413` oversized, `415` bad extension/type, `422` malformed/non-CS2; duplicate may return current job |
| GET | `/jobs/:jobId` | `{id,matchId,status,stage,createdAt,updatedAt,errorCode?,message?}` | polling; stages and finite states |
| GET | `/matches` | `{items:[{id,map,score,status,createdAt}],nextCursor?}` | cursor pagination, newest first |
| GET | `/matches/:id` | `MatchSummaryDTO` | teams, players, score, quality, availableFeatures, version |
| GET | `/matches/:id/report` | `MatchReportDTO` | ranking or null, score breakdown, evidence metadata |
| GET | `/matches/:id/rounds` | `{items:RoundSummaryDTO[]}` | chronological round narrative |
| GET | `/matches/:id/players/:id` | `PlayerReportDTO` | player totals + findings with round/tick |
| POST | `/matches/:id/rescore` | `202 {jobId}` | uses retained normalized artifact; body `{scoringVersion}` allowlisted; separate job category |
| DELETE | `/matches/:id` | `204` | local-only deletion incl artifacts; deny while processing unless safely cancelled |

Error JSON: `{error:{code,message,details?:{...}},requestId}`. Codes `INVALID_DEMO`, `UNSUPPORTED_MODE`, `INCOMPLETE_MATCH`, `MISSING_REQUIRED_EVENTS`, `SIZE_LIMIT`, `PARSE_TIMEOUT`, `PARSE_FAILED`, `VALIDATION_FAILED`, `JOB_NOT_FOUND`, `MATCH_NOT_FOUND`, `INTERNAL_ERROR`. No filesystem paths, stack traces or raw parser exceptions in client response. All identifiers are opaque and strict validated; hide sensitive player IDs in public mode.

`MatchReportDTO` core:
```ts
interface MatchReportDTO {
  matchId: string; algorithmVersion: string; configHash: string;
  quality: 'VALID'|'PARTIAL'|'UNSUPPORTED';
  availability: Array<{feature:string; status:'AVAILABLE'|'UNAVAILABLE'; coverage:number; reason?:string}>;
  verdict: null | { losingTeamId:string; clearRuinerPlayerId:string|null;
    reason: string; isExperimental:true; spread:number; topMargin:number };
  players: Array<{playerId:string; teamId:string; rounds:number; positive:number;
    negative:number; net:number; performanceRate:number; ruinRaw:number|null;
    relativeIndex:number|null; findings:Finding[] }>;
}
```

## 10. Persistence and operational design

Prisma entities (field specifics can be implemented from DTOs, but names/cardinality are fixed):
- `Match(id, originalFileName, fileSha256, map, status, quality, createdAt, updatedAt, parserVersion, normalizerVersion, normalizedFilePath, rawFilePath?, winningTeamId?, losingTeamId?)`.
- `Job(id, matchId, type:PARSE|RESCORE, status, stage, attempts, leaseUntil?, errorCode?, errorMessage?, createdAt, updatedAt)`.
- `Report(id, matchId, scoringVersion, configHash, jsonFilePath, createdAt, quality)` unique `(matchId, scoringVersion, configHash)`.
- Optional `Feedback(id, reportId, playerId?, findingId?, vote, message?, createdAt)` for later, not required by UI v1.

Publish compressed JSON artifacts immutably to avoid partially written results; validate JSON against Zod schema after decompression. Paths stored relative to `DATA_DIR` are canonicalized before access to prevent path traversal. Job transactions must not hold locks across parsing. One worker processes jobs sequentially by default. No `eval`, unsafe shell invocation or executed content from demo.

Observability: structured logs `requestId/jobId/matchId`, phases/durations, file size, counted rounds/events, availability; do not log private SteamID/name by default. Worker errors include internal stack only in server logs. Metrics on parse time, failures and memory, with operational benchmark target of 120s timeout (not a promised normal processing speed).

## 11. Testing specification

### 11.1 Unit tests (pure TS)
- Normalizer handles halftime, overtime if implemented, warmup, duplicate events, world kills, suicides, teamkill, missing actor, missing round end, two events same tick, zero/invalid tick rate, score mismatch, disconnected player.
- Opening kill skip world/team deaths; first enemy-vs-enemy death exactly once.
- Trade: revenge by teammate killing original killer ≤ 5s; exclude kills of third party, >5s, cross-round, duplicate revenge, duplicate death; earliest eligible unmatched victim; exactly boundary included.
- KAST truth table (K/A/S/T), missing inputs must not become 0.
- Damage caps to remaining enemy health and excludes team/self/world; no double count on duplicate event IDs.
- Kill leverage: 2v4 before kill =>1.25, 3v3=>1.0, 4v2=>0.85; prior deaths order respected.
- Scoring fixture: positive/negative findings, teamkill plus verified HP damage, complete missing feature coverage, no death penalty, no fake error claims; replay same input yields deep-equal JSON except timestamps; data order invariant after stable sort.
- Ranking: equal ruinRaw means index 0 for all and no clear ruiner; 5-player valid losing team; top margin and spread thresholds; winning-team ratings have `relativeIndex=null`; `PARTIAL` returns verdict null.
- API: file size, malformed filename, bad header, unsupported mode, deletion, duplicate SHA job, 404, safe errors, JSON schema compatibility.
- Property/fuzz tests: adding an enemy kill to a stable fixture without altering others cannot decrease that player's `positive`; increasing verified friendly damage cannot decrease their `negative`; swapping player display names cannot change scores; team side swap without roster change preserves identity; all indices bounded [0,100]. Beware score interactions where team mean changes; test components rather than asserting naive monotonicity of relative ordering.

### 11.2 Concrete numerical golden example
Given a **pure scoring fixture** for losing team with 10 valid rounds each and 5 player net totals `[20,16,12,8,4]`, negative totals `[0,0,0,0,0]`:
- performance rates `[2,1.6,1.2,0.8,0.4]`, mean `1.2`;
- shortfalls `[0,0,0,0.4,0.8]`;
- raw scores `[0,0,0,0.3,0.6]`;
- indices `[0,0,0,50,100]`, worst last, top raw gap `0.3` and spread `0.6` => unique worst allowed (but still `EXPERIMENTAL`).
- If all net totals 10 and negative 0: `ruinRaw=0` for all, all indices 0, `clearRuinerPlayerId=null`.
Test this exact example in code.

### 11.3 Integration and golden demos
Store fixture demo files **outside git unless redistributable license allows**; commit SHA-256 manifest + expected manually verified data counts. Require at least:
1. complete regular MR12 demo with side switch;
2. overtime match or expressly unsupported with expected `PARTIAL`;
3. demo with team damage, trades, bomb events and player flash where available;
4. corrupt/truncated file rejection fixture synthesized from a valid fixture file without including private original.

Check exact scoreboard of all 10 players and per-round winning team, score changes, opening events; compare kill/death/assist with game-provided stats where possible, and compute independently from events. Reconcile any discrepancy before trusting rank. Test parser version upgrades on all golden fixtures.

### 11.4 Human evaluation before public claims
- Collect 30 legally acquired demo files across varying ranks/modes; group by match and hold out at least 20% **matches**, never random episodes from same match across train/test.
- Two knowledgeable reviewers independently review ~150-200 sampled meaningful episodes, blind to algorithm rankings; labels: verified harm / strategically questionable / neutral / unclear plus severity, role context and a reason.
- Report agreement (Cohen's kappa for categorical labels), precision/recall for **verified harm only**; a weak kappa means soften claims rather than optimize a misleading score.
- Compare player order against baseline negative K/D, ADR, KAST using predeclared reviewer judgments where consensus exists; report uncertainty, sampling, disagreements. Do not claim causal proof or universal fairness.
- If <80% precision on independently reviewed **claimed harmful events**, do not introduce additional tactical "mistake" labels; threshold is product launch criterion, not statistical guarantee.

### 11.5 E2E
- Browser uploads valid fixture; sees stages, match summary, losing team order, explanation details; refresh persists result.
- Upload unsupported/corrupt data; error visible, no phantom ranking; UI remains responsive.
- Re-score with same version returns idempotent result; different version yields separate persisted artifact.
- Container restart mid-job leads to recovered queued job, no permanently stuck status.

## 12. Release and security checklist

### Local MVP
- Start instructions in README; environment variables: `DATA_DIR`, `DATABASE_URL`, `MAX_UPLOAD_BYTES=262144000`, `PARSE_TIMEOUT_MS=120000`, `RAW_RETENTION_DAYS=14`, `WORKER_POLL_MS=1000`, `PUBLIC_MODE=false`, `LOG_LEVEL=info`.
- No authentication on localhost only; API binds to loopback through Docker port mapping, not 0.0.0.0 on host; CSRF mitigated by same-origin dev proxy. Docker worker runs as unprivileged user, read/write only `/data`, memory/CPU resource constraints as supported.
- `.env`, raw demos, databases, logs and reports ignored from git. Provide sample artificial data for UI development, clearly marked synthetic.

### Before public release (separate milestone, must be done)
- PostgreSQL, Redis/BullMQ or equivalent durable queue, object storage / expiring disk, upload concurrency limits, max size and decompression controls, per-IP quotas, rate limiting, auth optional after threat review.
- HTTPS behind reverse proxy, strict allowed origins, request body limits, security headers, public report access controls, deletion and retention policy, privacy notice for player identifiers, sanitization and cross-site scripting review.
- Isolate native parser in restricted container with CPU/RAM/time limits and no outbound network; fuzz malformed demos. Block SSRF by keeping download-from-URL disabled until separately designed.
- Public domain/Steam trademark review, license check for parser/dependencies, relevant game/platform terms and GDPR/privacy review.

## 13. Milestones, deliverables and STOP conditions for Codex

**M0 — Capability proof**: project bootstraps, `parser:probe` works on a real demo, documented available event/field matrix; if no real `.dem` file yet, create adapter interface + mocked unit fixtures, mark M0 pending, DO NOT fake parser output or declare end-to-end success.

**M1 — Vertical slice**: upload→persist→worker→validate→normalization→match/round scoreboard UI. Must pass round identities and score invariants on a golden demo.

**M2 — Features**: typed features implemented with availability/coverage and tests; only verified direct events + defined derived features. Golden-stat reconciliation required.

**M3 — Scoring & reports**: config v1, finding attribution, relative index, no-clear-ruiner gating, deterministic templates, drill-down UI and tests. Must pass §11.2 exactly.

**M4 — Robustness**: job crash recovery, limits, deletion, duplicate uploads, errors, accessibility, Playwright E2E, documentation and deployment-ready local compose.

**M5 — Evaluation/public release**: only after labeled real demos and guardrails in §11.4, then public security migration. Do not silently mark M5 complete.

For every milestone require `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (plus E2E at M4), a list of completed acceptance checks, parser discrepancies, uncovered assumptions, and test results. If a required parser field is missing, mark the feature unavailable and provide exact supporting probe output; no substitution by guessing. Build milestones incrementally, no giant code dump without running it.

## 14. Codex operating instructions (copy as initial task)

> Read `SPEC.md` in full and treat it as normative. Implement milestone M0 first, then M1-M4 in order, obeying STOP conditions. Use a pnpm TypeScript monorepo, NestJS, Vite React, Prisma PostgreSQL 17, `@laihoe/demoparser2` adapter, Docker Compose. Do not add LLM/ML or handwave absent demo fields. Create complete runnable code and tests, never pretend parser checks passed without a real .dem fixture. Use risk-scoped checks during implementation and the documented full gate at final verification; when a real demo is needed and none is available, stop at that gate with working mock fixtures and clear next step. Maintain `docs/compatibility.md`, `docs/decisions.md`, and update README. Keep all scoring deterministic, versioned and independently testable. Never infer tactical intent from mere death. The user will test locally before any public deployment.

## 15. References and boundaries of external evidence

- [demoparser2 GitHub](https://github.com/LaihoE/demoparser) — the Node interface and Rust-backed parser; functions include `parseHeader`, `parsePlayerInfo`, `listGameEvents`, `parseEvents`, `parseTicks`. Check installed version's behavior against an actual demo.
- [demoparser2 JS docs](https://github.com/LaihoE/demoparser/blob/main/documentation/js/README.md) — API shapes and examples; supported fields must still be probed.
- [Awpy reference](https://awpy.readthedocs.io/en/latest/reference.html) — comparator for KAST/ADR/trade semantics (Awpy trade cutoff 5.25s vs **our explicitly chosen 5.0s**). Awpy is not an MVP runtime dependency.

**Open limitations deliberately left as capabilities, not missing product decisions:** exact event schema across installed parser version; reliable attribution of flash thrower; provenance of health damage; phase and team transitions in unusual demos. These must be resolved by M0 probe and golden fixtures before claiming relevant feature support. Product and scoring decisions are fully specified even when unavailable source data forces an `UNAVAILABLE` result.
