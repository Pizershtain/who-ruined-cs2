import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { computeMatchAnalytics } from '@who-ruined/features';
import { assertMatchRelations, normalizeSnapshot } from '@who-ruined/match-domain';
import { parseDemoSnapshot, toNormalizationInput } from '@who-ruined/parser-adapter';
import { SCORING_CONFIGS, scoreMatch } from '@who-ruined/scoring';
import { matchDataSchema, type MatchArtifact, type ScoringReport } from '@who-ruined/contracts';

export interface AnonymousScoreResult {
  demoId: string;
  map: string | null;
  score: number[] | null;
  rounds: number;
  players: number;
  quality: string;
  configs: Array<{
    version: string;
    configHash: string;
    model: string;
    status: string;
    mvp: string | null;
    whoRuined: string | null;
    v1ClearRuiner: string | null;
    margin: number | null;
    spread: number | null;
    noConfirmedHarm: boolean | null;
    close: boolean | null;
    tied: boolean | null;
    coverage: number;
    coverageReasons: string[];
    ranking: Array<{ player: string; team: string; positiveRate: number | null; performanceRate: number | null; teamReference: number | null; positiveShortfall: number | null; confirmedHarmRate: number | null; ruinRaw: number | null; relativeIndex: number | null; confirmedHarmFacts: { teamDamage: number | null; teamKills: number | null; teamBlindSeconds: number | null; liveSuicides: number | null } }>;
  }>;
  research: Array<{ player: string; round: number | null; startTick: number; endTick: number; classification: string; intervalSeconds: number; evidenceEventIds: string[]; alternatives: string[] }>;
  observations: Array<{ category: 'VERIFIED_FACT'|'RESEARCH_HYPOTHESIS'; kind: string; player: string; round: number | null; startTick: number; endTick: number; evidenceEventIds: string[]; observedFacts: string[]; context: unknown; whyInteresting: string; proposedMetric: string; alternatives: string[]; missingData: string[] }>;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function scoreSummary(report: ScoringReport, playerAlias: ReadonlyMap<string, string>, teamAlias: ReadonlyMap<string, string>) {
  const loserRows = report.players.filter((player) => player.teamId === report.losingTeamId);
  const raw = loserRows.map((player) => player.ruinRaw).filter((value): value is number => value !== null);
  return {
    version: report.scorerVersion,
    configHash: report.configHash,
    model: report.model,
    status: report.status,
    mvp: report.mvp ? playerAlias.get(report.mvp.playerId) ?? null : null,
    whoRuined: report.whoRuined ? playerAlias.get(report.whoRuined.playerId) ?? null : null,
    v1ClearRuiner: report.v1ClearRuinerPlayerId ? playerAlias.get(report.v1ClearRuinerPlayerId) ?? null : null,
    margin: report.whoRuined?.margin ?? null,
    spread: raw.length > 0 ? Math.max(...raw) - Math.min(...raw) : null,
    noConfirmedHarm: report.whoRuined?.noConfirmedHarm ?? null,
    close: report.whoRuined?.close ?? null,
    tied: report.whoRuined?.primaryScoreTied ?? null,
    coverage: report.coverage.score,
    coverageReasons: report.coverage.reasons,
    ranking: report.players.map((player) => ({ player: playerAlias.get(player.playerId)!, team: teamAlias.get(player.teamId)!, positiveRate: player.positiveRate, performanceRate: player.performanceRate, teamReference: player.teamReference, positiveShortfall: player.positiveShortfall, confirmedHarmRate: player.confirmedHarmRate, ruinRaw: player.ruinRaw, relativeIndex: player.relativeIndex, confirmedHarmFacts: { teamDamage: player.components.confirmedHarm.teamDamage, teamKills: player.components.confirmedHarm.teamKills, teamBlindSeconds: player.components.confirmedHarm.teamBlindSeconds, liveSuicides: player.components.confirmedHarm.liveSuicides } }))
  };
}

const demoPath = process.argv[2];
if (!demoPath) process.exit(2);
const digest = await sha256(demoPath);
const snapshot = parseDemoSnapshot(demoPath);
const match = matchDataSchema.parse(normalizeSnapshot(toNormalizationInput({ matchId: `scoring_${digest.slice(0, 16)}`, fileSha256: digest, normalizedAt: '2000-01-01T00:00:00.000Z', snapshot })));
assertMatchRelations(match);
const artifact: MatchArtifact = { schemaVersion: 'm2-artifact-1', match, analytics: computeMatchAnalytics(match, '2000-01-01T00:00:00.000Z') };
const playerAlias = new Map(match.players.map((player, index) => [player.id, `player_${String(index + 1).padStart(2, '0')}`]));
const teamAlias = new Map(match.teams.map((team, index) => [team.id, `team_${index + 1}`]));
const reports = SCORING_CONFIGS.map((config) => scoreMatch(artifact, config));
const successor = reports[1];
const finalRound = match.rounds.filter((round) => round.isValid).at(-1);
const firstReport = reports[0];
const result: AnonymousScoreResult = {
  demoId: digest.slice(0, 16), map: match.map,
  score: finalRound ? match.teams.map((team) => finalRound.scoreAfter[team.id] ?? 0) : null,
  rounds: match.rounds.length, players: match.players.length, quality: match.quality,
  configs: reports.map((report) => scoreSummary(report, playerAlias, teamAlias)),
  research: (firstReport ? reports.flatMap((report) => report.episodes).filter((episode, index, all) => episode.kind === 'RESEARCH' && all.findIndex((candidate) => candidate.id === episode.id) === index) : []).map((episode) => ({
    player: playerAlias.get(episode.playerId)!, round: match.rounds.find((round) => round.id === episode.roundId)?.ordinal ?? null,
    startTick: episode.startTick, endTick: episode.endTick, classification: episode.research!.classification,
    intervalSeconds: episode.research!.intervalSeconds, evidenceEventIds: episode.evidenceEventIds, alternatives: episode.research!.alternatives
  })),
  observations: (successor?.episodes ?? []).filter((episode) => episode.kind !== 'HIGHLIGHT' || episode.type === 'MULTIKILL_SEQUENCE').map((episode) => ({
    category: episode.kind === 'RESEARCH' ? 'RESEARCH_HYPOTHESIS' as const : 'VERIFIED_FACT' as const,
    kind: episode.type, player: playerAlias.get(episode.playerId)!, round: match.rounds.find((round) => round.id === episode.roundId)?.ordinal ?? null,
    startTick: episode.startTick, endTick: episode.endTick, evidenceEventIds: episode.evidenceEventIds, observedFacts: episode.observedFacts,
    context: episode.context,
    whyInteresting: episode.kind === 'RESEARCH' ? 'Кандидат на проверку контекста friendly fire; score не изменяет.' : episode.type === 'MULTIKILL_SEQUENCE' ? 'Серия подтверждённых убийств без отдельного бонуса за multikill.' : 'Подтверждённый эпизод вреда союзной команде.',
    proposedMetric: episode.kind === 'RESEARCH' ? 'Доля firearm-friendly-damage эпизодов с последующим enemy damage в заданном окне.' : episode.type === 'MULTIKILL_SEQUENCE' ? 'Доля раундов с 2+ enemy kills как отдельный descriptive fact.' : 'Частота и фактический HP вреда по live-раундам без вывода о намерении.',
    alternatives: episode.research?.alternatives ?? ['случайный ввод','динамический игровой контекст','неизвестная видимость и позиционирование'],
    missingData: ['line of sight','crosshair direction','voice/team intent','independent human label']
  }))
};
process.stdout.write(JSON.stringify(result));
