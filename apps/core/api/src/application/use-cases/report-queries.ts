import { Inject, Injectable } from '@nestjs/common';
import {
  type StoredParticipationRating,
  type MatchAnalytics,
  type MatchArtifact,
  type StoredParticipationExplanation,
  type StoredPlayerRadarReport,
  type PlayerRadarWithConfirmedEvidence,
  type ScoringReport,
} from '@who-ruined/contracts';
import { buildActiveParticipationRating, buildParticipationExplanation, buildPlayerRadar, scoringConfigHash } from '@who-ruined/scoring';
import { ApplicationError } from '../application-error.js';
import { resolveScoringConfig } from '../scoring-config.js';
import {
  ApiSettingsPort,
  ArtifactReaderPort,
  MatchQueryPort,
} from '../ports.js';
import { StoredMatchAccess } from '../stored-match-access.js';

@Injectable()
export class ReportQueries {
  constructor(
    @Inject(MatchQueryPort) private readonly repository: MatchQueryPort,
    @Inject(ArtifactReaderPort) private readonly artifacts: ArtifactReaderPort,
    @Inject(ApiSettingsPort) private readonly settings: ApiSettingsPort,
    @Inject(StoredMatchAccess) private readonly storedMatches: StoredMatchAccess,
  ) {}

  async analytics(id: string): Promise<MatchAnalytics> {
    const analytics = (await this.storedMatches.load(id)).analytics;
    if (!analytics) throw new ApplicationError('INCOMPLETE_MATCH', 'M2-аналитика для этого артефакта отсутствует; требуется повторный разбор.', 409);
    return analytics;
  }

  async playerAnalytics(id: string, playerId: string) {
    const analytics = await this.analytics(id);
    const player = analytics.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApplicationError('PLAYER_NOT_FOUND', 'Игрок не найден в матче.', 404);
    return { schemaVersion: analytics.schemaVersion, featureVersion: analytics.featureVersion, matchId: id, player };
  }

  async participationRating(id: string, policy?: string): Promise<StoredParticipationRating> {
    if (!this.settings.participationRatingEnabled()) {
      throw new ApplicationError('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', 'Экспериментальный participation rating отключён конфигурацией сервера.', 404);
    }
    if (policy !== undefined) {
      throw new ApplicationError('INVALID_POLICY_SELECTOR', 'Выбор rating policy через HTTP запрещён; policy задаётся только владельцем backend.', 422);
    }
    const databaseMatch = await this.storedMatches.requireRecord(id);
    if (databaseMatch.resultFilePath) {
      return (await this.artifacts.readCanonicalResult(databaseMatch, true)).activeRating;
    }
    const stored = await this.storedMatches.load(id);
    if (stored.match.matchId !== id) {
      throw new ApplicationError('PARTICIPATION_SIDECAR_STALE', 'Идентификатор матча в артефакте не совпадает с запросом.', 409);
    }
    if (!stored.analytics) throw new ApplicationError('INCOMPLETE_MATCH', 'Для participation rating нужен совместимый M2-артефакт.', 409);
    const artifact: MatchArtifact = {
      schemaVersion: 'm2-artifact-1',
      match: stored.match,
      analytics: stored.analytics,
    };
    const sidecar = await this.artifacts.readParticipationSidecar(artifact, databaseMatch.rawFilePath);
    return buildActiveParticipationRating(artifact, sidecar);
  }

  async participationExplanation(id: string): Promise<StoredParticipationExplanation> {
    if (!this.settings.participationRatingEnabled()) {
      throw new ApplicationError('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', 'Экспериментальное объяснение participation rating отключено конфигурацией сервера.', 404);
    }
    const databaseMatch = await this.storedMatches.requireRecord(id);
    if (!databaseMatch.resultFilePath) throw new ApplicationError('REPORT_NOT_READY', 'Канонический результат матча ещё не готов.', 409);
    const result = await this.artifacts.readCanonicalResult(databaseMatch, true);
    try {
      return buildParticipationExplanation(result);
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Канонический результат не позволяет достоверно построить объяснение рейтинга.', 409);
    }
  }

  async evp(id: string) {
    const databaseMatch = await this.storedMatches.requireRecord(id);
    if (
      databaseMatch.evpFilePath === null
      && databaseMatch.evpSchemaVersion === null
      && databaseMatch.evpSha256 === null
      && databaseMatch.evpPolicyId === null
      && databaseMatch.evpBindingDigest === null
    ) {
      throw new ApplicationError(
        'REPORT_NOT_READY',
        'EVP ещё не создан для этого матча; используйте owner backfill.',
        409,
        { resource: 'EVP', reason: 'NOT_CREATED' },
      );
    }
    const canonical = await this.artifacts.readCanonicalResult(databaseMatch, true);
    return this.artifacts.readEvpReport(databaseMatch, canonical);
  }

  async radar(id: string, includeConfirmed = false): Promise<StoredPlayerRadarReport | PlayerRadarWithConfirmedEvidence> {
    const databaseMatch = await this.storedMatches.requireRecord(id);
    if (!databaseMatch.resultFilePath) {
      throw new ApplicationError('REPORT_NOT_READY', 'Канонический результат матча ещё не готов.', 409);
    }
    const canonical = await this.artifacts.readCanonicalResult(databaseMatch);
    const evpPointer = [
      databaseMatch.evpFilePath,
      databaseMatch.evpSchemaVersion,
      databaseMatch.evpSha256,
      databaseMatch.evpPolicyId,
      databaseMatch.evpBindingDigest,
    ];
    const evp = evpPointer.every((value) => value === null)
      ? null
      : await this.artifacts.readEvpReport(databaseMatch, canonical);
    try {
      return includeConfirmed ? buildPlayerRadar(canonical, evp, true) : buildPlayerRadar(canonical, evp);
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Сохранённые данные не позволяют достоверно построить радар игрока.', 409, { resource: 'RADAR', reason: 'PROJECTION_FAILED' });
    }
  }

  async report(id: string, version?: string, configHash?: string): Promise<ScoringReport> {
    const match = await this.storedMatches.requireRecord(id);
    const config = resolveScoringConfig(version, configHash);
    const hash = scoringConfigHash(config);
    if (match.resultFilePath) {
      const result = await this.artifacts.readCanonicalResult(match);
      const report = result.productionReports.find((item) =>
        item.scorerVersion === config.version && item.configHash === hash
      );
      if (!report) throw new ApplicationError('REPORT_NOT_READY', 'Запрошенный production report отсутствует в каноническом результате.', 409);
      return report;
    }
    const stored = await this.repository.findScoringReport(id, config.version, hash);
    if (!stored) {
      throw new ApplicationError('INCOMPLETE_MATCH', 'Scoring-отчёт ещё не построен; запросите rescore для сохранённого M2-артефакта.', 409);
    }
    return this.artifacts.readScoringReport(stored.jsonFilePath);
  }

  async playerReport(id: string, playerId: string, version?: string, configHash?: string) {
    const report = await this.report(id, version, configHash);
    const player = report.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApplicationError('PLAYER_NOT_FOUND', 'Игрок не найден в scoring-отчёте.', 404);
    const episodeIds = new Set(player.episodeIds);
    return {
      schemaVersion: report.schemaVersion,
      matchId: id,
      scorerVersion: report.scorerVersion,
      configHash: report.configHash,
      model: report.model,
      experimental: report.experimental,
      player,
      episodes: report.episodes.filter((episode) => episodeIds.has(episode.id)),
      rounds: report.rounds.map((round) => ({
        roundId: round.roundId,
        ordinal: round.ordinal,
        player: round.players.find((item) => item.playerId === playerId)!,
      })),
      warnings: report.warnings,
      limitations: report.limitations,
    };
  }
}
