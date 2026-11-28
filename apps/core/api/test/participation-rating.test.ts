import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NORMALIZER_VERSION } from '@who-ruined/parser-adapter';
import { historicalMatchResultSchema, h3ExplanationReportSchema, h3RadarReportSchema, h3RatingReportSchema, evpReportSchema, participationExplanationReportSchema, playerRadarAxisIds, playerRadarReportSchema, playerRadarWithConfirmedEvidenceSchema, type MatchAnalytics, type MatchArtifact, type MatchData, type ParticipationSidecar } from '@who-ruined/contracts';
import { buildH3MatchResult } from '@who-ruined/scoring/h3';
import { evpReportBinding } from '@who-ruined/artifacts';
import { computeMatchAnalytics } from '@who-ruined/features';
import {
  buildActiveParticipationRating,
  buildCanonicalMatchResult,
  buildEvpReport,
  buildImportantMoments,
  buildParticipationExplanation,
  buildPlayerRadar,
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
  H2_PARTICIPATION_RATING_POLICY,
  HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY,
  PARTICIPATION_SIDECAR_POLICY_IDENTITIES,
  rebuildCanonicalMatchResult
} from '@who-ruined/scoring';

const { findUnique, readFile, stat, access } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
}));
vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@who-ruined/database')>()),
  prisma: {
    match: { findUnique },
    report: { findUnique: vi.fn() },
    job: { create: vi.fn() },
    $disconnect: vi.fn(),
  },
}));
vi.mock('node:fs/promises', async (original) => ({ ...(await original<typeof import('node:fs/promises')>()), readFile, access, stat }));

const { createTestApiFacade } = await import('./test-api-facade.js');
const { AppModule } = await import('../src/app.module.js');
const { buildParticipationRatingReport } = await import('../src/participation-rating.js');
const { SafeExceptionFilter } = await import('../src/safe-exception.filter.js');

const previousParticipationFlag = process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
const previousPolicy = process.env.ACTIVE_RATING_POLICY;
const previousResultJsonDepth = process.env.MAX_RESULT_JSON_DEPTH;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fixture(absentPlayerIndex: number | null = null) {
  const a = Array.from({ length: 5 }, (_, index) => `player-a-${index + 1}`);
  const b = Array.from({ length: 5 }, (_, index) => `player-b-${index + 1}`);
  const teamA = 'team-a'; const teamB = 'team-b';
  const identities = [...a.map((id, index) => ({ id, steamId: null, displayName: `Synthetic A${index + 1}`, teamId: teamA })), ...b.map((id, index) => ({ id, steamId: null, displayName: `Synthetic B${index + 1}`, teamId: teamB }))];
  const match: MatchData = {
    schemaVersion: '1' as const, matchId: 'synthetic-participation-match', fileSha256: 'a'.repeat(64), map: 'de_synthetic', tickRate: 64,
    teams: [{ id: teamA, playerIds: a, label: 'A' }, { id: teamB, playerIds: b, label: 'B' }], players: identities,
    rounds: [{ id: 'round-1', ordinal: 1, startTick: 0, freezeEndTick: 10, endTick: 100, winnerTeamId: teamA, winnerSide: 'T' as const, sideByTeamId: { [teamA]: 'T' as const, [teamB]: 'CT' as const }, scoreBefore: { [teamA]: 0, [teamB]: 0 }, scoreAfter: { [teamA]: 13, [teamB]: 8 }, isValid: true, issues: [] }],
    events: [], quality: 'VALID' as const, qualityIssues: [], provenance: { parser: 'synthetic', parserVersion: '0.42.0', normalizedAt: '2026-10-24T00:00:00.000Z' }
  };
  const analyticsPlayers = identities.map((player) => ({
    playerId: player.id, teamId: player.teamId, roundsPlayed: 1, kills: 1, deaths: 1, assists: 1, kdaRatio: 2,
    enemyDamage: 100, teamDamage: 0, adr: 100, kastRounds: 1, kastPercent: 100, survivedRounds: 0,
    openingKills: 0, openingDeaths: 0, tradeKills: 0, deathsTraded: 0, untradedDeaths: 1, tradeParticipation: 0,
    multiKills: { two: 0, three: 0, four: 0, five: 0 }, clutches: {}, killsWithAdvantage: 0, killsAtDisadvantage: 0,
    teamKills: 0, suicides: 0, bomb: { plants: 0, defuses: 0, explosions: 0 },
    grenades: { flashesThrown: 0, enemiesFlashed: 0, teammatesFlashed: 0, enemyBlindSeconds: 0, teamBlindSeconds: 0, heThrown: 0, heEnemyDamage: 0, heTeamDamage: 0, infernosStarted: 0, infernoEnemyDamage: 0, infernoTeamDamage: 0, smokesThrown: 0, smokeEffectiveness: null },
    economy: { availability: 'AVAILABLE' as const, freezeEquipmentValueTotal: 0, freezeRoundsObserved: 1, money: null }, facts: []
  }));
  const analytics: MatchAnalytics = { schemaVersion: 'm2-1', featureVersion: 'm2-0.1.0', matchId: match.matchId, generatedAt: '2026-10-24T00:00:00.000Z', tradeWindowSeconds: 5, availability: { damage: 'AVAILABLE', flashes: 'AVAILABLE', economy: 'AVAILABLE', aliveContext: 'AVAILABLE' }, players: analyticsPlayers, limitations: [] };
  const artifact: MatchArtifact = { schemaVersion: 'm2-artifact-1', match, analytics };
  const profiles = identities.map((player, index) => {
    const profileKey = `${match.matchId}:P${String(index + 1).padStart(2, '0')}`;
    const absent = index === absentPlayerIndex;
    const harm = -0.01 * index;
    const families = { COMBAT: 0.04 + 0.002 * index, SUPPORT: 0.01, DEATH_RELATED: -0.03, DIRECT_HARM: harm, CONTEXT: 0, OBJECTIVES: 0 };
    const episodeContributions = harm < 0 ? [{ anchorId: 'round-1:harm', chosenAxis: 'allyHp', family: 'DIRECT_HARM' as const, base: harm, tags: [] }] : [];
    return {
      profileKey, playerId: player.id, teamId: player.teamId,
      status: absent ? 'PARTICIPATION_ABSENT_GT_2_ROUNDS' as const : 'ELIGIBLE' as const,
      reason: absent ? 'THREE_OR_MORE_VERIFIED_FULL_ROUND_ABSENCES' : null,
      verifiedRounds: absent ? 9 : 21, absentRounds: absent ? 12 : 0, partialRounds: 0, unknownRounds: 0, globalExcludedRounds: 0,
      tRounds: 10, ctRounds: 11, countedRoundIds: absent ? Array.from({ length: 9 }, (_, round) => `round-${round + 1}`) : ['round-1'], excludedRoundIds: absent ? Array.from({ length: 12 }, (_, round) => `absent-${round + 1}`) : [],
      prepared: { profileKey, playerId: player.id, teamId: player.teamId, scenario: 'BOMB' as const, rounds: absent ? 9 : 21, validRounds: 21, tRounds: 10, ctRounds: 11, requiredInputStatus: 'COMPLETE', p4BPlus: { status: 'CALCULATED_RESEARCH_ONLY' as const, reason: null, familyContributions: families, episodeContributions }, p4CPlus: { status: 'CALCULATED_RESEARCH_ONLY' as const, reason: null, familyContributions: families, objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 }, episodeContributions } }
    };
  });
  const stable = {
    binding: { matchId: match.matchId, fileSha256: match.fileSha256, parserVersion: match.provenance.parserVersion, normalizerVersion: NORMALIZER_VERSION },
    model: {
      preparedInputModel: C2S2_MODEL_VERSION,
      preparedInputDigest: C2S2_POLICY_DIGEST,
      referenceVersion: C2S2_REFERENCE_VERSION,
      policies: PARTICIPATION_SIDECAR_POLICY_IDENTITIES.map(({ id, digest, harmMultiplier }) => ({ id, digest, harmMultiplier }))
    },
    scenario: 'BOMB' as const, participation: [], profiles,
    provenance: { source: 'RAW_DEMO_EVENTS_AND_TICKS' as const, lifecycleEvents: [], contextTags: ['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'], s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles' }
  };
  const sidecar: ParticipationSidecar = { schemaVersion: 'm3c8-participation-prepared@1.0.0-experimental', createdAt: '2026-10-24T00:00:00.000Z', fingerprint: createHash('sha256').update(canonical(stable)).digest('hex'), ...stable };
  return { match, analytics, artifact, sidecar };
}

function makeRadarRoundScopeConsistent(data: ReturnType<typeof fixture>): void {
  for (const profile of data.sidecar.profiles) {
    profile.verifiedRounds = 1;
    profile.absentRounds = 0;
    profile.tRounds = 1;
    profile.ctRounds = 0;
    profile.countedRoundIds = ['round-1'];
    profile.excludedRoundIds = [];
    profile.prepared.rounds = 1;
    profile.prepared.validRounds = 1;
    profile.prepared.tRounds = 1;
    profile.prepared.ctRounds = 0;
  }
  for (const player of data.analytics.players) {
    player.kills = 0;
    player.deaths = 0;
    player.assists = 0;
    player.openingKills = 0;
    player.openingDeaths = 0;
    player.tradeKills = 0;
    player.multiKills = { two: 0, three: 0, four: 0, five: 0 };
    player.clutches = {};
    player.bomb.plants = 0;
    player.bomb.defuses = 0;
    player.grenades.enemiesFlashed = 0;
    player.grenades.enemyBlindSeconds = 0;
    player.grenades.heEnemyDamage = 0;
    player.grenades.infernoEnemyDamage = 0;
    player.facts = [];
  }
}

function legacyUnknownHostageFixture() {
  const data = fixture();
  data.match.map = 'cs_synthetic';
  const profiles = data.sidecar.profiles.map((profile) => ({
    ...profile,
    status: 'UNKNOWN_APPLICABILITY' as const,
    reason: 'SCENARIO_UNKNOWN',
    prepared: {
      ...profile.prepared,
      scenario: 'UNKNOWN' as const,
      p4CPlus: { status: 'UNKNOWN_APPLICABILITY' as const, reason: 'SCENARIO_UNKNOWN' }
    }
  }));
  return { ...data, sidecar: { ...data.sidecar, scenario: 'UNKNOWN' as const, profiles } };
}

function mockStored(data: ReturnType<typeof fixture>, sidecarOverride: unknown = data.sidecar, rawFilePath: string | null = 'uploads/synthetic.dem') {
  findUnique.mockResolvedValue({ id: data.match.matchId, normalizedFilePath: `cache/${data.match.matchId}.json.gz`, rawFilePath });
  readFile.mockImplementation(async (value) => gzipSync(Buffer.from(JSON.stringify(String(value).includes('c2s2-participation') ? sidecarOverride : data.artifact))));
  access.mockResolvedValue(undefined);
}

function mockCanonical(data: ReturnType<typeof fixture>, absentPlayerIndex: number | null = null) {
  const source = absentPlayerIndex === null ? data : fixture(absentPlayerIndex);
  const result = buildCanonicalMatchResult({ artifact: source.artifact, sidecar: source.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
  const compressed = gzipSync(Buffer.from(JSON.stringify(result)));
  const stored = {
    id: source.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
    resultFilePath: 'results/synthetic/result.json.gz', resultSha256: createHash('sha256').update(compressed).digest('hex'),
    resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
    resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest,
    evpFilePath: null, evpSchemaVersion: null, evpSha256: null, evpPolicyId: null, evpBindingDigest: null,
  };
  findUnique.mockResolvedValue(stored);
  readFile.mockResolvedValue(compressed);
  return { source, result, stored };
}

function mockEvp(data = fixture(), reportOverride?: Record<string, unknown>, useH3 = false) {
  const options = {
    artifact: data.artifact,
    sidecar: data.sidecar,
    productionReports: [],
    sourceDemoRetained: false,
    createdAt: '2026-10-26T00:00:00.000Z',
  };
  const result = useH3 ? buildH3MatchResult({ ...options, roundStarts: [], equipment: [] }) : buildCanonicalMatchResult(options);
  const binding = evpReportBinding(result);
  const report = { ...buildEvpReport(result, binding), ...reportOverride };
  const resultBytes = gzipSync(Buffer.from(JSON.stringify(result)));
  const evpBytes = gzipSync(Buffer.from(JSON.stringify(report)));
  const stored = {
    id: data.match.matchId,
    deletionState: null,
    normalizedFilePath: null,
    rawFilePath: null,
    resultFilePath: 'results/synthetic/result.json.gz',
    resultSha256: createHash('sha256').update(resultBytes).digest('hex'),
    resultPolicyId: result.internal.selectedPolicyId,
    resultPolicyDigest: result.internal.selectedPolicyDigest,
    evpFilePath: 'experimental/evp/synthetic/report.json.gz',
    evpSchemaVersion: 'evp-report@1',
    evpSha256: createHash('sha256').update(evpBytes).digest('hex'),
    evpPolicyId: 'evp-policy@1-experimental',
    evpBindingDigest: binding.inputDigest,
  };
  findUnique.mockResolvedValue(stored);
  readFile.mockImplementation(async (value) => (
    String(value).includes('experimental\\evp') || String(value).includes('experimental/evp')
      ? evpBytes
      : resultBytes
  ));
  return { result, report, resultBytes, evpBytes, stored };
}

function withHistoricalH1Identity(result: ReturnType<typeof buildCanonicalMatchResult>) {
  return historicalMatchResultSchema.parse({
    ...result,
    internal: {
      ...result.internal,
      selectedPolicyId: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.id,
      selectedPolicyDigest: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.digest,
      selectedPolicySelector: 'H1'
    }
  });
}

describe('P7.2-F participation rating API', () => {
  beforeEach(() => {
    process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1';
    process.env.ACTIVE_RATING_POLICY = 'H2';
    findUnique.mockReset(); readFile.mockReset(); access.mockReset(); stat.mockReset();
    stat.mockResolvedValue({ isFile: () => true, size: 1024 });
  });
  afterEach(() => {
    if (previousParticipationFlag === undefined) delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING; else process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = previousParticipationFlag;
    if (previousPolicy === undefined) delete process.env.ACTIVE_RATING_POLICY; else process.env.ACTIVE_RATING_POLICY = previousPolicy;
    if (previousResultJsonDepth === undefined) delete process.env.MAX_RESULT_JSON_DEPTH; else process.env.MAX_RESULT_JSON_DEPTH = previousResultJsonDepth;
  });

  it('maps the legacy envelope from the same active rating result', () => {
    const data = fixture();
    const active = buildActiveParticipationRating(data.artifact, data.sidecar);
    const legacy = buildParticipationRatingReport(data.artifact, data.sidecar);
    expect(legacy.players).toEqual(active.players);
    expect(legacy.ordering).toEqual(active.ordering);
    expect(legacy.losingTeamOrdering).toEqual(active.losingTeamOrdering);
    expect(legacy.awards).toEqual(active.awards);
  });

  it('performs no data access when explicitly disabled', async () => {
    process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '0';
    await expect(createTestApiFacade().participationRating('match')).rejects.toMatchObject({ code: 'EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows explicit disabling and requires a stored canonical result', async () => {
    process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '0';
    await expect(createTestApiFacade().participationExplanation('match')).rejects.toMatchObject({ code: 'EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
    process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '1';
    findUnique.mockResolvedValue({ id: 'match', deletionState: null, resultFilePath: null });
    await expect(createTestApiFacade().participationExplanation('match')).rejects.toMatchObject({ code: 'REPORT_NOT_READY', status: 409 });
  });

  it('always calculates H2 and ignores the retired environment selector', async () => {
    const data = fixture(); mockStored(data);
    const service = createTestApiFacade();
    const h2First = await service.participationRating(data.match.matchId);
    process.env.ACTIVE_RATING_POLICY = 'H1';
    const h2Second = await service.participationRating(data.match.matchId);
    expect(h2First.schemaVersion).toBe('m4.3-participation-rating@1');
    expect('policy' in h2First).toBe(false);
    expect('prepared' in h2First).toBe(false);
    for (let index = 0; index < 10; index += 1) {
      const first = h2First.players[index]!.rating;
      const second = h2Second.players[index]!.rating;
      expect(first).not.toBeNull();
      expect(second).toEqual(first);
      expect(first!.finalAttribution.DIRECT_HARM).toBe(2 * first!.rawFamilyInputs.DIRECT_HARM);
    }
  });

  it('returns a nine-player calculated pool and four-player losing award pool without fabricating the absent rating', async () => {
    const data = fixture(7); mockStored(data);
    const response = await createTestApiFacade().participationRating(data.match.matchId);
    expect(response.awards).toMatchObject({ eligiblePoolSize: 9, incompletePool: true, losingTeamId: 'team-b' });
    expect(response.awards.whoRuined.awardPoolSize).toBe(4);
    expect(response.players[7]).toMatchObject({ availability: { status: 'PARTICIPATION_ABSENT_GT_2_ROUNDS' }, rating: null, coverage: { absentFullRounds: 12 } });
  });

  it('rescues a stored UNKNOWN cs_ result as HOSTAGE while keeping OBJECTIVES at zero', () => {
    const data = legacyUnknownHostageFixture();
    const result = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    expect(result.activeRating.scenario).toBe('HOSTAGE');
    expect(result.activeRating.applicability).toEqual({ status: 'SUPPORTED', reason: null });
    expect(result.internal.recomputeSeed.scenario).toBe('HOSTAGE');
    expect(result.activeRating.players).toHaveLength(10);
    for (const player of result.activeRating.players) {
      expect(player.availability).toEqual({ status: 'CALCULATED_RESEARCH_ONLY', reason: null });
      expect(player.rating).not.toBeNull();
      expect(player.rating!.rawFamilyInputs.OBJECTIVES).toBe(0);
      expect(player.rating!.finalAttribution.OBJECTIVES).toBe(0);
    }
    const rebuilt = rebuildCanonicalMatchResult(result);
    expect(rebuilt.activeRating.players.every((player) => player.rating !== null)).toBe(true);
    const explanation = buildParticipationExplanation(rebuilt);
    for (const player of explanation.players) {
      const objectives = player.rating?.families.find((family) => family.family === 'OBJECTIVES');
      expect(objectives).toMatchObject({ rawInput: 0, finalAttribution: 0 });
    }
  });

  it('builds a synthetic six-family explanation that exactly reconstructs H2 without invented event attribution', () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const explanation = buildParticipationExplanation(canonicalResult);
    expect(participationExplanationReportSchema.parse(explanation)).toEqual(explanation);
    expect(explanation.schemaVersion).toBe('m4.6-participation-explanation@1');
    expect(JSON.stringify(explanation)).not.toContain('recomputeSeed');
    expect(JSON.stringify(explanation)).not.toContain(H2_PARTICIPATION_RATING_POLICY.digest);
    for (const player of explanation.players) {
      expect(player.rating).not.toBeNull();
      expect(player.rating!.families).toHaveLength(6);
      expect(Math.abs(player.rating!.value - player.rating!.arithmetic.reconstructed)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(1 + player.rating!.families.reduce((sum, family) => sum + family.finalAttribution, 0) - player.rating!.value)).toBeLessThanOrEqual(1e-12);
      const death = player.rating!.families.find((family) => family.family === 'DEATH_RELATED')!;
      expect(death.finalAttribution).toBeLessThan(0);
      expect(death.sources.every((source) => source.finalContribution === null)).toBe(true);
      expect(death.transformations).toContainEqual(expect.objectContaining({ code: 'NEGATIVE_MASS_SOFTENING', scope: 'CROSS_FAMILY' }));
    }
    const harmed = explanation.players[1]!.rating!.families.find((family) => family.family === 'DIRECT_HARM')!;
    expect(harmed.sources[0]).toMatchObject({ kind: 'AGGREGATE', roundIds: ['round-1'], evidenceEventIds: [] });
    expect(harmed.sources.flatMap((source) => source.evidenceEventIds)).not.toContain('round-1:harm');
    expect(harmed.transformations.map((row) => row.code)).toEqual(['DIRECT_HARM_SOFTENING','DIRECT_HARM_MULTIPLIER']);
  });

  it('preserves a synthetic null rating while still returning independently verified moments', () => {
    const data = fixture(7);
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const explanation = buildParticipationExplanation(canonicalResult);
    expect(explanation.players[7]).toMatchObject({ availability: { status: 'PARTICIPATION_ABSENT_GT_2_ROUNDS' }, rating: null, importantMoments: [] });
  });

  it('selects only synthetic verified multi-kills and trades, grouping and deduplicating them deterministically', () => {
    const data = fixture();
    const rounds = Array.from({ length: 7 }, (_, index) => ({ ...data.match.rounds[0]!, id: `round-${index + 1}`, ordinal: index + 1 }));
    data.match.rounds.splice(0, data.match.rounds.length, ...rounds);
    const death = (id: string, roundId: string, tick: number, actorId: string, targetId: string, rowIndex: number) => ({
      id, kind: 'PLAYER_DEATH', roundId, tick, actorId, targetId, assisterId: null,
      attrs: {}, context: { phase: 'LIVE' as const, actorTeamId: actorId.startsWith('player-a') ? 'team-a' : 'team-b', targetTeamId: targetId.startsWith('player-a') ? 'team-a' : 'team-b', actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null, actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex }
    });
    const a1 = 'player-a-1';
    const events = [
      death('r1-k1','round-1',10,a1,'player-b-1',1), death('r1-k2','round-1',20,a1,'player-b-2',2),
      death('r2-k1','round-2',110,a1,'player-b-1',3), death('r2-k2','round-2',120,a1,'player-b-2',4), death('r2-k3','round-2',130,a1,'player-b-3',5),
      ...Array.from({ length: 4 }, (_, index) => death(`r3-k${index + 1}`,'round-3',210 + index * 10,a1,`player-b-${index + 1}`,6 + index)),
      death('r4-original','round-4',300,'player-b-1','player-a-2',10),
      ...Array.from({ length: 5 }, (_, index) => death(`r4-k${index + 1}`,'round-4',332 + index * 10,a1,`player-b-${index + 1}`,11 + index)),
      death('r5-original','round-5',500,'player-b-1','player-a-2',20), death('r5-trade','round-5',532,a1,'player-b-1',21),
      death('r6-original','round-6',600,'player-b-1','player-a-2',22), death('r6-trade','round-6',728,a1,'player-b-1',23),
      death('r7-original','round-7',800,'player-b-1','player-a-2',24), death('r7-unverified','round-7',832,a1,'player-b-1',25),
      { ...death('damage-not-a-kill','round-7',840,a1,'player-b-2',26), kind: 'PLAYER_HURT' }
    ];
    data.match.events.splice(0, data.match.events.length, ...events);
    const aFacts = data.analytics.players.find((player) => player.playerId === a1)!.facts;
    for (const event of events.filter((item) => item.kind === 'PLAYER_DEATH' && item.actorId === a1)) aFacts.push({ category: 'POSITIVE_CONTRIBUTION', kind: 'KILL', roundId: event.roundId, eventId: event.id, value: 1 });
    for (const eventId of ['r4-k1','r5-trade','r6-trade']) {
      const event = events.find((item) => item.id === eventId)!;
      aFacts.push({ category: 'POSITIVE_CONTRIBUTION', kind: 'TRADE_KILL', roundId: event.roundId, eventId, value: 1 });
    }
    const moments = buildImportantMoments(data.artifact).byPlayer.get(a1)!;
    expect(moments.map((moment) => [moment.roundOrdinal, moment.type, moment.killCount])).toEqual([
      [4,'MULTI_KILL',5], [3,'MULTI_KILL',4], [2,'MULTI_KILL',3], [1,'MULTI_KILL',2], [5,'FAST_TRADE',1], [6,'TRADE',1]
    ]);
    expect(moments.filter((moment) => moment.roundOrdinal === 4)).toHaveLength(1);
    expect(moments.find((moment) => moment.roundOrdinal === 4)).toMatchObject({ tradeCount: 1, tradeDelaySeconds: null });
    expect(moments.some((moment) => moment.roundOrdinal === 7)).toBe(false);
    expect(moments.flatMap((moment) => moment.evidenceEventIds)).not.toContain('damage-not-a-kill');
  });

  it('reads the ready DTO from one canonical result and fails closed on owner-policy mismatch', async () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const compressed = gzipSync(Buffer.from(JSON.stringify(canonicalResult)));
    findUnique.mockResolvedValue({
      id: data.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
      resultFilePath: 'results/synthetic/result.json.gz', resultSha256: createHash('sha256').update(compressed).digest('hex'),
      resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest
    });
    readFile.mockResolvedValue(compressed);
    await expect(createTestApiFacade().participationRating(data.match.matchId)).resolves.toEqual(JSON.parse(JSON.stringify(canonicalResult.activeRating)));

    const historical = withHistoricalH1Identity(canonicalResult);
    const historicalBytes = gzipSync(Buffer.from(JSON.stringify(historical)));
    findUnique.mockResolvedValue({
      id: data.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
      resultFilePath: 'results/synthetic/result-h1.json.gz',
      resultSha256: createHash('sha256').update(historicalBytes).digest('hex'),
      resultPolicyId: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.id,
      resultPolicyDigest: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.digest
    });
    readFile.mockResolvedValue(historicalBytes);
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_POLICY_MISMATCH', status: 409 });
  });

  it('serves the explanation only from canonical match-result bytes and fails closed on corruption or policy mismatch', async () => {
    const data = fixture();
    const { result } = mockCanonical(data);
    const response = await createTestApiFacade().participationExplanation(data.match.matchId);
    expect(response).toEqual(JSON.parse(JSON.stringify(buildParticipationExplanation(result))));
    expect(response.provenance).toEqual({ source: 'match-result@1', originalDemoParsedAtRequest: false });

    const historical = withHistoricalH1Identity(result);
    const historicalBytes = gzipSync(Buffer.from(JSON.stringify(historical)));
    const row = await findUnique.mock.results[0]?.value;
    findUnique.mockResolvedValue({
      ...row,
      resultFilePath: 'results/synthetic/result-h1.json.gz',
      resultSha256: createHash('sha256').update(historicalBytes).digest('hex'),
      resultPolicyId: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.id,
      resultPolicyDigest: HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.digest
    });
    readFile.mockResolvedValue(historicalBytes);
    await expect(createTestApiFacade().participationExplanation(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_POLICY_MISMATCH', status: 409 });

    findUnique.mockResolvedValue({ ...row, resultSha256: '0'.repeat(64) });
    await expect(createTestApiFacade().participationExplanation(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });

  it('rebuilds a historical H1-identified result to the exact pre-removal H2 result', () => {
    const data = fixture();
    const before = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const historical = withHistoricalH1Identity(before);
    const after = rebuildCanonicalMatchResult(historical);
    expect(historical.internal.selectedPolicyId).toBe(HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.id);
    expect(after.internal).toMatchObject({
      selectedPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      selectedPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest,
      selectedPolicySelector: 'H2'
    });
    expect(after.activeRating).toEqual(before.activeRating);
    expect(after.internal.recomputeSeed).toEqual(before.internal.recomputeSeed);
    expect(() => buildParticipationExplanation(historical)).toThrow('PARTICIPATION_EXPLANATION_REQUIRES_H2_RESULT');
  });

  it('fails closed when the canonical result bytes do not match the database checksum', async () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const compressed = gzipSync(Buffer.from(JSON.stringify(canonicalResult)));
    findUnique.mockResolvedValue({
      id: data.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
      resultFilePath: 'results/synthetic/result.json.gz', resultSha256: '0'.repeat(64),
      resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest
    });
    readFile.mockResolvedValue(compressed);
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });

  it('fails closed when API depth limits are lower than the worker artifact requires', async () => {
    const data = fixture();
    mockCanonical(data);
    process.env.MAX_RESULT_JSON_DEPTH = '1';

    await expect(createTestApiFacade().participationRating(data.match.matchId))
      .rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });

  it('maps shape-valid canonical Match relationship corruption to REPORT_CORRUPT', async () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    canonicalResult.artifact.match.players[0]!.teamId = 'unknown-team';
    const compressed = gzipSync(Buffer.from(JSON.stringify(canonicalResult)));
    findUnique.mockResolvedValue({
      id: data.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
      resultFilePath: 'results/synthetic/corrupt-relations.json.gz',
      resultSha256: createHash('sha256').update(compressed).digest('hex'),
      resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest
    });
    readFile.mockResolvedValue(compressed);

    await expect(createTestApiFacade().participationRating(data.match.matchId))
      .rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });

  it('fails closed when a valid canonical file is pointed at by another match row', async () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const compressed = gzipSync(Buffer.from(JSON.stringify(canonicalResult)));
    findUnique.mockResolvedValue({
      id: 'another-match', deletionState: null, normalizedFilePath: null, rawFilePath: null,
      resultFilePath: 'results/synthetic/result.json.gz', resultSha256: createHash('sha256').update(compressed).digest('hex'),
      resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest
    });
    readFile.mockResolvedValue(compressed);
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });

  it('rejects every HTTP policy selector before reading match data', async () => {
    await expect(createTestApiFacade().participationRating('match', 'H3')).rejects.toMatchObject({ code: 'INVALID_POLICY_SELECTOR', status: 422 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns the existing typed 404 when the canonical match record does not exist', async () => {
    findUnique.mockResolvedValue(null);
    await expect(createTestApiFacade().participationRating('missing-match')).rejects.toMatchObject({ code: 'MATCH_NOT_FOUND', status: 404 });
  });

  it('fails closed on schema, fingerprint, source-binding and frozen-policy mismatches', async () => {
    const data = fixture();
    for (const [sidecar, code] of [
      [{ ...data.sidecar, schemaVersion: 'old-schema' }, 'PARTICIPATION_SIDECAR_SCHEMA_MISMATCH'],
      [{ ...data.sidecar, fingerprint: 'f'.repeat(64) }, 'PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH'],
      [{ ...data.sidecar, binding: { ...data.sidecar.binding, fileSha256: 'b'.repeat(64) } }, 'PARTICIPATION_SIDECAR_STALE'],
      [{ ...data.sidecar, model: { ...data.sidecar.model, preparedInputDigest: 'b'.repeat(64) } }, 'PARTICIPATION_SIDECAR_POLICY_MISMATCH']
    ] as const) {
      mockStored(data, sidecar);
      await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code, status: 409 });
    }
  });

  it('distinguishes controlled backfill from an unavailable original demo', async () => {
    const data = fixture();
    findUnique.mockResolvedValue({ id: data.match.matchId, normalizedFilePath: `cache/${data.match.matchId}.json.gz`, rawFilePath: 'uploads/synthetic.dem' });
    readFile.mockImplementationOnce(async () => gzipSync(Buffer.from(JSON.stringify(data.artifact)))).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    access.mockResolvedValue(undefined);
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'PARTICIPATION_SIDECAR_BACKFILL_REQUIRED', status: 409 });
    findUnique.mockResolvedValue({ id: data.match.matchId, normalizedFilePath: `cache/${data.match.matchId}.json.gz`, rawFilePath: null });
    readFile.mockImplementationOnce(async () => gzipSync(Buffer.from(JSON.stringify(data.artifact)))).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', status: 409 });
  });

  it('rejects corrupt gzip without returning a fabricated HTTP 200 result', async () => {
    const data = fixture();
    findUnique.mockResolvedValue({ id: data.match.matchId, normalizedFilePath: `cache/${data.match.matchId}.json.gz`, rawFilePath: 'uploads/synthetic.dem' });
    readFile.mockImplementationOnce(async () => gzipSync(Buffer.from(JSON.stringify(data.artifact)))).mockResolvedValueOnce(Buffer.from('not-gzip'));
    await expect(createTestApiFacade().participationRating(data.match.matchId)).rejects.toMatchObject({ code: 'PARTICIPATION_SIDECAR_INVALID', status: 409 });
  });

  it('uses all ten calculated players for Who Ruined on a genuine draw', async () => {
    const data = fixture();
    data.match.rounds[0]!.scoreAfter['team-a'] = 12; data.match.rounds[0]!.scoreAfter['team-b'] = 12;
    mockStored(data);
    const response = await createTestApiFacade().participationRating(data.match.matchId);
    expect(response.awards).toMatchObject({ outcome: 'DRAW', losingTeamId: null });
    expect(response.awards.whoRuined).toMatchObject({ scope: 'DRAW_ALL_ELIGIBLE', awardPoolSize: 10 });
  });

  it('reads a valid stored EVP report and preserves a valid zero-award result', async () => {
    const { report } = mockEvp();

    await expect(createTestApiFacade().evp('synthetic-participation-match'))
      .resolves.toEqual(JSON.parse(JSON.stringify(report)));
    expect(report.awards).toEqual([]);
    expect(report.mvpPlayerId).not.toBeNull();
  });

  it('distinguishes a historical result without EVP from missing and corrupt EVP artifacts', async () => {
    const mocked = mockEvp();
    findUnique.mockResolvedValue({
      ...mocked.stored,
      evpFilePath: null,
      evpSchemaVersion: null,
      evpSha256: null,
      evpPolicyId: null,
      evpBindingDigest: null,
    });
    await expect(createTestApiFacade().evp(mocked.result.artifact.match.matchId))
      .rejects.toMatchObject({
        code: 'REPORT_NOT_READY', status: 409, details: { resource: 'EVP', reason: 'NOT_CREATED' },
      });

    mockEvp();
    readFile.mockImplementation(async (value) => {
      if (String(value).includes('experimental\\evp') || String(value).includes('experimental/evp')) {
        throw Object.assign(new Error('synthetic missing file'), { code: 'ENOENT' });
      }
      return mocked.resultBytes;
    });
    await expect(createTestApiFacade().evp(mocked.result.artifact.match.matchId))
      .rejects.toMatchObject({
        code: 'REPORT_CORRUPT', status: 409, details: { resource: 'EVP', reason: 'MISSING' },
      });

    const invalidBytes = Buffer.from('not gzip');
    findUnique.mockResolvedValue({
      ...mocked.stored,
      evpSha256: createHash('sha256').update(invalidBytes).digest('hex'),
    });
    readFile.mockImplementation(async (value) => (
      String(value).includes('experimental\\evp') || String(value).includes('experimental/evp')
        ? invalidBytes
        : mocked.resultBytes
    ));
    await expect(createTestApiFacade().evp(mocked.result.artifact.match.matchId))
      .rejects.toMatchObject({
        code: 'REPORT_CORRUPT', status: 409, details: { resource: 'EVP', reason: 'CORRUPT' },
      });
  });

  it('rejects stale match binding and a wrong EVP policy without leaking paths', async () => {
    const stale = mockEvp(fixture(), { matchId: 'another-match' });
    await expect(createTestApiFacade().evp(stale.result.artifact.match.matchId))
      .rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });

    const wrongPolicy = mockEvp();
    findUnique.mockResolvedValue({ ...wrongPolicy.stored, evpPolicyId: 'other-policy' });
    await expect(createTestApiFacade().evp(wrongPolicy.result.artifact.match.matchId))
      .rejects.toMatchObject({
        code: 'REPORT_POLICY_MISMATCH', status: 409,
        details: { resource: 'EVP', reason: 'POLICY_MISMATCH' },
      });
  });

  it('serves EVP through the read-only Nest route and documents its OpenAPI schema', async () => {
    const mocked = mockEvp();
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
    try {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/matches/${mocked.result.artifact.match.matchId}/evp`)
        .expect(200);
      expect(response.body.schemaVersion).toBe('evp-report@1');
      expect(response.body.awards).toEqual([]);
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('test').build(),
      );
      expect(document.paths['/api/v1/matches/{id}/evp']?.get?.responses?.['200']).toBeDefined();
      findUnique.mockResolvedValue({ ...mocked.stored, evpPolicyId: 'other-policy' });
      const incompatible = await request(app.getHttpServer())
        .get(`/api/v1/matches/${mocked.result.artifact.match.matchId}/evp`)
        .expect(409);
      expect(incompatible.body.error).toMatchObject({
        code: 'REPORT_POLICY_MISMATCH',
        details: { resource: 'EVP', reason: 'POLICY_MISMATCH' },
      });
      expect(JSON.stringify(incompatible.body)).not.toContain('experimental/evp');
      expect(JSON.stringify(incompatible.body)).not.toContain('report.json.gz');
    } finally {
      await app.close();
    }
  });

  it('serves the new contract through the actual Nest HTTP route and safe error envelope', async () => {
    const data = fixture(); mockStored(data);
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
    try {
      const rejected = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-rating?policy=H1`).expect(422);
      expect(rejected.body.error.code).toBe('INVALID_POLICY_SELECTOR');
      const ok = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-rating`).expect(200);
      expect(ok.body.schemaVersion).toBe('m4.3-participation-rating@1');
      expect(ok.body.policy).toBeUndefined();
      process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '0';
      const disabled = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-rating`).expect(404);
      expect(disabled.body.error.code).toBe('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED');
      expect(JSON.stringify(disabled.body)).not.toContain('Who Ruined CS2');
    } finally { await app.close(); }
  });

  it('serves the M4.6 explanation through the actual read-only Nest route', async () => {
    const data = fixture(); mockCanonical(data);
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
    try {
      const ok = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-explanation`).expect(200);
      expect(ok.body.schemaVersion).toBe('m4.6-participation-explanation@1');
      expect(ok.body.players).toHaveLength(10);
      expect(ok.body.recomputeSeed).toBeUndefined();
      await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-explanation?policy=H1`).expect(422);
      process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING = '0';
      const disabled = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-explanation`).expect(404);
      expect(disabled.body.error.code).toBe('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED');
    } finally { await app.close(); }
  });

  it('serves bound synthetic H3 rating, explanation, Radar and EVP without requesting the demo', async () => {
    delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
    const data = fixture();
    mockEvp(data, undefined, true);
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
    try {
      const base = `/api/v1/matches/${data.match.matchId}`;
      const raw = await Promise.all([
        request(app.getHttpServer()).get(base + '/experimental-participation-rating').expect(200),
        request(app.getHttpServer()).get(base + '/experimental-participation-explanation').expect(200),
        request(app.getHttpServer()).get(base + '/radar').expect(200),
        request(app.getHttpServer()).get(base + '/evp').expect(200),
      ]);
      const rating = h3RatingReportSchema.parse(raw[0]!.body);
      const explanation = h3ExplanationReportSchema.parse(raw[1]!.body);
      const radar = h3RadarReportSchema.parse(raw[2]!.body);
      const evp = evpReportSchema.parse(raw[3]!.body);
      expect(explanation.policy).toEqual(rating.policy);
      expect(radar.sourceBinding.ratingPolicy).toEqual(rating.policy);
      expect(radar.sourceBinding.evpInputDigest).toBe(evp.binding.inputDigest);
      expect(evp.mvpPlayerId).toBe(rating.awards.mvp.playerId);
      expect(evp.awards.every((award) => award.playerId !== evp.mvpPlayerId)).toBe(true);
      expect(radar.players.find((player) => player.awardState === 'MVP')?.playerId).toBe(evp.mvpPlayerId);
      const enrichedResponse = await request(app.getHttpServer()).get(base + '/radar?include=confirmed').expect(200);
      const { confirmedEvidence, ...regular } = playerRadarWithConfirmedEvidenceSchema.parse(enrichedResponse.body);
      expect(regular).toEqual(radar);
      expect(confirmedEvidence.schemaVersion).toBe('radar-confirmed-evidence@1');
      await request(app.getHttpServer()).get(base + '/radar?include=unknown').expect(422);
      const first = explanation.players[0]!.rating!;
      expect(first.families).toHaveLength(7);
      expect(first.families.find((family) => family.family === 'ROUND_IMPACT')).toMatchObject({
        rawInput: null, finalAttribution: null, coverage: { availability: 'UNAVAILABLE' },
      });
      expect(JSON.stringify(raw.map((response) => response.body))).not.toContain('recomputeSeed');
      expect(readFile.mock.calls.some(([path]) => String(path).endsWith('.dem'))).toBe(false);
    } finally { await app.close(); }
  });

  it('projects the stable eight-axis radar with exact M2 values, fixed geometry and partial comparison pools', () => {
    const data = fixture();
    makeRadarRoundScopeConsistent(data);
    const first = data.analytics.players[0]!;
    const opponents = data.match.players.filter((player) => player.teamId !== first.teamId);
    const teammate = data.match.players.find((player) => player.teamId === first.teamId && player.id !== first.playerId)!;
    const death = (id: string, tick: number, actorId: string, targetId: string, assisterId: string | null, rowIndex: number) => ({
      id, kind: 'PLAYER_DEATH', roundId: 'round-1', tick, actorId, targetId, assisterId, attrs: { assistedFlash: false },
      context: { phase: 'LIVE' as const, actorTeamId: first.teamId, targetTeamId: opponents[0]!.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex },
    });
    const events = [
      death('radar-kill-1', 20, first.playerId, opponents[0]!.id, null, 0),
      death('radar-kill-2', 30, first.playerId, opponents[1]!.id, null, 1),
      death('radar-assist', 40, teammate.id, opponents[2]!.id, first.playerId, 2),
      { id: 'radar-blind', kind: 'PLAYER_BLIND', roundId: 'round-1', tick: 10, actorId: first.playerId, targetId: opponents[0]!.id, assisterId: null, attrs: { blindDuration: 2 }, context: { phase: 'LIVE' as const, actorTeamId: first.teamId, targetTeamId: opponents[0]!.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 0, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'player_blind', rowIndex: 3 } },
      { id: 'radar-hurt', kind: 'PLAYER_HURT', roundId: 'round-1', tick: 15, actorId: first.playerId, targetId: opponents[0]!.id, assisterId: null, attrs: { rawHealthDamage: 25, healthAfter: 75, weapon: 'hegrenade' }, context: { phase: 'LIVE' as const, actorTeamId: first.teamId, targetTeamId: opponents[0]!.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 0, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'player_hurt', rowIndex: 4 } },
      { id: 'radar-plant', kind: 'BOMB_PLANTED', roundId: 'round-1', tick: 50, actorId: first.playerId, targetId: null, assisterId: null, attrs: {}, context: { phase: 'LIVE' as const, actorTeamId: first.teamId, targetTeamId: null, actorSide: 'T' as const, targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'PLANTED' as const, actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'bomb_planted', rowIndex: 5 } },
      { id: 'radar-defuse', kind: 'BOMB_DEFUSED', roundId: 'round-1', tick: 60, actorId: first.playerId, targetId: null, assisterId: null, attrs: {}, context: { phase: 'LIVE' as const, actorTeamId: first.teamId, targetTeamId: null, actorSide: 'T' as const, targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'DEFUSED' as const, actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'bomb_defused', rowIndex: 6 } },
    ];
    data.match.events.push(...events);
    first.kills = 2;
    first.multiKills = { two: 1, three: 0, four: 0, five: 0 };
    first.assists = 1;
    first.grenades.enemiesFlashed = 1;
    first.grenades.enemyBlindSeconds = 2;
    first.tradeKills = 1;
    first.openingKills = 1;
    first.grenades.heEnemyDamage = 25;
    first.bomb.plants = 1;
    first.bomb.defuses = 1;
    first.facts.push(
      { category: 'POSITIVE_CONTRIBUTION', kind: 'KILL', roundId: 'round-1', eventId: 'radar-kill-1', value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'KILL', roundId: 'round-1', eventId: 'radar-kill-2', value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'TRADE_KILL', roundId: 'round-1', eventId: 'radar-kill-2', value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'ASSIST', roundId: 'round-1', eventId: 'radar-assist', value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'BOMB_PLANT', roundId: 'round-1', eventId: 'radar-plant', value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'BOMB_DEFUSE', roundId: 'round-1', eventId: 'radar-defuse', value: null },
    );
    data.analytics.players[1]!.assists = null;
    data.analytics.availability.damage = 'PARTIAL';
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });

    const radar = buildPlayerRadar(canonicalResult, null);
    expect(playerRadarReportSchema.parse(radar)).toEqual(radar);
    expect(radar.axisDefinitions.map((row) => row.axisId)).toEqual(playerRadarAxisIds);
    expect(radar.players[0]!.axes.map((row) => row.axisId)).toEqual(playerRadarAxisIds);
    const axes = new Map(radar.players.find((row) => row.playerId === first.playerId)!.axes.map((row) => [row.axisId, row]));
    expect(axes.get('MULTIKILL')!.rawValue).toBe(10);
    expect(axes.get('ASSISTS')!.rawValue).toBe(10);
    expect(axes.get('FLASH')!.rawValue).toBe(2);
    expect(axes.get('UTILITY')!.rawValue).toBe(25);
    expect(axes.get('UTILITY')!.scaleExceeded).toBe(true);
    expect(axes.get('UTILITY')!.geometryValue).toBe(1);
    expect(axes.get('OBJECTIVES')!.rawValue).toBe(20);
    expect(axes.get('FLASH')!.geometryValue).toBe(0.5);
    expect(radar.matchComparisons.find((row) => row.axisId === 'ASSISTS')).toMatchObject({ comparisonPoolSize: 9, incompleteCoverage: true });
    expect(radar.matchComparisons.find((row) => row.axisId === 'MULTIKILL')!.average).toBe(1);
    expect(radar.matchComparisons.find((row) => row.axisId === 'UTILITY')!.incompleteCoverage).toBe(true);
    expect(radar.players[0]!.h2Explanation.families).toHaveLength(6);
    expect(radar.players[0]!.h2Explanation.families.some((family) => family.finalAttribution < 0)).toBe(true);
    expect(radar.players[0]!.h2Explanation.families.some((family) => family.sources.some((source) => source.kind === 'BASELINE'))).toBe(true);
    expect(radar.players.find((player) => player.awardState === 'MVP')!.axes.every((axis) => axis.mvpAttribution === null)).toBe(true);
    expect(JSON.stringify(radar)).not.toMatch(/NaN|Infinity/);

    const reordered = structuredClone(canonicalResult);
    reordered.artifact.match.players.reverse();
    reordered.artifact.analytics.players.reverse();
    expect(buildPlayerRadar(reordered, null)).toEqual(radar);
  });

  it('uses the same verified round set for every radar numerator and denominator', () => {
    const data = fixture();
    const teamA = data.match.teams[0]!;
    const teamB = data.match.teams[1]!;
    const actor = data.match.players.find((player) => player.id === teamA.playerIds[0])!;
    const assister = actor;
    const roundTemplate = data.match.rounds[0]!;
    data.match.rounds = [
      { ...roundTemplate, id: 'round-1', ordinal: 1, startTick: 0, freezeEndTick: 10, endTick: 1000 },
      { ...roundTemplate, id: 'round-2', ordinal: 2, startTick: 1001, freezeEndTick: 1010, endTick: 2000 },
    ];
    const roundEvents = (roundId: string, offset: number) => {
      const rows: typeof data.match.events = [];
      const death = (id: string, tick: number, killer: string, victim: string, assist: string | null) => rows.push({
        id: `${roundId}-${id}`, kind: 'PLAYER_DEATH', roundId, tick: offset + tick, actorId: killer, targetId: victim, assisterId: assist,
        attrs: { assistedFlash: false }, context: { phase: 'LIVE', actorTeamId: data.match.players.find((player) => player.id === killer)!.teamId, targetTeamId: data.match.players.find((player) => player.id === victim)!.teamId, actorSide: 'T', targetSide: 'CT', aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED', actorEquipmentValue: null, actorMoney: null },
        source: { eventName: 'player_death', rowIndex: rows.length },
      });
      death('opening', 20, actor.id, teamB.playerIds[0]!, null);
      death('ally-death', 30, teamB.playerIds[1]!, teamA.playerIds[1]!, null);
      death('trade', 31, actor.id, teamB.playerIds[1]!, null);
      death('assisted', 40, teamA.playerIds[2]!, teamB.playerIds[2]!, assister.id);
      death('ally-3-death', 50, teamB.playerIds[3]!, teamA.playerIds[2]!, null);
      death('ally-4-death', 60, teamB.playerIds[4]!, teamA.playerIds[3]!, null);
      death('ally-5-death', 70, teamB.playerIds[3]!, teamA.playerIds[4]!, null);
      death('clutch-1', 80, actor.id, teamB.playerIds[3]!, null);
      death('clutch-2', 90, actor.id, teamB.playerIds[4]!, null);
      rows.push(
        { id: `${roundId}-blind`, kind: 'PLAYER_BLIND', roundId, tick: offset + 15, actorId: actor.id, targetId: teamB.playerIds[0]!, assisterId: null, attrs: { blindDuration: 2 }, context: { phase: 'LIVE', actorTeamId: teamA.id, targetTeamId: teamB.id, actorSide: 'T', targetSide: 'CT', aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED', actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'player_blind', rowIndex: rows.length } },
        { id: `${roundId}-hurt`, kind: 'PLAYER_HURT', roundId, tick: offset + 16, actorId: actor.id, targetId: teamB.playerIds[0]!, assisterId: null, attrs: { rawHealthDamage: 25, healthAfter: 75, weapon: 'hegrenade' }, context: { phase: 'LIVE', actorTeamId: teamA.id, targetTeamId: teamB.id, actorSide: 'T', targetSide: 'CT', aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED', actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'player_hurt', rowIndex: rows.length } },
        { id: `${roundId}-plant`, kind: 'BOMB_PLANTED', roundId, tick: offset + 100, actorId: actor.id, targetId: null, assisterId: null, attrs: {}, context: { phase: 'LIVE', actorTeamId: teamA.id, targetTeamId: null, actorSide: 'T', targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'PLANTED', actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'bomb_planted', rowIndex: rows.length } },
        { id: `${roundId}-defuse`, kind: 'BOMB_DEFUSED', roundId, tick: offset + 110, actorId: actor.id, targetId: null, assisterId: null, attrs: {}, context: { phase: 'LIVE', actorTeamId: teamA.id, targetTeamId: null, actorSide: 'T', targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'DEFUSED', actorEquipmentValue: null, actorMoney: null }, source: { eventName: 'bomb_defused', rowIndex: rows.length } },
      );
      return rows;
    };
    data.match.events = [...roundEvents('round-1', 0), ...roundEvents('round-2', 1000)];
    data.analytics = computeMatchAnalytics(data.match, '2026-10-24T00:00:00.000Z');
    data.artifact.analytics = data.analytics;
    data.sidecar.profiles.forEach((profile, index) => {
      profile.verifiedRounds = index === 1 ? 2 : 1;
      profile.absentRounds = index === 1 ? 0 : 1;
      profile.countedRoundIds = index === 1 ? ['round-1', 'round-2'] : ['round-1'];
      profile.excludedRoundIds = index === 1 ? [] : ['round-2'];
      profile.prepared.rounds = profile.verifiedRounds;
      profile.prepared.validRounds = 2;
    });
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const radar = buildPlayerRadar(canonicalResult, null);
    const axes = new Map(radar.players.find((player) => player.playerId === actor.id)!.axes.map((axis) => [axis.axisId, axis]));
    expect(Object.fromEntries(playerRadarAxisIds.map((axisId) => [axisId, axes.get(axisId)!.rawValue]))).toEqual({
      MULTIKILL: 10,
      ASSISTS: 10,
      FLASH: 2,
      TRADES: 30,
      CLUTCH: 10,
      ENTRY: 10,
      UTILITY: 25,
      OBJECTIVES: 20,
    });
    expect(axes.get('MULTIKILL')!.evidenceRoundIds).toEqual(['round-1']);
    expect(radar.players.find((player) => player.playerId === teamA.playerIds[1])!.axes[0]!.verifiedRounds).toBe(2);

    const incomplete = structuredClone(canonicalResult);
    incomplete.internal.recomputeSeed.profiles.find((profile) => profile.playerId === teamB.playerIds[4])!.countedRoundIds = [];
    const withoutUncertainPlayer = buildPlayerRadar(incomplete, null);
    expect(withoutUncertainPlayer.players.find((player) => player.playerId === teamB.playerIds[4])!.axes.every((axis) => axis.reasonIfUnavailable === 'VERIFIED_ROUND_IDS_UNAVAILABLE')).toBe(true);
    const comparison = withoutUncertainPlayer.matchComparisons.find((row) => row.axisId === 'MULTIKILL')!;
    const comparable = withoutUncertainPlayer.players.flatMap((player) => {
      const axis = player.axes.find((row) => row.axisId === 'MULTIKILL')!;
      return axis.rawValue === null ? [] : [axis.rawValue];
    });
    expect(comparison.comparisonPoolSize).toBe(comparable.length);
    expect(comparison.average).toBe(comparable.reduce((sum, value) => sum + value, 0) / comparable.length);
  });

  it('keeps FLASH unavailable for an incomplete enemy duration without hiding confirmed zero or other players', () => {
    const data = fixture();
    makeRadarRoundScopeConsistent(data);
    const teamA = data.match.teams[0]!;
    const teamB = data.match.teams[1]!;
    const blind = (id: string, rowIndex: number, actorId: string, targetId: string, blindDuration: number | null) => {
      const actor = data.match.players.find((player) => player.id === actorId)!;
      const target = data.match.players.find((player) => player.id === targetId)!;
      return {
        id, kind: 'PLAYER_BLIND' as const, roundId: 'round-1', tick: 20 + rowIndex,
        actorId, targetId, assisterId: null, attrs: { blindDuration },
        context: { phase: 'LIVE' as const, actorTeamId: actor.teamId, targetTeamId: target.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
        source: { eventName: 'player_blind', rowIndex },
      };
    };
    const completeId = 'flash-complete';
    const friendlyId = 'flash-friendly';
    const incompleteId = 'flash-duration-missing';
    const otherCompleteId = 'flash-other-complete';
    const verifiedPartId = 'flash-verified-part';
    data.match.events = [
      blind(completeId, 0, teamA.playerIds[0]!, teamB.playerIds[0]!, 2),
      blind(friendlyId, 1, teamA.playerIds[1]!, teamA.playerIds[4]!, 3),
      blind(incompleteId, 2, teamA.playerIds[2]!, teamB.playerIds[1]!, null),
      blind(otherCompleteId, 3, teamA.playerIds[3]!, teamB.playerIds[2]!, 4),
      blind(verifiedPartId, 4, teamA.playerIds[2]!, teamB.playerIds[2]!, 3),
    ];
    data.analytics = computeMatchAnalytics(data.match, '2026-10-24T00:00:00.000Z');
    data.artifact.analytics = data.analytics;
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const radar = buildPlayerRadar(canonicalResult, null);
    const flash = (playerId: string) => radar.players.find((player) => player.playerId === playerId)!.axes.find((axis) => axis.axisId === 'FLASH')!;

    expect(flash(teamA.playerIds[0]!)).toMatchObject({ availability: 'AVAILABLE', rawValue: 2, evidenceEventIds: [completeId] });
    expect(flash(teamA.playerIds[1]!)).toMatchObject({ availability: 'AVAILABLE', rawValue: 0, evidenceEventIds: [] });
    expect(flash(teamA.playerIds[2]!)).toMatchObject({ availability: 'UNAVAILABLE', reasonIfUnavailable: 'FLASH_DATA_UNAVAILABLE', rawValue: null, geometryValue: null });
    expect(flash(teamA.playerIds[3]!)).toMatchObject({ availability: 'AVAILABLE', rawValue: 4, evidenceEventIds: [otherCompleteId] });
    expect(flash(teamA.playerIds[1]!).evidenceEventIds).not.toContain(friendlyId);
    const comparison = radar.matchComparisons.find((row) => row.axisId === 'FLASH')!;
    expect(comparison).toMatchObject({ availability: 'AVAILABLE', comparisonPoolSize: 9, average: 6 / 9, incompleteCoverage: true });
    const { confirmedEvidence, ...regular } = buildPlayerRadar(canonicalResult, null, true);
    expect(regular).toEqual(radar);
    expect(confirmedEvidence.players).toEqual([{ playerId: teamA.playerIds[2], axes: [{
      axisId: 'FLASH', rawValue: 3, geometryValue: .75, evidenceEventIds: [verifiedPartId], evidenceRoundIds: ['round-1'],
    }] }]);
  });

  it('fails UTILITY closed per affected player while preserving independent damage, zero and the comparison pool', () => {
    const data = fixture();
    makeRadarRoundScopeConsistent(data);
    const teamA = data.match.teams[0]!;
    const teamB = data.match.teams[1]!;
    const hurt = (
      id: string,
      rowIndex: number,
      actorId: string,
      targetId: string,
      weapon: string,
      rawHealthDamage: number | null,
      healthAfter: number | null,
    ) => {
      const actor = data.match.players.find((player) => player.id === actorId)!;
      const target = data.match.players.find((player) => player.id === targetId);
      return {
        id, kind: 'PLAYER_HURT' as const, roundId: 'round-1', tick: 30 + rowIndex,
        actorId, targetId, assisterId: null, attrs: { weapon, rawHealthDamage, healthAfter },
        context: { phase: 'LIVE' as const, actorTeamId: actor.teamId, targetTeamId: target?.teamId ?? null, actorSide: 'T' as const, targetSide: target ? 'CT' as const : null, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
        source: { eventName: 'player_hurt', rowIndex },
      };
    };
    const heId = 'utility-he-complete';
    const infernoId = 'utility-inferno-derived-health';
    const friendlyId = 'utility-friendly';
    data.match.events = [
      hurt(heId, 0, teamA.playerIds[0]!, teamB.playerIds[0]!, 'hegrenade', 25, 75),
      hurt(infernoId, 1, teamA.playerIds[0]!, teamB.playerIds[1]!, 'inferno', 5, null),
      hurt(friendlyId, 2, teamA.playerIds[0]!, teamA.playerIds[4]!, 'hegrenade', 10, 90),
      hurt('utility-he-missing-damage', 3, teamA.playerIds[1]!, teamB.playerIds[2]!, 'hegrenade', null, null),
      hurt('utility-inferno-missing-damage', 4, teamA.playerIds[2]!, teamB.playerIds[3]!, 'inferno', null, null),
      hurt('utility-invalid-health-after', 5, teamA.playerIds[3]!, teamB.playerIds[4]!, 'hegrenade', 10, 150),
      hurt('utility-corrupt-ledger-followup', 6, teamA.playerIds[4]!, teamB.playerIds[4]!, 'hegrenade', 10, 90),
      hurt('utility-unknown-relation', 7, teamB.playerIds[0]!, 'unknown-player', 'hegrenade', 10, 90),
      hurt('utility-verified-part', 8, teamA.playerIds[1]!, teamB.playerIds[0]!, 'hegrenade', 10, 65),
    ];
    data.analytics = computeMatchAnalytics(data.match, '2026-10-24T00:00:00.000Z');
    data.artifact.analytics = data.analytics;
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const activeRatingBefore = structuredClone(canonicalResult.activeRating);
    const radar = buildPlayerRadar(canonicalResult, null);
    const utility = (playerId: string) => radar.players.find((player) => player.playerId === playerId)!.axes.find((axis) => axis.axisId === 'UTILITY')!;

    expect(utility(teamA.playerIds[0]!)).toMatchObject({
      availability: 'AVAILABLE', rawValue: 30,
      evidenceEventIds: [heId, infernoId],
      secondaryMetrics: [
        { metricId: 'HE_ENEMY_DAMAGE', value: 25, unit: 'DAMAGE' },
        { metricId: 'INFERNO_ENEMY_DAMAGE', value: 5, unit: 'DAMAGE' },
      ],
    });
    expect(utility(teamA.playerIds[0]!).evidenceEventIds).not.toContain(friendlyId);
    for (const playerId of [...teamA.playerIds.slice(1), teamB.playerIds[0]!]) {
      expect(utility(playerId)).toMatchObject({ availability: 'UNAVAILABLE', reasonIfUnavailable: 'DAMAGE_DATA_UNAVAILABLE', rawValue: null });
    }
    expect(utility(teamB.playerIds[1]!)).toMatchObject({ availability: 'AVAILABLE', rawValue: 0 });
    const comparison = radar.matchComparisons.find((row) => row.axisId === 'UTILITY')!;
    expect(comparison).toMatchObject({ availability: 'AVAILABLE', comparisonPoolSize: 5, average: 6, incompleteCoverage: true });
    expect(buildPlayerRadar(canonicalResult, null, true).confirmedEvidence.players).toEqual([{
      playerId: teamA.playerIds[1], axes: [{ axisId: 'UTILITY', rawValue: 10, geometryValue: .5,
        evidenceEventIds: ['utility-verified-part'], evidenceRoundIds: ['round-1'],
      }],
    }]);
    expect(radar.axisDefinitions.map((row) => row.axisId)).toEqual(playerRadarAxisIds);
    expect(canonicalResult.activeRating).toEqual(activeRatingBefore);
  });

  it('keeps bomb objectives unavailable for an unknown scenario instead of fabricating zero', () => {
    const data = legacyUnknownHostageFixture();
    makeRadarRoundScopeConsistent(data);
    data.match.map = null;
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const radar = buildPlayerRadar(canonicalResult, null);
    const comparison = radar.matchComparisons.find((row) => row.axisId === 'OBJECTIVES')!;
    expect(comparison).toMatchObject({ availability: 'UNAVAILABLE', reasonIfUnavailable: 'COMPARISON_POOL_EMPTY', average: null, comparisonPoolSize: 0 });
    expect(radar.players.every((player) => {
      const objective = player.axes.find((axis) => axis.axisId === 'OBJECTIVES')!;
      return objective.availability === 'UNAVAILABLE' && objective.reasonIfUnavailable === 'SCENARIO_UNKNOWN' && objective.rawValue === null;
    })).toBe(true);
  });

  it('highlights only confirmed positive H2 evidence for the MVP and does not assign a decisive-cause claim', () => {
    const data = fixture();
    const initial = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const mvpPlayerId = initial.activeRating.awards.mvp.playerId!;
    const mvp = data.match.players.find((player) => player.id === mvpPlayerId)!;
    const target = data.match.players.find((player) => player.teamId !== mvp.teamId)!;
    const event = {
      id: 'confirmed-opening-event', kind: 'PLAYER_DEATH', roundId: 'round-1', tick: 20,
      actorId: mvp.id, targetId: target.id, assisterId: null, attrs: {},
      context: { phase: 'LIVE' as const, actorTeamId: mvp.teamId, targetTeamId: target.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 0.15625, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex: 0 },
    };
    data.match.events.push(event);
    const analytics = data.analytics.players.find((player) => player.playerId === mvp.id)!;
    analytics.facts.push({ category: 'POSITIVE_CONTRIBUTION', kind: 'KILL', roundId: 'round-1', eventId: event.id, value: 1 });
    analytics.openingKills = 1;
    const profile = data.sidecar.profiles.find((row) => row.playerId === mvp.id)!;
    const contribution = { anchorId: event.id, chosenAxis: 'enemyHp', family: 'COMBAT' as const, base: 0.001, tags: ['OPENING'] };
    profile.prepared.p4BPlus.episodeContributions = [...(profile.prepared.p4BPlus.episodeContributions ?? []), contribution];
    profile.prepared.p4CPlus.episodeContributions = [...(profile.prepared.p4CPlus.episodeContributions ?? []), contribution];
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });

    const radar = buildPlayerRadar(canonicalResult, null);
    const entry = radar.players.find((player) => player.playerId === mvp.id)!.axes.find((axis) => axis.axisId === 'ENTRY')!;
    expect(entry.mvpAttribution).toMatchObject({
      reasonCode: 'CONFIRMED_POSITIVE_H2_EVIDENCE',
      terminologyCode: 'POSITIVE_H2_FACTOR_NOT_DECISIVE_CAUSE',
      evidenceEventIds: [event.id],
    });
    expect(entry.mvpAttribution!.families.some((family) => family.family === 'COMBAT' && family.familyFinalAttribution > 0)).toBe(true);
  });

  it('does not turn same-round assists, another player multikill, or aggregate H2 evidence into MVP multikill attribution', () => {
    const data = fixture();
    makeRadarRoundScopeConsistent(data);
    const initial = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const mvpId = initial.activeRating.awards.mvp.playerId!;
    const mvp = data.match.players.find((player) => player.id === mvpId)!;
    const teammate = data.match.players.find((player) => player.teamId === mvp.teamId && player.id !== mvp.id)!;
    const opponents = data.match.players.filter((player) => player.teamId !== mvp.teamId);
    const death = (id: string, tick: number, actorId: string, targetId: string, assisterId: string | null, rowIndex: number) => ({
      id, kind: 'PLAYER_DEATH', roundId: 'round-1', tick, actorId, targetId, assisterId, attrs: { assistedFlash: false },
      context: { phase: 'LIVE' as const, actorTeamId: data.match.players.find((player) => player.id === actorId)!.teamId, targetTeamId: data.match.players.find((player) => player.id === targetId)!.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex },
    });
    const mvpKill = death('mvp-single-kill', 10, mvp.id, opponents[0]!.id, null, 0);
    const assisted = death('mvp-assist', 20, teammate.id, opponents[1]!.id, mvp.id, 1);
    const otherMultikill = [
      death('other-kill-1', 30, teammate.id, opponents[2]!.id, null, 2),
      death('other-kill-2', 40, teammate.id, opponents[3]!.id, null, 3),
    ];
    data.match.events.push(mvpKill, assisted, ...otherMultikill);
    const mvpAnalytics = data.analytics.players.find((player) => player.playerId === mvp.id)!;
    mvpAnalytics.kills = 1;
    mvpAnalytics.assists = 1;
    mvpAnalytics.openingKills = 1;
    mvpAnalytics.facts.push(
      { category: 'POSITIVE_CONTRIBUTION', kind: 'KILL', roundId: 'round-1', eventId: mvpKill.id, value: null },
      { category: 'POSITIVE_CONTRIBUTION', kind: 'ASSIST', roundId: 'round-1', eventId: assisted.id, value: null },
    );
    const teammateAnalytics = data.analytics.players.find((player) => player.playerId === teammate.id)!;
    teammateAnalytics.kills = 3;
    teammateAnalytics.multiKills.two = 0;
    teammateAnalytics.multiKills.three = 1;
    teammateAnalytics.facts.push(...[assisted, ...otherMultikill].map((event) => ({ category: 'POSITIVE_CONTRIBUTION' as const, kind: 'KILL', roundId: 'round-1', eventId: event.id, value: null })));
    const profile = data.sidecar.profiles.find((row) => row.playerId === mvp.id)!;
    const contributions = [
      { anchorId: mvpKill.id, chosenAxis: 'enemyHp', family: 'COMBAT' as const, base: 0.001, tags: [] },
      { anchorId: assisted.id, chosenAxis: 'assist', family: 'SUPPORT' as const, base: 0.001, tags: [] },
      { anchorId: 'round-1:aggregate-only', chosenAxis: 'aggregate', family: 'COMBAT' as const, base: 0.001, tags: [] },
    ];
    profile.prepared.p4BPlus.episodeContributions = [...(profile.prepared.p4BPlus.episodeContributions ?? []), ...contributions];
    profile.prepared.p4CPlus.episodeContributions = [...(profile.prepared.p4CPlus.episodeContributions ?? []), ...contributions];
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const mvpRadar = buildPlayerRadar(canonicalResult, null).players.find((player) => player.playerId === mvp.id)!;
    expect(mvpRadar.axes.find((axis) => axis.axisId === 'ASSISTS')!.mvpAttribution?.evidenceEventIds).toEqual([assisted.id]);
    expect(mvpRadar.axes.find((axis) => axis.axisId === 'ENTRY')!.mvpAttribution?.evidenceEventIds).toEqual([mvpKill.id]);
    expect(mvpRadar.axes.find((axis) => axis.axisId === 'MULTIKILL')!.mvpAttribution).toBeNull();
  });

  it('requires a positive stored context factor and an exact player event before highlighting MVP context', () => {
    const data = fixture();
    makeRadarRoundScopeConsistent(data);
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const mvpId = canonicalResult.activeRating.awards.mvp.playerId!;
    const mvp = canonicalResult.artifact.match.players.find((player) => player.id === mvpId)!;
    const opponents = canonicalResult.artifact.match.players.filter((player) => player.teamId !== mvp.teamId);
    const kills = opponents.slice(0, 2).map((target, index) => ({
      id: `context-multikill-${index + 1}`, kind: 'PLAYER_DEATH', roundId: 'round-1', tick: 20 + index, actorId: mvp.id, targetId: target.id, assisterId: null, attrs: {},
      context: { phase: 'LIVE' as const, actorTeamId: mvp.teamId, targetTeamId: target.teamId, actorSide: 'T' as const, targetSide: 'CT' as const, aliveByTeamId: null, secondsFromFreezeEnd: 1, bombState: 'NOT_PLANTED' as const, actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex: index },
    }));
    canonicalResult.artifact.match.events.push(...kills);
    const analytics = canonicalResult.artifact.analytics.players.find((player) => player.playerId === mvp.id)!;
    analytics.kills = 2;
    analytics.multiKills = { two: 1, three: 0, four: 0, five: 0 };
    analytics.openingKills = 1;
    analytics.facts.push(...kills.map((event) => ({ category: 'POSITIVE_CONTRIBUTION' as const, kind: 'KILL', roundId: 'round-1', eventId: event.id, value: null })));
    const rating = canonicalResult.activeRating.players.find((player) => player.playerId === mvp.id)!.rating!;
    const originalContext = rating.finalAttribution.CONTEXT;
    rating.rawFamilyInputs.CONTEXT = 0.001;
    rating.finalAttribution.CONTEXT = 0.01;
    rating.value += 0.01 - originalContext;
    rating.kernelDetails.context.winningTagByAnchor = { [kills[0]!.id]: 'MULTI_KILL' };
    rating.kernelDetails.factorContributions.CONTEXT = { MULTI_KILL: -0.001, OPENING: 0.002 };

    const negativeFactor = buildPlayerRadar(canonicalResult, null);
    const negativeMvp = negativeFactor.players.find((player) => player.playerId === mvp.id)!;
    expect(negativeMvp.h2Explanation.families).toHaveLength(6);
    expect(negativeMvp.axes.find((axis) => axis.axisId === 'MULTIKILL')!.mvpAttribution).toBeNull();

    const positive = structuredClone(canonicalResult);
    const positiveRating = positive.activeRating.players.find((player) => player.playerId === mvp.id)!.rating!;
    positiveRating.kernelDetails.factorContributions.CONTEXT.MULTI_KILL = 0.001;
    const positiveMvp = buildPlayerRadar(positive, null).players.find((player) => player.playerId === mvp.id)!;
    expect(positiveMvp.axes.find((axis) => axis.axisId === 'MULTIKILL')!.mvpAttribution?.evidenceEventIds).toEqual([kills[0]!.id]);

    const unknownAnchor = structuredClone(positive);
    unknownAnchor.activeRating.players.find((player) => player.playerId === mvp.id)!.rating!.kernelDetails.context.winningTagByAnchor = { 'unknown-anchor': 'MULTI_KILL' };
    const unknownMvp = buildPlayerRadar(unknownAnchor, null).players.find((player) => player.playerId === mvp.id)!;
    expect(unknownMvp.axes.find((axis) => axis.axisId === 'MULTIKILL')!.mvpAttribution).toBeNull();
    expect(unknownMvp.axes.every((axis) => axis.evpAttribution === null)).toBe(true);
    expect(unknownMvp.axes.every((axis) => axis.mvpAttribution === null)).toBe(true);
    expect(buildPlayerRadar(unknownAnchor, null).players.filter((player) => player.playerId !== mvp.id).every((player) => player.axes.every((axis) => axis.mvpAttribution === null))).toBe(true);
  });

  it('uses only awarded EVP specializations and preserves independent secondary attribution', () => {
    const data = fixture();
    const canonicalResult = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const base = buildEvpReport(canonicalResult, evpReportBinding(canonicalResult));
    const player = base.players.find((row) => row.playerId !== base.mvpPlayerId)!;
    player.status = 'AWARDED';
    player.primarySpecializationId = 'MULTIKILL_SPECIALIST';
    player.secondarySpecializationId = 'TRADE_SPECIALIST';
    player.candidateStrength = 0.8;
    player.secondaryBonus = 0.04;
    const primary = player.specializations.find((row) => row.specializationId === 'MULTIKILL_SPECIALIST')!;
    primary.achievementStrength = 0.8;
    primary.qualified = true;
    const secondary = player.specializations.find((row) => row.specializationId === 'TRADE_SPECIALIST')!;
    secondary.achievementStrength = 0.7;
    secondary.qualified = true;
    base.awards = [{ position: 1, playerId: player.playerId, specializationId: 'MULTIKILL_SPECIALIST', achievementStrength: 0.8, candidateStrength: 0.8 }];
    const report = evpReportSchema.parse(base);
    const activeRatingBefore = structuredClone(canonicalResult.activeRating);
    const evpBefore = structuredClone(report);

    const radar = buildPlayerRadar(canonicalResult, report);
    const awarded = radar.players.find((row) => row.playerId === player.playerId)!;
    expect(awarded.awardState).toBe('EVP');
    expect(awarded.axes.find((row) => row.axisId === 'MULTIKILL')!.evpAttribution?.role).toBe('PRIMARY');
    expect(awarded.axes.find((row) => row.axisId === 'TRADES')!.evpAttribution?.role).toBe('SECONDARY');
    expect(awarded.axes.find((row) => row.axisId === 'FLASH')!.evpAttribution).toBeNull();
    const mvp = radar.players.find((row) => row.awardState === 'MVP')!;
    expect(mvp.axes.every((row) => row.evpAttribution === null)).toBe(true);
    expect(canonicalResult.activeRating).toEqual(activeRatingBefore);
    expect(report).toEqual(evpBefore);
  });

  it('serves historical matches without EVP and rejects corrupt EVP pointers through the radar endpoint', async () => {
    const data = fixture();
    const mocked = mockCanonical(data);
    const radar = await createTestApiFacade().radar(data.match.matchId);
    expect(radar.schemaVersion).toBe('player-radar@1');
    expect(radar.sourceBinding.evpReportSchemaVersion).toBeNull();
    expect(readFile).toHaveBeenCalledTimes(1);

    findUnique.mockResolvedValue({ ...mocked.stored, evpFilePath: 'experimental/evp/broken.json.gz' });
    await expect(createTestApiFacade().radar(data.match.matchId)).rejects.toMatchObject({ code: 'REPORT_CORRUPT' });
  });

  it('does not invent H2 MVP attribution for a historical H1 canonical result', () => {
    const data = fixture();
    const h2 = buildCanonicalMatchResult({ artifact: data.artifact, sidecar: data.sidecar, productionReports: [], sourceDemoRetained: false, createdAt: '2026-10-26T00:00:00.000Z' });
    const radar = buildPlayerRadar(withHistoricalH1Identity(h2), null);
    expect(radar.sourceBinding.h2ReportSchemaVersion).toBeNull();
    expect(radar.players.every((player) => player.awardState !== 'MVP')).toBe(true);
    expect(radar.players.every((player) => player.h2Explanation.reasonIfUnavailable === 'H2_UNAVAILABLE')).toBe(true);
  });

  it('publishes player-radar@1 through the exact read-only Nest route and OpenAPI', async () => {
    const data = fixture(); mockCanonical(data);
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
    try {
      const response = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/radar`).expect(200);
      expect(response.body.schemaVersion).toBe('player-radar@1');
      expect(response.body.players).toHaveLength(10);
      await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/radar?policy=H2`).expect(422);
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('test').build());
      expect(document.paths['/api/v1/matches/{id}/radar']?.get?.responses?.['200']).toBeDefined();
    } finally { await app.close(); }
  });

  it('does not register the retired P2/C2+S2 route even when the obsolete flag is present', async () => {
    process.env.ENABLE_EXPERIMENTAL_RATING = '1';
    const app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new SafeExceptionFilter()); await app.init();
    try {
      await request(app.getHttpServer()).get('/api/v1/matches/synthetic/experimental-rating').expect(404);
      await request(app.getHttpServer()).get('/api/v1/matches/synthetic/experimental-rating?model=c2-s2').expect(404);
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('test').setVersion('test').build());
      expect(document.paths['/api/v1/matches/{id}/experimental-rating']).toBeUndefined();
      expect(JSON.stringify(document)).not.toContain('m3c8-integration-1');
      expect(JSON.stringify(document)).not.toContain('m3c8-c2s2-integration-1');
    } finally {
      delete process.env.ENABLE_EXPERIMENTAL_RATING;
      await app.close();
    }
  });
});
