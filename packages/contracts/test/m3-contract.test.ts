import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playerScoringReportSchema, scoringReportSchema } from '../src/index.js';

describe('M3 frontend contract fixture', () => {
  it('is anonymous and conforms to the versioned scoring DTO', () => {
    const raw = readFileSync(new URL('../../../tests/fixtures/m3-scoring-report.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/7656119\d{10}/);
    expect(raw).not.toMatch(/[A-Z]:\\/i);
    const report = scoringReportSchema.parse(JSON.parse(raw) as unknown);
    expect(report.experimental).toBe(true);
    expect(report.episodes[0]?.evidenceEventIds).toEqual(['event_16', 'event_17']);
  });

  it('validates the documented per-player projection', () => {
    const report = scoringReportSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/m3-scoring-report.json', import.meta.url), 'utf8')) as unknown);
    const player = report.players[1]!;
    const episodeIds = new Set(player.episodeIds);
    const projected = playerScoringReportSchema.parse({
      schemaVersion: report.schemaVersion, matchId: report.matchId, scorerVersion: report.scorerVersion,
      configHash: report.configHash, model: report.model, experimental: report.experimental, player,
      episodes: report.episodes.filter((episode) => episodeIds.has(episode.id)),
      rounds: report.rounds.map((round) => ({ roundId: round.roundId, ordinal: round.ordinal, player: round.players.find((entry) => entry.playerId === player.playerId)! })),
      warnings: report.warnings, limitations: report.limitations
    });
    expect(projected.player.playerId).toBe(player.playerId);
  });
});
