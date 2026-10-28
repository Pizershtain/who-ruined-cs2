import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  scoringConfigSchema, scoringReportSchema,
  type MatchArtifact, type MatchEvent, type ScoringConfig, type ScoringEpisode,
  type ScoringFinding, type ScoringPlayer, type ScoringReport
} from '@who-ruined/contracts';

export * from './participation-family-kernel.js';
export * from './participation-rating.js';
export * from './active-match-result.js';

type FindingCode = ScoringFinding['code'];
type PlayerMutable = Omit<ScoringPlayer, 'episodeIds'> & { episodeIds: string[] };
type EpisodeCore = Omit<ScoringEpisode, 'scorerVersion' | 'configHash'>;
const epsilon = 1e-9;
const positiveCodes = new Set<FindingCode>(['ENEMY_KILL','OPENING_KILL','TRADE_KILL','ENEMY_DAMAGE','BOMB_DEFUSE','BOMB_PLANT_WIN','FLASH_SUPPORT']);
const contextCodes = new Set<FindingCode>(['ENEMY_KILL','OPENING_KILL','TRADE_KILL','BOMB_DEFUSE','BOMB_PLANT_WIN']);

function readConfig(name: string): ScoringConfig {
  const parsed: unknown = JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'));
  return deepFreeze(scoringConfigSchema.parse(parsed));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export const V1_CONFIG = readConfig('v1');
export const SUCCESSOR_75_25_CONFIG = readConfig('successor-75-25');
export const SUCCESSOR_50_50_CONFIG = readConfig('successor-50-50');
export const SUCCESSOR_25_75_CONFIG = readConfig('successor-25-75');
export const SUCCESSOR_SUPPORT_CONFIG = readConfig('successor-support');
export const SUCCESSOR_HARM_LOW_CONFIG = readConfig('successor-harm-low');
export const SUCCESSOR_HARM_HIGH_CONFIG = readConfig('successor-harm-high');
export const SCORING_CONFIGS = Object.freeze([V1_CONFIG, SUCCESSOR_75_25_CONFIG, SUCCESSOR_50_50_CONFIG, SUCCESSOR_25_75_CONFIG, SUCCESSOR_HARM_LOW_CONFIG, SUCCESSOR_HARM_HIGH_CONFIG, SUCCESSOR_SUPPORT_CONFIG]);

export function scoringConfigHash(config: ScoringConfig): string {
  return createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex');
}

export interface V1RankingInput {
  playerId: string;
  net: number;
  negative: number;
  validRounds: number;
}

export interface V1RankingRow extends V1RankingInput {
  performanceRate: number;
  shortfall: number;
  harmRate: number;
  ruinRaw: number;
  relativeIndex: number;
}

/** Exact SPEC.md §7/§11.2 ranking primitive, independent of parser and M2 feature extraction. */
export function rankV1Totals(input: readonly V1RankingInput[]): { rows: V1RankingRow[]; clearRuinerPlayerId: string | null } {
  if (input.some((row) => row.validRounds <= 0)) throw new Error('V1 ranking requires positive validRounds');
  const performanceRates = input.map((row) => row.net / row.validRounds);
  const mean = performanceRates.length > 0 ? performanceRates.reduce((sum, value) => sum + value, 0) / performanceRates.length : 0;
  const base = input.map((row, index) => {
    const performanceRate = performanceRates[index]!;
    const shortfall = Math.max(0, mean - performanceRate);
    const harmRate = row.negative / row.validRounds;
    return { ...row, performanceRate: round6(performanceRate), shortfall: round6(shortfall), harmRate: round6(harmRate), ruinRaw: round6(0.75 * shortfall + 0.25 * harmRate), relativeIndex: 0 };
  });
  const raws = base.map((row) => row.ruinRaw);
  const min = raws.length > 0 ? Math.min(...raws) : 0;
  const max = raws.length > 0 ? Math.max(...raws) : 0;
  const rows = base.map((row) => ({ ...row, relativeIndex: max === min ? 0 : Math.round(100 * (row.ruinRaw - min) / (max - min)) }));
  const ordered = [...rows].sort((left, right) => right.ruinRaw - left.ruinRaw || left.performanceRate - right.performanceRate || left.playerId.localeCompare(right.playerId));
  const top = ordered[0];
  const next = ordered[1];
  const spread = max - min;
  const margin = top && next ? top.ruinRaw - next.ruinRaw : 0;
  return { rows, clearRuinerPlayerId: top && spread >= V1_CONFIG.thresholds.v1Spread && margin >= V1_CONFIG.thresholds.v1TopMargin ? top.playerId : null };
}

function numberAttr(event: MatchEvent, key: string): number | null { const value = event.attrs[key]; return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function stringAttr(event: MatchEvent, key: string): string | null { const value = event.attrs[key]; return typeof value === 'string' ? value : null; }
function boolAttr(event: MatchEvent, key: string): boolean | null { const value = event.attrs[key]; return typeof value === 'boolean' ? value : null; }
function round6(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite scoring value'); return Math.round(value * 1_000_000) / 1_000_000; }
function eventOrder(a: MatchEvent, b: MatchEvent): number { return a.tick - b.tick || a.source.rowIndex - b.source.rowIndex || a.id.localeCompare(b.id); }
function isLive(event: MatchEvent): boolean { return event.context?.phase === 'LIVE' && event.kind !== 'PLAYER_DEATH_NONLIVE'; }
function contextOf(event: MatchEvent): ScoringEpisode['context'] {
  return { phase: event.context?.phase ?? null, side: event.context?.actorSide ?? null, weapon: stringAttr(event, 'weapon'), bombState: event.context?.bombState ?? null, secondsFromFreezeEnd: event.context?.secondsFromFreezeEnd ?? null, equipmentValue: event.context?.actorEquipmentValue ?? null, aliveByTeamId: event.context?.aliveByTeamId ?? null };
}

function finding(config: ScoringConfig, code: FindingCode, category: ScoringFinding['category'], playerId: string, event: MatchEvent, magnitude: number, confidence: number, weight: number, strength: ScoringFinding['evidenceStrength']): ScoringFinding {
  return { id: `${config.version}:${event.id}:${code}`, code, category, scorerVersion: config.version, configHash: scoringConfigHash(config), playerId, roundId: event.roundId, tick: event.tick, magnitude: round6(magnitude), confidence, weight, weightedValue: round6(magnitude * confidence * weight), evidenceEventIds: [event.id], evidenceStrength: strength, explanationKey: `scoring.${code.toLowerCase()}` };
}

function teamOutcome(artifact: MatchArtifact): { winningTeamId: string | null; losingTeamId: string | null } {
  const final = [...artifact.match.rounds].filter((round) => round.isValid).sort((a, b) => a.ordinal - b.ordinal).at(-1);
  if (!final || artifact.match.teams.length !== 2) return { winningTeamId: null, losingTeamId: null };
  const [a, b] = artifact.match.teams;
  if (!a || !b) return { winningTeamId: null, losingTeamId: null };
  const aScore = final.scoreAfter[a.id] ?? 0; const bScore = final.scoreAfter[b.id] ?? 0;
  if (aScore === bScore) return { winningTeamId: null, losingTeamId: null };
  return aScore > bScore ? { winningTeamId: a.id, losingTeamId: b.id } : { winningTeamId: b.id, losingTeamId: a.id };
}

function tradeSets(deaths: MatchEvent[], playerTeam: ReadonlyMap<string,string>, tickRate: number | null): { tradeKills: Set<string>; tradedDeaths: Set<string> } {
  const tradeKills = new Set<string>(); const tradedDeaths = new Set<string>();
  if (tickRate === null) return { tradeKills, tradedDeaths };
  const enemy = (event: MatchEvent): boolean => event.actorId !== null && event.targetId !== null && event.actorId !== event.targetId && playerTeam.get(event.actorId) !== playerTeam.get(event.targetId);
  for (const original of deaths.filter(enemy)) {
    const revenge = deaths.find((candidate) => candidate.roundId === original.roundId && !tradeKills.has(candidate.id) && enemy(candidate) && (candidate.tick > original.tick || candidate.tick === original.tick && candidate.source.rowIndex > original.source.rowIndex) && (candidate.tick - original.tick) / tickRate <= 5 && candidate.actorId !== null && candidate.targetId === original.actorId && original.targetId !== null && playerTeam.get(candidate.actorId) === playerTeam.get(original.targetId));
    if (revenge) { tradeKills.add(revenge.id); tradedDeaths.add(original.id); }
  }
  return { tradeKills, tradedDeaths };
}

function buildFindings(artifact: MatchArtifact, config: ScoringConfig): ScoringFinding[] {
  const { match } = artifact; const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const events = match.events.filter(isLive).sort(eventOrder); const deaths = events.filter((event) => event.kind === 'PLAYER_DEATH');
  const { tradeKills } = tradeSets(deaths, teamByPlayer, match.tickRate); const result: ScoringFinding[] = [];
  const roundById = new Map(match.rounds.map((round) => [round.id, round]));
  const deathsByRound = new Map<string, MatchEvent[]>(); for (const death of deaths) deathsByRound.set(death.roundId, [...(deathsByRound.get(death.roundId) ?? []), death]);
  for (const [roundId, rows] of deathsByRound) {
    const alive = new Map(match.teams.map((team) => [team.id, new Set(team.playerIds)])); let openingSeen = false;
    for (const event of rows.sort(eventOrder)) {
      const actorTeam = event.actorId ? teamByPlayer.get(event.actorId) : undefined; const targetTeam = event.targetId ? teamByPlayer.get(event.targetId) : undefined;
      const enemy = event.actorId !== null && event.targetId !== null && event.actorId !== event.targetId && actorTeam !== undefined && targetTeam !== undefined && actorTeam !== targetTeam;
      if (enemy && event.actorId && actorTeam) {
        const enemyTeam = match.teams.find((team) => team.id !== actorTeam)?.id;
        const ownCount = alive.get(actorTeam)?.size ?? 0; const enemyCount = enemyTeam ? alive.get(enemyTeam)?.size ?? 0 : 0;
        const leverage = ownCount < enemyCount ? 1.25 : ownCount === enemyCount ? 1 : 0.85;
        result.push(finding(config, 'ENEMY_KILL', 'POSITIVE', event.actorId, event, leverage, 1, config.weights.enemyKill, 'DIRECT'));
        if (!openingSeen) { result.push(finding(config, 'OPENING_KILL', 'POSITIVE', event.actorId, event, 1, 1, config.weights.openingKill, 'DERIVED')); openingSeen = true; }
        if (tradeKills.has(event.id)) result.push(finding(config, 'TRADE_KILL', 'POSITIVE', event.actorId, event, 1, 1, config.weights.tradeKill, 'DERIVED'));
      }
      if (boolAttr(event, 'suicide') !== true && event.actorId && event.targetId && event.actorId !== event.targetId && actorTeam !== undefined && actorTeam === targetTeam) result.push(finding(config, 'TEAM_KILL', 'NEGATIVE', event.actorId, event, 1, 1, config.weights.teamKill, 'DIRECT'));
      if (event.targetId && targetTeam) alive.get(targetTeam)?.delete(event.targetId);
    }
    void roundId;
  }
  const hp = new Map<string, number>();
  for (const event of events.filter((item) => item.kind === 'PLAYER_HURT').sort(eventOrder)) {
    if (!event.targetId) continue; const raw = numberAttr(event, 'rawHealthDamage'); if (raw === null) continue;
    const key = `${event.roundId}:${event.targetId}`; const before = hp.get(key) ?? 100; const actual = Math.max(0, Math.min(raw, before));
    const after = numberAttr(event, 'healthAfter'); hp.set(key, after === null ? before - actual : Math.max(0, after));
    if (actual === 0 || !event.actorId || event.actorId === event.targetId) continue;
    const actorTeam = teamByPlayer.get(event.actorId); const targetTeam = teamByPlayer.get(event.targetId); if (!actorTeam || !targetTeam) continue;
    const friendly = actorTeam === targetTeam;
    result.push(finding(config, friendly ? 'TEAM_DAMAGE' : 'ENEMY_DAMAGE', friendly ? 'NEGATIVE' : 'POSITIVE', event.actorId, event, actual / 100, 1, friendly ? config.weights.teamDamage : config.weights.enemyDamage, 'DIRECT'));
  }
  for (const event of events) {
    if (event.kind === 'BOMB_DEFUSED' && event.actorId) result.push(finding(config, 'BOMB_DEFUSE', 'POSITIVE', event.actorId, event, 1, 1, config.weights.bombDefuse, 'DIRECT'));
    if (event.kind === 'BOMB_PLANTED' && event.actorId && event.context?.actorSide === 'T' && roundById.get(event.roundId)?.winnerTeamId === teamByPlayer.get(event.actorId)) result.push(finding(config, 'BOMB_PLANT_WIN', 'POSITIVE', event.actorId, event, 1, 1, config.weights.bombPlantWin, 'DERIVED'));
    if (event.kind === 'PLAYER_BLIND' && event.actorId && event.targetId && event.actorId !== event.targetId) {
      const duration = numberAttr(event, 'blindDuration'); const actorTeam = teamByPlayer.get(event.actorId); const targetTeam = teamByPlayer.get(event.targetId); if (!actorTeam || !targetTeam) continue; const friendly = actorTeam === targetTeam;
      if (friendly && duration !== null) result.push(finding(config, 'TEAM_FLASH', 'NEGATIVE', event.actorId, event, Math.min(duration / 5, 1), config.weights.teamFlashConfidence, config.weights.teamFlash, 'DIRECT'));
      if (!friendly && duration !== null && config.weights.flashSupport > 0) result.push(finding(config, 'FLASH_SUPPORT', 'POSITIVE', event.actorId, event, duration / 5, 1, config.weights.flashSupport, 'RESEARCH_HYPOTHESIS'));
    }
  }
  return result.sort((a, b) => (roundById.get(a.roundId)?.ordinal ?? 0) - (roundById.get(b.roundId)?.ordinal ?? 0) || a.tick - b.tick || a.evidenceEventIds[0]!.localeCompare(b.evidenceEventIds[0]!) || a.code.localeCompare(b.code));
}

function isFirearm(event: MatchEvent): boolean {
  const value = stringAttr(event, 'weapon'); if (!value) return false;
  return !['hegrenade','inferno','molotov','incgrenade','flashbang','smokegrenade','decoy','world','knife','taser','planted_c4'].includes(value);
}

function buildEpisodes(artifact: MatchArtifact, findings: ScoringFinding[], config: ScoringConfig): ScoringEpisode[] {
  const { match } = artifact; const eventById = new Map(match.events.map((event) => [event.id, event])); const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const live = match.events.filter(isLive).sort(eventOrder); const episodes: EpisodeCore[] = []; const representedFindingIds = new Set<string>();
  const killsByRoundPlayer = new Map<string, MatchEvent[]>();
  for (const event of live.filter((item) => item.kind === 'PLAYER_DEATH' && item.actorId && item.targetId && item.actorId !== item.targetId && teamByPlayer.get(item.actorId) !== teamByPlayer.get(item.targetId))) {
    const key = `${event.roundId}:${event.actorId}`; killsByRoundPlayer.set(key, [...(killsByRoundPlayer.get(key) ?? []), event]);
  }
  for (const rows of killsByRoundPlayer.values()) {
    const first = rows[0]; if (!first?.actorId) continue; const related = findings.filter((item) => rows.some((row) => item.evidenceEventIds.includes(row.id)) && positiveCodes.has(item.code));
    related.forEach((item) => representedFindingIds.add(item.id));
    const multi = rows.length >= 2; const ids = [...new Set(rows.map((row) => row.id))];
    const idValue = `episode:${first.roundId}:${first.actorId}:${first.tick}:positive`;
    episodes.push({ id: idValue, kind: 'HIGHLIGHT', type: multi ? 'MULTIKILL_SEQUENCE' : 'COMBAT_CONTRIBUTION', playerId: first.actorId, roundId: first.roundId, startTick: first.tick, endTick: rows.at(-1)!.tick, evidenceEventIds: ids, observedFacts: [`enemyKills=${rows.length}`, ...related.map((item) => `${item.code}=${item.weightedValue}`)], significance: round6(related.reduce((sum, item) => sum + item.weightedValue, 0)), confidence: 1, evidenceStrength: multi ? 'DERIVED' : 'DIRECT', explanationKey: multi ? 'episode.multikill' : 'episode.combat', supportingFindingCodes: [...new Set(related.map((item) => item.code))], context: contextOf(first), research: null });
  }
  for (const positive of findings.filter((item) => item.category === 'POSITIVE' && !representedFindingIds.has(item.id))) {
    const source = eventById.get(positive.evidenceEventIds[0]!); if (!source) continue;
    const type = positive.code === 'ENEMY_DAMAGE' ? 'DAMAGE_CONTRIBUTION' : positive.code === 'FLASH_SUPPORT' ? 'FLASH_SUPPORT_HYPOTHESIS' : 'OBJECTIVE_CONTRIBUTION';
    episodes.push({ id: `episode:${source.roundId}:${positive.playerId}:${source.tick}:${source.source.rowIndex}:${positive.code.toLowerCase()}`, kind: 'HIGHLIGHT', type, playerId: positive.playerId, roundId: source.roundId, startTick: source.tick, endTick: source.tick, evidenceEventIds: positive.evidenceEventIds, observedFacts: [`${positive.code}=${positive.weightedValue}`], significance: positive.weightedValue, confidence: positive.confidence, evidenceStrength: positive.evidenceStrength, explanationKey: `episode.${positive.code.toLowerCase()}`, supportingFindingCodes: [positive.code], context: contextOf(source), research: null });
  }
  const teamKillFindings = findings.filter((item) => item.code === 'TEAM_KILL'); const teamDamageFindings = findings.filter((item) => item.code === 'TEAM_DAMAGE');
  const bundledDamage = new Set<string>();
  for (const teamKill of teamKillFindings) {
    const death = eventById.get(teamKill.evidenceEventIds[0]!); if (!death) continue;
    const damage = teamDamageFindings.find((candidate) => { const hurt = eventById.get(candidate.evidenceEventIds[0]!); return hurt?.roundId === death.roundId && hurt.actorId === death.actorId && hurt.targetId === death.targetId && numberAttr(hurt, 'healthAfter') === 0 && (hurt.tick < death.tick || hurt.tick === death.tick && hurt.source.rowIndex <= death.source.rowIndex); });
    if (damage) bundledDamage.add(damage.id); const ids = [death.id, ...(damage?.evidenceEventIds ?? [])];
    const severity = config.model === 'SUCCESSOR' && config.policies.bundleLethalTeamDamage ? teamKill.weightedValue : teamKill.weightedValue + (damage?.weightedValue ?? 0);
    episodes.push({ id: `episode:${death.roundId}:${death.actorId}:${death.tick}:team-kill`, kind: 'ANTI_HIGHLIGHT', type: 'TEAM_KILL_EPISODE', playerId: death.actorId!, roundId: death.roundId, startTick: Math.min(...ids.map((value) => eventById.get(value)?.tick ?? death.tick)), endTick: death.tick, evidenceEventIds: [...new Set(ids)], observedFacts: ['teamKill=true', ...(damage ? [`linkedFriendlyDamageHP=${round6(damage.magnitude * 100)}`] : [])], significance: round6(severity), confidence: 1, evidenceStrength: 'DIRECT', explanationKey: 'episode.team_kill', supportingFindingCodes: damage ? ['TEAM_KILL','TEAM_DAMAGE'] : ['TEAM_KILL'], context: contextOf(death), research: null });
  }
  for (const damage of teamDamageFindings.filter((item) => !bundledDamage.has(item.id))) {
    const event = eventById.get(damage.evidenceEventIds[0]!); if (!event?.actorId) continue;
    episodes.push({ id: `episode:${event.roundId}:${event.actorId}:${event.tick}:${event.source.rowIndex}:team-damage`, kind: 'ANTI_HIGHLIGHT', type: 'TEAM_DAMAGE_EPISODE', playerId: event.actorId, roundId: event.roundId, startTick: event.tick, endTick: event.tick, evidenceEventIds: [event.id], observedFacts: [`friendlyDamageHP=${round6(damage.magnitude * 100)}`], significance: damage.weightedValue, confidence: 1, evidenceStrength: 'DIRECT', explanationKey: 'episode.team_damage', supportingFindingCodes: ['TEAM_DAMAGE'], context: contextOf(event), research: null });
  }
  for (const flash of findings.filter((item) => item.code === 'TEAM_FLASH')) {
    const event = eventById.get(flash.evidenceEventIds[0]!); if (!event?.actorId) continue;
    episodes.push({ id: `episode:${event.roundId}:${event.actorId}:${event.tick}:${event.source.rowIndex}:team-flash`, kind: 'ANTI_HIGHLIGHT', type: 'TEAM_FLASH_EPISODE', playerId: event.actorId, roundId: event.roundId, startTick: event.tick, endTick: event.tick, evidenceEventIds: [event.id], observedFacts: [`friendlyBlindSeconds=${numberAttr(event,'blindDuration') ?? 'unavailable'}`], significance: flash.weightedValue, confidence: flash.confidence, evidenceStrength: 'DIRECT', explanationKey: 'episode.team_flash', supportingFindingCodes: ['TEAM_FLASH'], context: contextOf(event), research: null });
  }
  if (config.model === 'SUCCESSOR') for (const death of live.filter((event) => event.kind === 'PLAYER_DEATH' && boolAttr(event,'suicide') === true && event.actorId)) {
    const suicideFinding = finding(config, 'LIVE_SUICIDE', 'NEGATIVE', death.actorId!, death, 1, 1, config.weights.liveSuicide, 'DIRECT'); findings.push(suicideFinding);
    episodes.push({ id: `episode:${death.roundId}:${death.actorId}:${death.tick}:suicide`, kind: 'ANTI_HIGHLIGHT', type: 'LIVE_SUICIDE_EPISODE', playerId: death.actorId!, roundId: death.roundId, startTick: death.tick, endTick: death.tick, evidenceEventIds: [death.id], observedFacts: ['liveSuicide=true'], significance: suicideFinding.weightedValue, confidence: 1, evidenceStrength: 'DIRECT', explanationKey: 'episode.live_suicide', supportingFindingCodes: ['LIVE_SUICIDE'], context: contextOf(death), research: null });
  }
  if (match.tickRate !== null) for (const hurt of live.filter((event) => event.kind === 'PLAYER_HURT' && event.actorId && event.targetId && event.actorId !== event.targetId && teamByPlayer.get(event.actorId) === teamByPlayer.get(event.targetId) && isFirearm(event))) {
    const enemyHurt = live.find((candidate) => candidate.kind === 'PLAYER_HURT' && candidate.roundId === hurt.roundId && candidate.actorId === hurt.actorId && candidate.targetId && teamByPlayer.get(candidate.targetId) !== teamByPlayer.get(hurt.actorId!) && isFirearm(candidate) && (candidate.tick > hurt.tick || candidate.tick === hurt.tick && candidate.source.rowIndex > hurt.source.rowIndex));
    if (!enemyHurt) continue; const interval = (enemyHurt.tick - hurt.tick) / match.tickRate; const classification = interval <= 0.5 ? 'STRONG' : interval <= 1 ? 'MODERATE' : 'NOT_TRIGGERED';
    episodes.push({ id: `research:${hurt.roundId}:${hurt.actorId}:${hurt.tick}:${hurt.source.rowIndex}`, kind: 'RESEARCH', type: 'FRIENDLY_FIRE_COMBAT_CONTEXT', playerId: hurt.actorId!, roundId: hurt.roundId, startTick: hurt.tick, endTick: enemyHurt.tick, evidenceEventIds: [hurt.id, enemyHurt.id], observedFacts: [`friendlyFirearmDamageThenEnemyFirearmDamage=${round6(interval)}s`], significance: null, confidence: 0, evidenceStrength: 'RESEARCH_HYPOTHESIS', explanationKey: 'research.ff_combat_context', supportingFindingCodes: [], context: contextOf(hurt), research: { classification, intervalSeconds: round6(interval), alternatives: ['crossfire','target transition','accidental input','unknown positioning and visibility'] } });
  }
  const configHash = scoringConfigHash(config);
  return episodes.sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id)).map((episode) => ({ ...episode, scorerVersion: config.version, configHash }));
}

function coverage(artifact: MatchArtifact, winningTeamId: string | null, losingTeamId: string | null): ScoringReport['coverage'] {
  const { match, analytics } = artifact; const valid = match.rounds.filter((round) => round.isValid).length; const rounds = match.rounds.length === 0 ? 0 : valid / match.rounds.length;
  const identities = match.players.length === 10 && match.teams.length === 2 && match.teams.every((team) => team.playerIds.length === 5) ? 1 : Math.min(1, match.players.length / 10);
  const liveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH' && isLive(event)); const deaths = liveDeaths.length === 0 ? 0 : liveDeaths.filter((event) => event.targetId !== null).length / liveDeaths.length;
  const availability = (value: 'AVAILABLE'|'PARTIAL'|'UNAVAILABLE'): number => value === 'AVAILABLE' ? 1 : value === 'PARTIAL' ? 0.5 : 0;
  const enemyDamage = availability(analytics.availability.damage); const teamDamage = enemyDamage; const reasons: string[] = [];
  if (match.quality !== 'VALID') reasons.push(`match-quality-${match.quality.toLowerCase()}`); if (rounds < 0.9) reasons.push('round-coverage-below-90-percent'); if (valid < 8) reasons.push('fewer-than-8-valid-rounds'); if (identities < 0.95) reasons.push('identity-coverage-below-95-percent'); if (deaths < 0.95) reasons.push('death-coverage-below-95-percent'); if (!winningTeamId || !losingTeamId) reasons.push('missing-unique-team-outcome');
  const eligible = match.quality === 'VALID' && rounds >= 0.9 && valid >= 8 && identities >= 0.95 && deaths >= 0.95 && winningTeamId !== null && losingTeamId !== null;
  return { score: round6((rounds + identities + deaths + enemyDamage + teamDamage) / 5), rounds: round6(rounds), identities: round6(identities), deaths: round6(deaths), enemyDamage, teamDamage, eligible, reasons };
}

export function scoreMatch(artifactInput: MatchArtifact, configInput: ScoringConfig): ScoringReport {
  const artifact = artifactInput; const config = scoringConfigSchema.parse(configInput); const configHash = scoringConfigHash(config); const { winningTeamId, losingTeamId } = teamOutcome(artifact); const scoreCoverage = coverage(artifact, winningTeamId, losingTeamId);
  const findings = buildFindings(artifact, config); const episodes = buildEpisodes(artifact, findings, config); findings.sort((a,b) => a.tick-b.tick || a.id.localeCompare(b.id));
  const analyticsByPlayer = new Map(artifact.analytics.players.map((player) => [player.playerId, player])); const validRounds = artifact.match.rounds.filter((round) => round.isValid).length;
  const playerRows: PlayerMutable[] = artifact.match.players.map((identity) => {
    const analytics = analyticsByPlayer.get(identity.id); const ownFindings = findings.filter((item) => item.playerId === identity.id); const positive = round6(ownFindings.filter((item) => item.category === 'POSITIVE').reduce((sum,item)=>sum+item.weightedValue,0));
    const ownEpisodes = episodes.filter((item) => item.playerId === identity.id); const successorNegative = ownEpisodes.filter((item) => item.kind === 'ANTI_HIGHLIGHT').reduce((sum,item)=>sum+(item.significance ?? 0),0); const v1Negative = ownFindings.filter((item) => item.category === 'NEGATIVE').reduce((sum,item)=>sum+item.weightedValue,0); const negative = round6(config.model === 'SUCCESSOR' ? successorNegative : v1Negative); const net = round6(positive-negative);
    const contextPoints = round6(ownFindings.filter((item)=>item.category==='POSITIVE' && contextCodes.has(item.code)).reduce((sum,item)=>sum+item.weightedValue,0)); const rate = validRounds > 0 ? round6(net/validRounds) : null; const positiveRate = validRounds > 0 ? round6(positive/validRounds) : null; const harmRate = validRounds > 0 ? round6(negative/validRounds) : null;
    const bombPlantsWon = ownFindings.filter((item)=>item.code==='BOMB_PLANT_WIN').length; const flashAssists = analytics?.facts.filter((fact)=>fact.kind==='FLASH_ASSIST').length ?? 0; const multiKillRounds = analytics ? Object.values(analytics.multiKills).reduce((sum,value)=>sum+value,0) : 0;
    return { playerId: identity.id, teamId: identity.teamId, validRounds, positive, negative, net, positiveRate, performanceRate: rate, contextContributionRate: validRounds > 0 ? round6(contextPoints/validRounds) : null, confirmedHarmRate: harmRate, teamReference: null, positiveShortfall: null, ruinRaw: null, relativeIndex: null,
      components: { performance: { kills: analytics?.kills ?? null, assists: analytics?.assists ?? null, enemyDamage: analytics?.enemyDamage ?? null, adr: analytics?.adr ?? null, kastPercent: analytics?.kastPercent ?? null, survivedRounds: analytics?.survivedRounds ?? null, multiKillRounds, flashAssists, enemyBlindSeconds: analytics?.grenades.enemyBlindSeconds ?? null }, contextContribution: { points: contextPoints, openingKills: analytics?.openingKills ?? null, tradeKills: analytics?.tradeKills ?? null, killsWithAdvantage: analytics?.killsWithAdvantage ?? null, killsAtDisadvantage: analytics?.killsAtDisadvantage ?? null, bombPlantsWon, bombDefuses: analytics?.bomb.defuses ?? null }, confirmedHarm: { points: negative, teamDamage: analytics?.teamDamage ?? null, teamKills: analytics?.teamKills ?? null, teamBlindSeconds: analytics?.grenades.teamBlindSeconds ?? null, liveSuicides: analytics?.suicides ?? null } }, findings: ownFindings, episodeIds: ownEpisodes.map((item)=>item.id) };
  });
  const losers = playerRows.filter((player)=>player.teamId===losingTeamId); const reference = losers.length === 5 ? losers.reduce((sum,player)=>sum+(config.model==='V1_COMPAT' ? player.performanceRate ?? 0 : player.positiveRate ?? 0),0)/5 : 0;
  for (const player of losers) { const compared = config.model==='V1_COMPAT' ? player.performanceRate ?? 0 : player.positiveRate ?? 0; const shortfall = Math.max(0,reference-compared); player.teamReference=round6(reference); player.positiveShortfall=round6(shortfall); player.ruinRaw=round6(config.alpha*shortfall+config.beta*(player.confirmedHarmRate ?? 0)); }
  const raws=losers.map((player)=>player.ruinRaw ?? 0); const min=raws.length > 0 ? Math.min(...raws) : 0; const max=raws.length > 0 ? Math.max(...raws) : 0; for(const player of losers) player.relativeIndex=max===min?0:Math.round(100*((player.ruinRaw??0)-min)/(max-min));
  const mvpOrdered=[...playerRows].filter((player)=>player.performanceRate!==null).sort((a,b)=>(b.performanceRate??0)-(a.performanceRate??0)||a.playerId.localeCompare(b.playerId)); const mvpTop=mvpOrdered[0]; const mvpSecond=mvpOrdered[1]; const mvpMargin=mvpTop&&mvpSecond?round6((mvpTop.performanceRate??0)-(mvpSecond.performanceRate??0)):0; const mvpTies=mvpTop?mvpOrdered.filter((player)=>Math.abs((player.performanceRate??0)-(mvpTop.performanceRate??0))<epsilon).map((player)=>player.playerId):[];
  const mvp=scoreCoverage.eligible&&mvpTop?{playerId:mvpTop.playerId,rate:mvpTop.performanceRate!,tied:mvpTies.length>1,close:mvpMargin<config.thresholds.mvpCloseGap,tiedPlayerIds:mvpTies,margin:mvpMargin,reason:mvpTies.length>1?'primary-score-tie-stable-id-tiebreak':mvpMargin<config.thresholds.mvpCloseGap?'close-experimental-baseline':'highest-net-per-valid-round'}:null;
  const ruinedOrdered=[...losers].sort((a,b)=>(b.ruinRaw??0)-(a.ruinRaw??0)||(config.model === 'V1_COMPAT' ? (a.performanceRate??0)-(b.performanceRate??0) : (a.positiveRate??0)-(b.positiveRate??0))||a.playerId.localeCompare(b.playerId)); const worst=ruinedOrdered[0]; const secondWorst=ruinedOrdered[1]; const margin=worst&&secondWorst?round6((worst.ruinRaw??0)-(secondWorst.ruinRaw??0)):0; const tied=worst?ruinedOrdered.filter((player)=>Math.abs((player.ruinRaw??0)-(worst.ruinRaw??0))<epsilon).map((player)=>player.playerId):[]; const spread=raws.length?round6(Math.max(...raws)-Math.min(...raws)):0;
  const v1Clear=config.model==='V1_COMPAT'&&scoreCoverage.eligible&&worst&&spread>=config.thresholds.v1Spread&&margin>=config.thresholds.v1TopMargin?worst.playerId:null; const successorAssign=config.model==='SUCCESSOR'&&config.policies.alwaysAssignWhoRuinedOnEligibleSuccessor;
  const assign=scoreCoverage.eligible&&worst&&(successorAssign||v1Clear!==null); const whoRuined=assign&&worst?{playerId:worst.playerId,ruinRaw:worst.ruinRaw??0,relativeIndex:worst.relativeIndex??0,primaryScoreTied:tied.length>1,close:margin<config.thresholds.closeGap,tiedPlayerIds:tied,margin,noConfirmedHarm:losers.every((player)=>player.negative===0),reason:tied.length>1?'primary-score-tie-stable-id-tiebreak':margin<config.thresholds.closeGap?'assigned-with-low-distinguishability':config.model==='V1_COMPAT'?'v1-clear-ruiner':'highest-successor-ruin-raw'}:null;
  const warnings:string[]=[]; if(config.model==='SUCCESSOR') warnings.push('Экспериментальный относительный индекс: не вероятность поражения и не доказательство намеренного вреда.'); if(whoRuined?.close) warnings.push('Низкая различимость: лидер назначен по политике successor, но отрыв мал.'); if(whoRuined?.primaryScoreTied) warnings.push('Основной score равен; применён стабильный tie-break.'); if(scoreCoverage.enemyDamage<1) warnings.push('Damage coverage неполный; score имеет пониженную доказательность.');
  const status:ScoringReport['status']=artifact.match.quality==='UNSUPPORTED'?'UNSUPPORTED':artifact.match.quality==='PARTIAL'?'PARTIAL':scoreCoverage.eligible?'COMPLETED':'INSUFFICIENT_COVERAGE';
  const rounds = artifact.match.rounds.filter((round) => round.isValid).sort((left, right) => left.ordinal - right.ordinal).map((round) => ({ roundId: round.id, ordinal: round.ordinal, players: artifact.match.players.map((identity) => { const roundFindings = findings.filter((item) => item.roundId === round.id && item.playerId === identity.id); const roundEpisodes = episodes.filter((item) => item.roundId === round.id && item.playerId === identity.id); const positive = round6(roundFindings.filter((item) => item.category === 'POSITIVE').reduce((sum, item) => sum + item.weightedValue, 0)); const negative = round6(config.model === 'SUCCESSOR' ? roundEpisodes.filter((item) => item.kind === 'ANTI_HIGHLIGHT').reduce((sum, item) => sum + (item.significance ?? 0), 0) : roundFindings.filter((item) => item.category === 'NEGATIVE').reduce((sum, item) => sum + item.weightedValue, 0)); return { playerId: identity.id, positive, negative, net: round6(positive - negative), findingIds: roundFindings.map((item) => item.id), episodeIds: roundEpisodes.map((item) => item.id) }; }) }));
  return scoringReportSchema.parse({schemaVersion:'m3-score-1',matchId:artifact.match.matchId,scorerVersion:config.version,configHash,model:config.model,experimental:true,status,quality:artifact.match.quality,winningTeamId,losingTeamId,coverage:scoreCoverage,mvp,whoRuined,v1ClearRuinerPlayerId:v1Clear,players:playerRows,episodes,rounds,warnings,limitations:['Обычная смерть, неразмененная смерть и проигранный clutch не являются автоматическими ошибками.','Research-гипотезы не изменяют score.','Нет обученной win-probability модели; Context Contribution не является Round Swing.']});
}
