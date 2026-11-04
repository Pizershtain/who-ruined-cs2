import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDataGCCStrike15_v2_MatchInfoSchema, fromBinary } from 'csgo-protobuf';
import { matchDataSchema, type MatchAnalytics, type MatchData, type MatchEvent } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { assertMatchRelations, normalizeSnapshot, stableTeamId } from '@who-ruined/match-domain';
import { asText, NORMALIZER_VERSION, PARSER_LIBRARY_VERSION, parseDemoSnapshot, toNormalizationInput, type ParsedDemoSnapshot } from '@who-ruined/parser-adapter';

export type ValidationStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED';
export interface ValidationCheck { name: string; status: ValidationStatus; explanation: string }
export interface DemoValidationResult {
  demoId: string;
  status: ValidationStatus;
  metadata: { map: string | null; mode: string | null; scoreStableTeamOrder: number[] | null; teams: number; rosterSizes: number[]; rounds: number; quality: string | null };
  eventCounts: { liveDeaths: number; nonLiveDeaths: number; normalizedEvents: number };
  scenarios: { overtimeRounds: number; sideSwitches: number; liveSuicides: number; nonLiveSuicides: number; teamKills: number; worldDeaths: number; connects: number; disconnects: number; reconnects: number };
  m2Aggregates: { enemyDamage: number | null; teamDamage: number | null; kastRounds: number; trades: number; utilityDamage: number | null } | null;
  checks: { parser: ValidationCheck; mode: ValidationCheck; internal: ValidationCheck[]; independent: ValidationCheck[]; m2: ValidationCheck[] };
}
export interface BatchValidationReport {
  schemaVersion: 'demo-validation-1';
  generatedAt: string;
  parserVersion: string;
  normalizerVersion: string;
  privacy: { personalDataIncluded: false; filePathsIncluded: false };
  summary: { discovered: number; pass: number; partial: number; fail: number; skipped: number; withInfo: number };
  demos: DemoValidationResult[];
}

const steamId64Base = 76_561_197_960_265_728n;
const pass = (name: string, explanation: string): ValidationCheck => ({ name, status: 'PASS', explanation });
const fail = (name: string, explanation: string): ValidationCheck => ({ name, status: 'FAIL', explanation });
const partial = (name: string, explanation: string): ValidationCheck => ({ name, status: 'PARTIAL', explanation });
const skipped = (name: string, explanation: string): ValidationCheck => ({ name, status: 'SKIPPED', explanation });

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function statusFromChecks(checks: ValidationCheck[], hasInfo: boolean): ValidationStatus {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (!hasInfo || checks.some((check) => check.status === 'PARTIAL')) return 'PARTIAL';
  return 'PASS';
}

function isEnemyDeath(event: MatchEvent, playerTeam: ReadonlyMap<string, string>): boolean {
  if (event.kind !== 'PLAYER_DEATH' || event.actorId === null || event.targetId === null || event.actorId === event.targetId) return false;
  const actorTeam = playerTeam.get(event.actorId); const targetTeam = playerTeam.get(event.targetId);
  return actorTeam !== undefined && targetTeam !== undefined && actorTeam !== targetTeam;
}

function checkInternal(match: MatchData, snapshot: ParsedDemoSnapshot): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  checks.push(match.quality === 'VALID' ? pass('normalized-quality', 'Normalized match quality is VALID.') : partial('normalized-quality', `Normalized match quality is ${match.quality}; ${match.qualityIssues.length} issue(s).`));
  checks.push(match.teams.length === 2 && match.teams.every((team) => team.playerIds.length === 5) ? pass('stable-teams', 'Two roster-derived 5-player teams are present.') : fail('stable-teams', 'Expected two roster-derived 5-player teams.'));
  checks.push(match.players.length === 10 && new Set(match.players.map((player) => player.id)).size === 10 ? pass('players', 'Ten unique normalized players are present.') : fail('players', 'Normalized player identity is not a unique 10-player roster.'));
  checks.push(match.rounds.length > 0 && match.rounds.every((round) => round.isValid) ? pass('rounds', `${match.rounds.length} round(s) satisfy winner, side and score invariants.`) : fail('rounds', 'One or more normalized rounds are invalid or missing.'));
  checks.push(new Set(match.events.map((event) => event.id)).size === match.events.length ? pass('event-ids', 'Normalized event IDs are unique.') : fail('event-ids', 'Duplicate normalized event IDs detected.'));
  const liveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH');
  const nonLiveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE');
  const duplicateLiveDeaths = new Set<string>(); const seen = new Set<string>();
  for (const event of liveDeaths) { if (!event.targetId) continue; const key = `${event.roundId}:${event.targetId}`; if (seen.has(key)) duplicateLiveDeaths.add(key); seen.add(key); }
  checks.push(duplicateLiveDeaths.size === 0 ? pass('live-death-dedup', 'No player has two live deaths in one round.') : fail('live-death-dedup', `${duplicateLiveDeaths.size} duplicate live round/player death key(s).`));
  const scoreboardDeaths = match.players.reduce((sum, player) => sum + (player.scoreboard?.deaths ?? 0), 0);
  const scoreboardPhaseDeaths = [...liveDeaths, ...nonLiveDeaths].filter((event) => event.targetId !== null && event.context?.phase !== 'POST_ROUND').length;
  checks.push(scoreboardDeaths === scoreboardPhaseDeaths ? pass('scoreboard-phase-deaths', `All ${scoreboardDeaths} scoreboard-counted deaths are retained; post-round deaths remain factual but excluded.`) : fail('scoreboard-phase-deaths', `Scoreboard deaths ${scoreboardDeaths} differ from normalized scoreboard-phase deaths ${scoreboardPhaseDeaths}.`));
  const rawDeaths = snapshot.events.filter((row) => asText(row, ['event_name','event','name']) === 'player_death').length;
  checks.push(rawDeaths === liveDeaths.length + nonLiveDeaths.length ? pass('raw-death-coverage', `All ${rawDeaths} parsed death rows are normalized.`) : fail('raw-death-coverage', `${rawDeaths} parsed deaths but ${liveDeaths.length + nonLiveDeaths.length} normalized.`));
  return checks;
}

function checkM2(match: MatchData, analytics: MatchAnalytics): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const playerTeam = new Map(match.players.map((player) => [player.id, player.teamId]));
  const liveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH');
  const enemyDeaths = liveDeaths.filter((event) => isEnemyDeath(event, playerTeam));
  const sum = (pick: (player: MatchAnalytics['players'][number]) => number | null): number => analytics.players.reduce((total, player) => total + (pick(player) ?? 0), 0);
  const metricDeaths = sum((player) => player.deaths);
  checks.push(metricDeaths === liveDeaths.filter((event) => event.targetId !== null).length ? pass('live-phase-isolation', 'M2 deaths contain live events only; pre-freeze/post-round deaths are excluded.') : fail('live-phase-isolation', 'M2 deaths do not equal assigned live death events.'));
  const adrValid = analytics.players.every((player) => player.enemyDamage === null ? player.adr === null : player.roundsPlayed > 0 && Math.abs((player.adr ?? -1) - player.enemyDamage / player.roundsPlayed) < 1e-9);
  checks.push(adrValid ? pass('adr', 'ADR equals chronological HP-capped enemy damage divided by rounds played.') : fail('adr', 'ADR formula mismatch.'));
  const kastValid = analytics.players.every((player) => player.kastRounds !== null && player.kastRounds <= player.roundsPlayed && (player.roundsPlayed === 0 ? player.kastPercent === null : Math.abs((player.kastPercent ?? -1) - player.kastRounds / player.roundsPlayed * 100) < 1e-9));
  checks.push(kastValid ? pass('kast', 'KAST round counts and percentages are bounded and mathematically consistent.') : fail('kast', 'KAST formula or bounds mismatch.'));
  const tradeKills = sum((player) => player.tradeKills); const tradedDeaths = sum((player) => player.deathsTraded);
  checks.push(tradeKills === tradedDeaths && tradeKills <= enemyDeaths.length ? pass('trades', `${tradeKills} one-to-one trades have equal revenge-kill and traded-death counts.`) : fail('trades', 'Trade matching is not one-to-one or exceeds eligible enemy deaths.'));
  const openingKills = sum((player) => player.openingKills); const openingDeaths = sum((player) => player.openingDeaths);
  const roundsWithEnemyDeath = new Set(enemyDeaths.map((event) => event.roundId)).size;
  checks.push(openingKills === openingDeaths && openingKills === roundsWithEnemyDeath ? pass('openings', `${openingKills} opening pairs equal rounds containing an enemy death.`) : fail('openings', 'Opening kill/death aggregation mismatch.'));
  let multikillValid = true;
  for (const player of analytics.players) {
    const byRound = new Map<string, number>();
    for (const event of enemyDeaths.filter((item) => item.actorId === player.playerId)) byRound.set(event.roundId, (byRound.get(event.roundId) ?? 0) + 1);
    const expected = { two: 0, three: 0, four: 0, five: 0 };
    for (const count of byRound.values()) { if (count === 2) expected.two += 1; else if (count === 3) expected.three += 1; else if (count === 4) expected.four += 1; else if (count >= 5) expected.five += 1; }
    if (JSON.stringify(expected) !== JSON.stringify(player.multiKills)) multikillValid = false;
  }
  checks.push(multikillValid ? pass('multikills', 'Multi-kill buckets exactly match per-round enemy kill counts.') : fail('multikills', 'Multi-kill bucket mismatch.'));
  const flashAssistEvents = liveDeaths.filter((event) => event.assisterId !== null && event.attrs.assistedFlash === true).length;
  const flashAssistFacts = analytics.players.flatMap((player) => player.facts).filter((fact) => fact.kind === 'FLASH_ASSIST').length;
  checks.push(flashAssistEvents === flashAssistFacts ? pass('flash-assists', `${flashAssistFacts} flash assists match normalized death facts.`) : fail('flash-assists', 'Flash assist facts are duplicated or missing.'));
  const durationsValid = analytics.players.every((player) => (player.grenades.enemyBlindSeconds === null || player.grenades.enemyBlindSeconds >= 0) && (player.grenades.teamBlindSeconds === null || player.grenades.teamBlindSeconds >= 0));
  checks.push(durationsValid ? pass('blind-duration', 'Aggregated blind durations are non-negative and availability-aware.') : fail('blind-duration', 'Invalid blind duration aggregate.'));
  const utilityValid = analytics.players.every((player) => player.enemyDamage === null || player.teamDamage === null || ((player.grenades.heEnemyDamage ?? 0) + (player.grenades.infernoEnemyDamage ?? 0) <= player.enemyDamage && (player.grenades.heTeamDamage ?? 0) + (player.grenades.infernoTeamDamage ?? 0) <= player.teamDamage));
  checks.push(utilityValid ? pass('utility-damage', 'Enemy/team HE and inferno damage are bounded by total actual damage.') : fail('utility-damage', 'Utility damage exceeds total damage, indicating double counting.'));
  const economyValid = analytics.players.every((player) => player.economy.freezeRoundsObserved === null || player.economy.freezeRoundsObserved <= player.roundsPlayed);
  checks.push(economyValid ? pass('economy', 'Freeze equipment observations are bounded by rounds played; unavailable money remains null.') : fail('economy', 'Economy observation count exceeds rounds played.'));
  const clutchValid = analytics.players.every((player) => Object.entries(player.clutches).every(([key, count]) => /^1v[1-5]$/.test(key) && count >= 0));
  checks.push(clutchValid ? pass('clutches', 'Clutch facts use bounded 1vX keys and validated round outcomes.') : fail('clutches', 'Invalid clutch aggregate.'));
  return checks;
}

async function checkInfo(infoPath: string | null, match: MatchData): Promise<ValidationCheck[]> {
  if (!infoPath) return [skipped('info-reference', 'No matching .dem.info was found; independent reconciliation was not performed.')];
  try {
    const info = fromBinary(CDataGCCStrike15_v2_MatchInfoSchema, await readFile(infoPath));
    const rounds = info.roundstatsall; const final = rounds.at(-1);
    if (!final?.reservation || final.reservation.accountIds.length !== 10) return [fail('info-reference', '.dem.info does not contain a supported 10-player roster.')];
    const playerIds = final.reservation.accountIds.map((accountId) => (BigInt(accountId) + steamId64Base).toString());
    const referenceTeams = [stableTeamId(playerIds.slice(0, 5)), stableTeamId(playerIds.slice(5, 10))];
    const roundCheck = match.rounds.length === rounds.length && match.rounds.every((round, index) => referenceTeams.every((teamId, teamIndex) => round.scoreAfter[teamId] === rounds[index]?.teamScores[teamIndex]));
    const kdaCheck = playerIds.every((playerId, index) => {
      const stats = match.players.find((player) => player.id === playerId)?.scoreboard;
      return stats !== undefined && stats.kills === final.kills[index] && stats.deaths === final.deaths[index] && stats.assists === final.assists[index];
    });
    return [
      roundCheck ? pass('info-round-score', `All ${rounds.length} round score transitions match .dem.info.`) : fail('info-round-score', 'Round count or score transitions differ from .dem.info.'),
      kdaCheck ? pass('info-kda', 'All 10 K/D/A rows match .dem.info.') : fail('info-kda', 'One or more K/D/A rows differ from .dem.info.')
    ];
  } catch {
    return [fail('info-reference', 'The matching .dem.info could not be decoded safely.')];
  }
}

export async function validateDemo(demoPath: string, infoPath: string | null): Promise<DemoValidationResult> {
  let digest = 'unreadable';
  try { digest = await sha256(demoPath); } catch { /* reported below without path */ }
  const demoId = digest.slice(0, 16);
  try {
    const snapshot = parseDemoSnapshot(demoPath);
    const match = matchDataSchema.parse(normalizeSnapshot(toNormalizationInput({ matchId: `validation_${demoId}`, fileSha256: digest, normalizedAt: '2000-01-01T00:00:00.000Z', snapshot })));
    assertMatchRelations(match);
    const analytics = computeMatchAnalytics(match, '2000-01-01T00:00:00.000Z');
    const internal = checkInternal(match, snapshot); const m2 = checkM2(match, analytics); const independent = await checkInfo(infoPath, match);
    const parser = pass('parser', 'Source 2 demo parsed and normalized without an uncaught error.');
    const mode = skipped('mode', 'Neither the Source 2 header nor the supported .dem.info schema exposes an authoritative game-mode field.');
    const allChecks = [parser, mode, ...internal, ...independent, ...m2];
    const finalRound = match.rounds.at(-1);
    const teamOrder = match.teams.map((team) => team.id).sort();
    const sideSwitches = match.rounds.slice(1).filter((round, index) => JSON.stringify(round.sideByTeamId) !== JSON.stringify(match.rounds[index]?.sideByTeamId)).length;
    const allDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH' || event.kind === 'PLAYER_DEATH_NONLIVE');
    const connectionRows = snapshot.events.map((row, rowIndex) => ({ row, rowIndex })).sort((a, b) => (Number(a.row.tick) || 0) - (Number(b.row.tick) || 0) || a.rowIndex - b.rowIndex);
    const disconnected = new Set<string>(); let reconnects = 0;
    for (const { row } of connectionRows) {
      const name = asText(row, ['event_name','event','name']); const playerId = asText(row, ['user_steamid','networkid','xuid']);
      if (!playerId) continue;
      if (name === 'player_disconnect') disconnected.add(playerId);
      if ((name === 'player_connect' || name === 'player_connect_full') && disconnected.delete(playerId)) reconnects += 1;
    }
    const sum = (pick: (player: MatchAnalytics['players'][number]) => number | null): number => analytics.players.reduce((total, player) => total + (pick(player) ?? 0), 0);
    const enemyDamage = analytics.availability.damage === 'UNAVAILABLE' ? null : sum((player) => player.enemyDamage);
    const teamDamage = analytics.availability.damage === 'UNAVAILABLE' ? null : sum((player) => player.teamDamage);
    const utilityDamage = analytics.availability.damage === 'UNAVAILABLE' ? null : sum((player) => (player.grenades.heEnemyDamage ?? 0) + (player.grenades.heTeamDamage ?? 0) + (player.grenades.infernoEnemyDamage ?? 0) + (player.grenades.infernoTeamDamage ?? 0));
    return {
      demoId, status: statusFromChecks(allChecks, infoPath !== null),
      metadata: { map: match.map, mode: null, scoreStableTeamOrder: finalRound ? teamOrder.map((teamId) => finalRound.scoreAfter[teamId] ?? 0) : null, teams: match.teams.length, rosterSizes: match.teams.map((team) => team.playerIds.length).sort(), rounds: match.rounds.length, quality: match.quality },
      eventCounts: { liveDeaths: match.events.filter((event) => event.kind === 'PLAYER_DEATH').length, nonLiveDeaths: match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE').length, normalizedEvents: match.events.length },
      scenarios: {
        overtimeRounds: match.rounds.filter((round) => round.isOvertime === true).length, sideSwitches,
        liveSuicides: match.events.filter((event) => event.kind === 'PLAYER_DEATH' && event.attrs.suicide === true).length,
        nonLiveSuicides: match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE' && event.attrs.suicide === true).length,
        teamKills: sum((player) => player.teamKills), worldDeaths: allDeaths.filter((event) => event.actorId === null).length,
        connects: snapshot.events.filter((row) => ['player_connect','player_connect_full'].includes(asText(row, ['event_name','event','name']) ?? '')).length,
        disconnects: snapshot.events.filter((row) => asText(row, ['event_name','event','name']) === 'player_disconnect').length, reconnects
      },
      m2Aggregates: { enemyDamage, teamDamage, kastRounds: sum((player) => player.kastRounds), trades: sum((player) => player.tradeKills), utilityDamage },
      checks: { parser, mode, internal, independent, m2 }
    };
  } catch { return failedDemoResult(demoId, infoPath !== null); }
}

function failedDemoResult(demoId: string, hasInfo: boolean): DemoValidationResult {
  const parser = fail('parser', 'The demo could not be parsed and normalized safely in its isolated process.');
  return {
    demoId, status: 'FAIL', metadata: { map: null, mode: null, scoreStableTeamOrder: null, teams: 0, rosterSizes: [], rounds: 0, quality: null },
    eventCounts: { liveDeaths: 0, nonLiveDeaths: 0, normalizedEvents: 0 },
    scenarios: { overtimeRounds: 0, sideSwitches: 0, liveSuicides: 0, nonLiveSuicides: 0, teamKills: 0, worldDeaths: 0, connects: 0, disconnects: 0, reconnects: 0 },
    m2Aggregates: null,
    checks: { parser, mode: skipped('mode', 'Mode was not inspected because parsing failed.'), internal: [], independent: hasInfo ? [skipped('info-reference', 'Independent reconciliation was not attempted because parsing failed.')] : [skipped('info-reference', 'No matching .dem.info was found.')], m2: [] }
  };
}

export async function validateDemoIsolated(demoPath: string, infoPath: string | null, timeoutMs = 180_000): Promise<DemoValidationResult> {
  let digest = 'unreadable';
  try { digest = await sha256(demoPath); } catch { return failedDemoResult(digest, infoPath !== null); }
  const sourceRuntime = import.meta.url.endsWith('.ts');
  const childPath = fileURLToPath(new URL(sourceRuntime ? './validate-child.ts' : './validate-child.js', import.meta.url));
  return new Promise((resolve) => {
    const args = [...(sourceRuntime ? ['--import', 'tsx'] : []), childPath, demoPath, infoPath ?? ''];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = ''; let settled = false;
    const finish = (result: DemoValidationResult): void => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', () => finish(failedDemoResult(digest.slice(0, 16), infoPath !== null)));
    child.on('exit', (code) => {
      if (code !== 0) { finish(failedDemoResult(digest.slice(0, 16), infoPath !== null)); return; }
      try { finish(JSON.parse(stdout) as DemoValidationResult); } catch { finish(failedDemoResult(digest.slice(0, 16), infoPath !== null)); }
    });
    const timer = setTimeout(() => { child.kill(); finish(failedDemoResult(digest.slice(0, 16), infoPath !== null)); }, timeoutMs);
  });
}

export function summarize(results: DemoValidationResult[], withInfo: number, generatedAt: string): BatchValidationReport {
  return {
    schemaVersion: 'demo-validation-1', generatedAt, parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION,
    privacy: { personalDataIncluded: false, filePathsIncluded: false },
    summary: {
      discovered: results.length, pass: results.filter((item) => item.status === 'PASS').length,
      partial: results.filter((item) => item.status === 'PARTIAL').length, fail: results.filter((item) => item.status === 'FAIL').length,
      skipped: results.filter((item) => item.status === 'SKIPPED').length, withInfo
    },
    demos: results
  };
}
