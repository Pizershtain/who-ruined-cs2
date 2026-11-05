import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NORMALIZER_VERSION } from '@who-ruined/parser-adapter';
import { canonicalMatchResultSchema, participationExplanationReportSchema } from '@who-ruined/contracts';
import {
  buildActiveParticipationRating,
  buildCanonicalMatchResult,
  buildImportantMoments,
  buildParticipationExplanation,
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
  H2_PARTICIPATION_RATING_POLICY,
  HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY,
  PARTICIPATION_SIDECAR_POLICY_IDENTITIES,
  rebuildCanonicalMatchResult
} from '@who-ruined/scoring';

const findUnique = vi.fn();
const readFile = vi.fn();
const stat = vi.fn();
const access = vi.fn();
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
  const match = {
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
  const analytics = { schemaVersion: 'm2-1' as const, featureVersion: 'm2-0.1.0' as const, matchId: match.matchId, generatedAt: '2026-10-24T00:00:00.000Z', tradeWindowSeconds: 5 as const, availability: { damage: 'AVAILABLE' as const, flashes: 'AVAILABLE' as const, economy: 'AVAILABLE' as const, aliveContext: 'AVAILABLE' as const }, players: analyticsPlayers, limitations: [] };
  const artifact = { schemaVersion: 'm2-artifact-1' as const, match, analytics };
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
  const sidecar = { schemaVersion: 'm3c8-participation-prepared@1.0.0-experimental' as const, createdAt: '2026-10-24T00:00:00.000Z', fingerprint: createHash('sha256').update(canonical(stable)).digest('hex'), ...stable };
  return { match, analytics, artifact, sidecar };
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
  findUnique.mockResolvedValue({
    id: source.match.matchId, deletionState: null, normalizedFilePath: null, rawFilePath: null,
    resultFilePath: 'results/synthetic/result.json.gz', resultSha256: createHash('sha256').update(compressed).digest('hex'),
    resultPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
    resultPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest
  });
  readFile.mockResolvedValue(compressed);
  return { source, result };
}

function withHistoricalH1Identity(result: ReturnType<typeof buildCanonicalMatchResult>) {
  return canonicalMatchResultSchema.parse({
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

  it('is default-off and performs no data access while disabled', async () => {
    delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
    await expect(createTestApiFacade().participationRating('match')).rejects.toMatchObject({ code: 'EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('keeps the explanation endpoint default-off and requires a stored canonical result', async () => {
    delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
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
      delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
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
      delete process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING;
      const disabled = await request(app.getHttpServer()).get(`/api/v1/matches/${data.match.matchId}/experimental-participation-explanation`).expect(404);
      expect(disabled.body.error.code).toBe('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED');
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
