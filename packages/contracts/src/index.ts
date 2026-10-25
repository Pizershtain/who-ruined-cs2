import { z } from 'zod';

export const jobStatuses = ['QUEUED', 'PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export const jobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const qualitySchema = z.enum(['VALID', 'PARTIAL', 'UNSUPPORTED']);
export type Quality = z.infer<typeof qualitySchema>;
export const sideSchema = z.enum(['T', 'CT']);
export type Side = z.infer<typeof sideSchema>;
export const eventPhaseSchema = z.enum(['PRE_FREEZE', 'LIVE', 'POST_ROUND', 'UNKNOWN']);
export type EventPhase = z.infer<typeof eventPhaseSchema>;

const id = z.string().min(1).max(160);
const scoreRecord = z.record(z.string(), z.number().int().nonnegative());
const sideRecord = z.record(z.string(), sideSchema);

export const teamSchema = z.object({ id, playerIds: z.array(id), label: z.string().max(160) });
export const scoreboardStatsSchema = z.object({
  kills: z.number().int().nonnegative(), deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(), teamKills: z.number().int().nonnegative(),
  source: z.literal('PARSED_DEATH_EVENTS_SCOREBOARD_PHASES')
});
export const playerSchema = z.object({
  id, steamId: z.string().regex(/^7656119\d{10}$/).nullable(),
  displayName: z.string().max(160), teamId: id, scoreboard: scoreboardStatsSchema.optional()
});
export const roundSchema = z.object({
  id,
  ordinal: z.number().int().positive(),
  startTick: z.number().int().nonnegative(),
  freezeEndTick: z.number().int().nonnegative().nullable(),
  endTick: z.number().int().nonnegative(),
  winnerTeamId: id.nullable(),
  winnerSide: sideSchema.nullable(),
  sideByTeamId: sideRecord,
  scoreBefore: scoreRecord,
  scoreAfter: scoreRecord,
  isPistol: z.boolean().optional(),
  isOvertime: z.boolean().optional(),
  isValid: z.boolean(),
  issues: z.array(z.string())
});
export const matchEventSchema = z.object({
  id,
  kind: z.string(),
  roundId: id,
  tick: z.number().int().nonnegative(),
  actorId: id.nullable(),
  targetId: id.nullable(),
  assisterId: id.nullable(),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])),
  context: z.object({
    phase: eventPhaseSchema,
    actorTeamId: id.nullable(), targetTeamId: id.nullable(), actorSide: sideSchema.nullable(), targetSide: sideSchema.nullable(),
    aliveByTeamId: z.record(z.string(), z.number().int().nonnegative()).nullable(),
    secondsFromFreezeEnd: z.number().nullable(), bombState: z.enum(['NOT_PLANTED','PLANTED','DEFUSED','EXPLODED']).nullable(),
    actorEquipmentValue: z.number().int().nonnegative().nullable(), actorMoney: z.number().int().nonnegative().nullable()
  }).optional(),
  source: z.object({ eventName: z.string(), rowIndex: z.number().int().nonnegative() })
});
export const qualityIssueSchema = z.object({ code: z.string(), message: z.string(), roundOrdinal: z.number().int().positive().optional() });
export const matchDataSchema = z.object({
  schemaVersion: z.literal('1'), matchId: id, fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  map: z.string().nullable(), tickRate: z.number().positive().nullable(),
  teams: z.array(teamSchema), players: z.array(playerSchema), rounds: z.array(roundSchema), events: z.array(matchEventSchema),
  quality: qualitySchema, qualityIssues: z.array(qualityIssueSchema),
  provenance: z.object({ parser: z.string(), parserVersion: z.string(), normalizedAt: z.string().datetime() })
});
export type MatchData = z.infer<typeof matchDataSchema>;
export type MatchRound = z.infer<typeof roundSchema>;
export type MatchEvent = z.infer<typeof matchEventSchema>;

export const availabilitySchema = z.enum(['AVAILABLE', 'PARTIAL', 'UNAVAILABLE']);
const nullableCount = z.number().int().nonnegative().nullable();
const nullableMetric = z.number().nonnegative().nullable();
export const playerAnalyticsSchema = z.object({
  playerId: id, teamId: id, roundsPlayed: z.number().int().nonnegative(),
  kills: nullableCount, deaths: nullableCount, assists: nullableCount, kdaRatio: nullableMetric,
  enemyDamage: nullableCount, teamDamage: nullableCount, adr: nullableMetric,
  kastRounds: nullableCount, kastPercent: nullableMetric, survivedRounds: nullableCount,
  openingKills: nullableCount, openingDeaths: nullableCount,
  tradeKills: nullableCount, deathsTraded: nullableCount, untradedDeaths: nullableCount, tradeParticipation: nullableCount,
  multiKills: z.object({ two: z.number().int().nonnegative(), three: z.number().int().nonnegative(), four: z.number().int().nonnegative(), five: z.number().int().nonnegative() }),
  clutches: z.record(z.string(), z.number().int().nonnegative()),
  killsWithAdvantage: nullableCount, killsAtDisadvantage: nullableCount,
  teamKills: nullableCount, suicides: nullableCount,
  bomb: z.object({ plants: nullableCount, defuses: nullableCount, explosions: nullableCount }),
  grenades: z.object({
    flashesThrown: nullableCount, enemiesFlashed: nullableCount, teammatesFlashed: nullableCount,
    enemyBlindSeconds: nullableMetric, teamBlindSeconds: nullableMetric,
    heThrown: nullableCount, heEnemyDamage: nullableCount, heTeamDamage: nullableCount,
    infernosStarted: nullableCount, infernoEnemyDamage: nullableCount, infernoTeamDamage: nullableCount,
    smokesThrown: nullableCount, smokeEffectiveness: z.null()
  }),
  economy: z.object({ availability: availabilitySchema, freezeEquipmentValueTotal: nullableCount, freezeRoundsObserved: nullableCount, money: z.null() }),
  facts: z.array(z.object({ category: z.enum(['POSITIVE_CONTRIBUTION','ERROR','NEUTRAL']), kind: z.string(), roundId: id, eventId: id.nullable(), value: z.number().nullable() }))
});
export type PlayerAnalytics = z.infer<typeof playerAnalyticsSchema>;

export const matchAnalyticsSchema = z.object({
  schemaVersion: z.literal('m2-1'), featureVersion: z.literal('m2-0.1.0'), matchId: id,
  generatedAt: z.string().datetime(), tradeWindowSeconds: z.literal(5),
  availability: z.object({ damage: availabilitySchema, flashes: availabilitySchema, economy: availabilitySchema, aliveContext: availabilitySchema }),
  players: z.array(playerAnalyticsSchema),
  limitations: z.array(z.string())
});
export type MatchAnalytics = z.infer<typeof matchAnalyticsSchema>;

export const matchArtifactSchema = z.object({ schemaVersion: z.literal('m2-artifact-1'), match: matchDataSchema, analytics: matchAnalyticsSchema });
export type MatchArtifact = z.infer<typeof matchArtifactSchema>;

export const experimentalMetricStatusSchema = z.enum(['COMPLETE','PARTIAL','UNKNOWN','NOT_APPLICABLE','UNAVAILABLE']);
export const experimentalRatingStatusSchema = z.enum(['CALCULATED_RESEARCH_ONLY','WITHHELD_REQUIRED_INPUT','INSUFFICIENT_EXPOSURE','PARTIAL_COVERAGE','UNSUPPORTED_ROSTER_SIZE']);
export const experimentalRankingStatusSchema = z.enum(['LOSING_TEAM_AVAILABLE','NO_LOSING_TEAM','NOT_COMPARABLE']);
export const experimentalReferenceStatusSchema = z.literal('DEVELOPMENT_ONLY_FROZEN');
export const experimentalDenominatorStatusSchema = z.literal('ROSTER_SCHEDULED_CONVENTION');
export const experimentalScenarioSchema = z.enum(['BOMB','HOSTAGE','UNKNOWN']);
export const experimentalMetricSchema = z.object({
  value: z.number().nullable(), status: experimentalMetricStatusSchema,
  unit: z.enum(['count','hp','seconds','percent','ratio','rounds','credits']),
  source: z.enum(['M2_ANALYTICS','NORMALIZED_EVENTS','DERIVED_EXPERIMENTAL'])
});
export const experimentalFamilySchema = z.object({
  ratingRole: z.enum(['RATED_PRIMARY','DESCRIPTIVE_ONLY']),
  status: experimentalMetricStatusSchema,
  contribution: z.number().nullable(),
  metrics: z.record(z.string(), experimentalMetricSchema)
});
export const experimentalRatingPlayerSchema = z.object({
  playerId: id, teamId: id, displayName: z.string().max(160), steamId: z.string().regex(/^7656119\d{10}$/).nullable(), steamProfileUrl: z.string().url().nullable(),
  sideRounds: z.object({ T: z.number().int().nonnegative(), CT: z.number().int().nonnegative() }),
  exposure: z.object({ validRounds: z.number().int().nonnegative(), totalRounds: z.number().int().nonnegative(), coverageRatio: z.number().min(0).max(1).nullable(), denominatorStatus: experimentalDenominatorStatusSchema }),
  rating: z.number().nullable(), ratingStatus: experimentalRatingStatusSchema, causeCodes: z.array(z.string()), dataQualityFlags: z.array(z.string()),
  decomposition: z.object({ origin: z.literal(1), combat: z.number().nullable(), support: z.number().nullable(), directHarm: z.number().nullable(), reconstructedRating: z.number().nullable(), exact: z.boolean() }),
  baseStats: z.object({ kills: experimentalMetricSchema, deaths: experimentalMetricSchema, assists: experimentalMetricSchema, kdaRatio: experimentalMetricSchema, adr: experimentalMetricSchema, kastPercent: experimentalMetricSchema }),
  families: z.object({ combat: experimentalFamilySchema, support: experimentalFamilySchema, objectives: experimentalFamilySchema, directHarm: experimentalFamilySchema }),
  context: z.object({ openingKills: experimentalMetricSchema, openingDeaths: experimentalMetricSchema, tradeKills: experimentalMetricSchema, deathsTraded: experimentalMetricSchema, killsWithAdvantage: experimentalMetricSchema, killsAtDisadvantage: experimentalMetricSchema }),
  grenades: z.object({ flashesThrown: experimentalMetricSchema, enemiesFlashed: experimentalMetricSchema, teammatesFlashed: experimentalMetricSchema, enemyBlindSeconds: experimentalMetricSchema, teamBlindSeconds: experimentalMetricSchema, heThrown: experimentalMetricSchema, heEnemyDamage: experimentalMetricSchema, heTeamDamage: experimentalMetricSchema, infernosStarted: experimentalMetricSchema, infernoEnemyDamage: experimentalMetricSchema, infernoTeamDamage: experimentalMetricSchema, smokesThrown: experimentalMetricSchema })
});
export const experimentalRatingRoundSchema = z.object({
  roundId: id, ordinal: z.number().int().positive(), winnerTeamId: id.nullable(), winnerSide: sideSchema.nullable(), scoreAfter: scoreRecord,
  players: z.array(z.object({ playerId: id, side: sideSchema.nullable(), kills: z.number().int().nonnegative(), deaths: z.number().int().nonnegative(), assists: z.number().int().nonnegative(), enemyDamage: z.number().int().nonnegative().nullable(), teamDamage: z.number().int().nonnegative().nullable(), openingKill: z.boolean(), tradeKill: z.boolean(), bombPlant: z.boolean(), bombDefuse: z.boolean(), ratingContribution: z.number().nullable(), contributionStatus: experimentalMetricStatusSchema }))
});
export const experimentalRatingReportSchema = z.object({
  schemaVersion: z.literal('m3c8-integration-1'), metricVersion: z.literal('m3c8-integration-metrics-0.2.0'), matchId: id,
  experimental: z.literal(true), calibrated: z.literal(false), causalBlame: z.literal(false), originMeaning: z.literal('DEVELOPMENT_CENTERED_PRESENTATION_DEPOSIT'),
  policy: z.object({ policyId: z.literal('m3c8-family-balanced-rnd@0.2.0'), scoreScale: z.literal(0.1), referenceId: z.literal('m3c8-integration-dev-reference@0.2.0'), referenceHash: z.string().regex(/^[a-f0-9]{64}$/), referenceStatus: experimentalReferenceStatusSchema }),
  scenario: experimentalScenarioSchema, quality: qualitySchema, winningTeamId: id.nullable(), losingTeamId: id.nullable(), rankingStatus: experimentalRankingStatusSchema,
  roundCoverage: z.object({ validRounds: z.number().int().nonnegative(), totalRounds: z.number().int().nonnegative(), withheldRounds: z.number().int().nonnegative(), coverageRatio: z.number().min(0).max(1).nullable(), status: experimentalMetricStatusSchema, causeCodes: z.array(z.string()) }),
  players: z.array(experimentalRatingPlayerSchema).length(10), rounds: z.array(experimentalRatingRoundSchema),
  warnings: z.array(z.string()), limitations: z.array(z.string()), provenance: z.object({ parserVersion: z.string(), normalizerVersion: z.string(), featureVersion: z.string(), kernelVersion: z.literal('m3c8-kernel-0.2.0') })
});
export type ExperimentalMetric = z.infer<typeof experimentalMetricSchema>;
export type ExperimentalRatingPlayer = z.infer<typeof experimentalRatingPlayerSchema>;
export type ExperimentalRatingReport = z.infer<typeof experimentalRatingReportSchema>;

const c2s2FamilyContributionsSchema = z.object({
  COMBAT: z.number(), SUPPORT: z.number(), DEATH_RELATED: z.number(), DIRECT_HARM: z.number(), CONTEXT: z.number(), OBJECTIVES: z.number()
});
const c2s2PreparedRowSchema = z.object({
  status: z.enum(['CALCULATED_RESEARCH_ONLY','WITHHELD_REQUIRED_INPUT','UNKNOWN_APPLICABILITY']),
  reason: z.string().nullable().optional(), familyContributions: c2s2FamilyContributionsSchema.partial().nullable().optional(),
  objectiveSignals: z.record(z.string(), z.number()).nullable().optional(),
  episodeContributions: z.array(z.object({ anchorId: id, chosenAxis: z.string(), family: z.enum(['COMBAT','SUPPORT','DEATH_RELATED','DIRECT_HARM']), base: z.number(), tags: z.array(z.string()) })).nullable().optional()
});
export const c2s2PreparedProfileSchema = z.object({
  profileKey: id, playerId: id, teamId: id, scenario: experimentalScenarioSchema,
  rounds: z.number().int().nonnegative(), validRounds: z.number().int().nonnegative(),
  tRounds: z.number().int().nonnegative(), ctRounds: z.number().int().nonnegative(),
  requiredInputStatus: z.string(), p4BPlus: c2s2PreparedRowSchema, p4CPlus: c2s2PreparedRowSchema
});
export const c2s2PreparedSidecarSchema = z.object({
  schemaVersion: z.literal('m3c8-c2s2-prepared-sidecar-1'), createdAt: z.string().datetime(),
  binding: z.object({ matchId: id, fileSha256: z.string().regex(/^[a-f0-9]{64}$/), parserVersion: z.string(), normalizerVersion: z.string() }),
  model: z.object({ modelVersion: z.literal('m3c8-c2-s2@1.0.0-experimental'), policyDigest: z.string().regex(/^[a-f0-9]{64}$/), referenceVersion: z.literal('p5-c2-p51-s2-development-67@1') }),
  scenario: experimentalScenarioSchema,
  roundEvidence: z.array(z.object({ roundId: id, clean: z.boolean(), reasons: z.array(z.string()), boundary: z.record(z.string(), z.unknown()) })),
  hostageActions: z.array(z.object({ event: z.enum(['hostage_hurt','hostage_rescued']), roundId: id, tick: z.number().int().nonnegative(), playerId: id, hostage: z.string().nullable() })),
  armorAxes: z.array(z.object({ anchorId: id, roundId: id, playerId: id, relation: z.enum(['ENEMY','ALLY']), axis: z.enum(['enemyArmor','allyArmor']), value: z.number().nonnegative() })),
  physicalAnchors: z.array(z.object({ profileKey: id, anchorId: id, components: z.record(z.string(), z.number()), tags: z.array(z.string()) })),
  contextTagRegistry: z.array(z.enum(['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'])).length(11).refine((tags) => new Set(tags).size === 11),
  contextTags: z.array(z.object({ profileKey: id, anchorId: id, tag: z.enum(['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT']) })),
  preparedProfiles: z.array(c2s2PreparedProfileSchema).length(10)
});
export type C2S2PreparedSidecar = z.infer<typeof c2s2PreparedSidecarSchema>;
export type C2S2PreparedProfileDto = z.infer<typeof c2s2PreparedProfileSchema>;

export const c2s2RatingReportSchema = z.object({
  schemaVersion: z.literal('m3c8-c2s2-integration-1'), matchId: id, experimental: z.literal(true), calibrated: z.literal(false), causalBlame: z.literal(false),
  modelVersion: z.literal('m3c8-c2-s2@1.0.0-experimental'), policyDigest: z.string().regex(/^[a-f0-9]{64}$/), referenceVersion: z.literal('p5-c2-p51-s2-development-67@1'),
  sidecarSchemaVersion: z.literal('m3c8-c2s2-prepared-sidecar-1'), scenario: experimentalScenarioSchema, quality: qualitySchema,
  winningTeamId: id.nullable(), losingTeamId: id.nullable(),
  players: z.array(z.object({
    playerId: id, teamId: id, displayName: z.string().max(160), steamId: z.string().regex(/^7656119\d{10}$/).nullable(), steamProfileUrl: z.string().url().nullable(),
    rank: z.number().int().positive().nullable(), losingTeamRank: z.number().int().positive().nullable(),
    status: z.enum(['CALCULATED_RESEARCH_ONLY','WITHHELD_REQUIRED_INPUT','UNKNOWN_APPLICABILITY']), reason: z.string().nullable(), rating: z.number().nullable(),
    familyContributions: c2s2FamilyContributionsSchema.nullable(), factorContributions: z.object({ CONTEXT: z.record(z.string(), z.number()), OBJECTIVES: z.record(z.string(), z.number()) }).nullable(),
    directHarm: z.object({ raw: z.number(), soft: z.number(), adjustment: z.number(), transformed: z.boolean(), k: z.number(), a: z.number() }).nullable(),
    context: z.object({ uncenteredSignal: z.number(), saturated: z.boolean(), winningTagByAnchor: z.record(z.string(), z.string()) }).nullable(),
    objectives: z.object({ positiveCapped: z.boolean(), negativeCapped: z.boolean() }).nullable(),
    directHarmRoundAllocation: z.record(z.string(), z.number()).nullable(),
    baseStats: z.object({ kills: nullableCount, deaths: nullableCount, assists: nullableCount, kdaRatio: nullableMetric, adr: nullableMetric, kastPercent: nullableMetric }),
    analytics: playerAnalyticsSchema
  })).length(10),
  ordering: z.array(id), losingTeamOrdering: z.array(id).nullable(),
  warnings: z.array(z.string()), limitations: z.array(z.string()),
  provenance: z.object({ parserVersion: z.string(), normalizerVersion: z.string(), featureVersion: z.string(), sidecarPath: z.string(), sourceDemoSha256: z.string().regex(/^[a-f0-9]{64}$/) })
});
export type C2S2RatingReport = z.infer<typeof c2s2RatingReportSchema>;

export const participationSidecarSchemaVersion = 'm3c8-participation-prepared@1.0.0-experimental' as const;
export const participationClassSchema = z.enum([
  'PRESENT_VERIFIED','ABSENT_FULL_ROUND_VERIFIED','INTERRUPTED_PARTIAL_ROUND',
  'PARTICIPATION_UNKNOWN','ROUND_GLOBAL_EVIDENCE_MISSING'
]);
export const participationProfileStatusSchema = z.enum([
  'ELIGIBLE','PARTICIPATION_ABSENT_GT_2_ROUNDS','PARTICIPATION_EVIDENCE_UNKNOWN',
  'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE','UNKNOWN_APPLICABILITY'
]);
export const participationSidecarSchema = z.object({
  schemaVersion: z.literal(participationSidecarSchemaVersion),
  createdAt: z.string().datetime(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  binding: z.object({
    matchId: id, fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
    parserVersion: z.string().min(1), normalizerVersion: z.string().min(1)
  }),
  model: z.object({
    preparedInputModel: z.string().min(1),
    preparedInputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    referenceVersion: z.string().min(1),
    policies: z.array(z.object({
      id: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/),
      harmMultiplier: z.union([z.literal(1),z.literal(2)])
    })).length(2)
  }),
  scenario: experimentalScenarioSchema,
  participation: z.array(z.object({
    roundId: id, ordinal: z.number().int().positive(), playerId: id,
    classification: participationClassSchema, reason: z.string().min(1), counted: z.boolean(),
    side: sideSchema.nullable(),
    boundary: z.object({ liveStart: z.number().int().nonnegative(), liveEnd: z.number().int().nonnegative(), complete: z.boolean() }),
    evidence: z.object({
      startObserved: z.boolean(), startAlive: z.boolean().nullable(), startTeamNum: z.number().int().nullable(),
      deathTick: z.number().int().nonnegative().nullable(), gameplayEventCount: z.number().int().nonnegative(),
      lifecycle: z.array(z.object({ kind: z.string().min(1), tick: z.number().int().nonnegative() }))
    })
  })),
  profiles: z.array(z.object({
    profileKey: id, playerId: id, teamId: id, status: participationProfileStatusSchema,
    reason: z.string().nullable(), verifiedRounds: z.number().int().nonnegative(),
    absentRounds: z.number().int().nonnegative(), partialRounds: z.number().int().nonnegative(),
    unknownRounds: z.number().int().nonnegative(), globalExcludedRounds: z.number().int().nonnegative(),
    tRounds: z.number().int().nonnegative(), ctRounds: z.number().int().nonnegative(),
    countedRoundIds: z.array(id), excludedRoundIds: z.array(id), prepared: c2s2PreparedProfileSchema
  })).length(10),
  provenance: z.object({
    source: z.literal('RAW_DEMO_EVENTS_AND_TICKS'), lifecycleEvents: z.array(z.string()),
    contextTags: z.array(z.string()), s2AppliedBy: z.string().min(1)
  })
});
export type ParticipationSidecar = z.infer<typeof participationSidecarSchema>;

export const participationRatingAvailabilitySchema = z.enum([
  'CALCULATED_RESEARCH_ONLY','PARTICIPATION_ABSENT_GT_2_ROUNDS','PARTICIPATION_EVIDENCE_UNKNOWN',
  'PARTIAL_COVERAGE_INSUFFICIENT','WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE','UNKNOWN_APPLICABILITY'
]);
const participationRatingAggregatesSchema = z.object({
  positiveMass: z.number().nonnegative(), negativeMass: z.number().nonnegative(),
  positiveTerm: z.number().nonnegative(), negativeTerm: z.number().nonpositive(), harmTerm: z.number().nonpositive()
});
const participationRatingValueSchema = z.object({
  value: z.number(), rank: z.number().int().positive(), losingTeamRank: z.number().int().positive().nullable(),
  rawFamilyInputs: c2s2FamilyContributionsSchema,
  aggregates: participationRatingAggregatesSchema,
  finalAttribution: c2s2FamilyContributionsSchema,
  arithmetic: z.object({ origin: z.literal(1), reconstructed: z.number(), tolerance: z.literal(1e-12), exactWithinTolerance: z.literal(true) }),
  kernelDetails: z.object({
    factorContributions: z.object({ CONTEXT: z.record(z.string(), z.number()), OBJECTIVES: z.record(z.string(), z.number()) }),
    directHarm: z.object({ raw: z.number(), soft: z.number(), adjustment: z.number(), transformed: z.boolean(), k: z.number(), a: z.number() }),
    context: z.object({ uncenteredSignal: z.number(), saturated: z.boolean(), winningTagByAnchor: z.record(z.string(), z.string()) }),
    objectives: z.object({ positiveCapped: z.boolean(), negativeCapped: z.boolean() })
  })
});
const participationCoverageSchema = z.object({
  verifiedRounds: z.number().int().nonnegative(), absentFullRounds: z.number().int().nonnegative(),
  partialRounds: z.number().int().nonnegative(), unknownRounds: z.number().int().nonnegative(),
  globalExcludedRounds: z.number().int().nonnegative(), countedOpportunities: z.number().int().nonnegative(),
  excludedOpportunities: z.number().int().nonnegative(), sideExposure: z.object({ T: z.number().int().nonnegative(), CT: z.number().int().nonnegative() }),
  causeCodes: z.array(z.string())
});
export const participationRatingPlayerSchema = z.object({
  playerId: id, teamId: id, displayName: z.string().max(160),
  steamId: z.string().regex(/^7656119\d{10}$/).nullable(), steamProfileUrl: z.string().url().nullable(),
  availability: z.object({ status: participationRatingAvailabilitySchema, reason: z.string().nullable() }),
  coverage: participationCoverageSchema, rating: participationRatingValueSchema.nullable(),
  baseStats: z.object({ kills: nullableCount, deaths: nullableCount, assists: nullableCount, kdaRatio: nullableMetric, adr: nullableMetric, kastPercent: nullableMetric }),
  analytics: playerAnalyticsSchema
});
const participationAwardSchema = z.object({
  playerId: id.nullable(), awardPoolSize: z.number().int().nonnegative(), tied: z.boolean(), close: z.boolean(),
  tiedPlayerIds: z.array(id), scoreGap: z.number().nonnegative().nullable(), reasonIfUnavailable: z.string().nullable()
});
export const participationRatingReportSchema = z.object({
  schemaVersion: z.literal('m3c8-participation-rating-report@1.0.0-experimental'),
  matchId: id, experimental: z.literal(true), calibrated: z.literal(false), causalBlame: z.literal(false),
  scorerVersion: z.literal('m3c8-p7.2-f-rating-projector@1.0.0-experimental'),
  policy: z.object({
    selector: z.enum(['H2','H1']), policyId: z.enum(['P72B_D_P10_N5_K025_A015_H2','P72B_D_P10_N5_K025_A015_H1']),
    policyDigest: z.string().regex(/^[a-f0-9]{64}$/), harmMultiplier: z.union([z.literal(1),z.literal(2)])
  }),
  prepared: z.object({
    schemaVersion: z.literal(participationSidecarSchemaVersion), preparedInputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), sourceBindingDigest: z.string().regex(/^[a-f0-9]{64}$/)
  }),
  scenario: experimentalScenarioSchema,
  applicability: z.object({ status: z.enum(['SUPPORTED','UNKNOWN']), reason: z.string().nullable() }),
  match: z.object({
    map: z.string().nullable(), quality: qualitySchema, totalRounds: z.number().int().nonnegative(), validRounds: z.number().int().nonnegative(),
    teams: z.array(z.object({ teamId: id, score: z.number().int().nonnegative().nullable() })).length(2)
  }),
  players: z.array(participationRatingPlayerSchema).length(10),
  ordering: z.array(id), losingTeamOrdering: z.array(id),
  awards: z.object({
    eligiblePoolSize: z.number().int().nonnegative(), incompletePool: z.boolean(),
    losingTeamId: id.nullable(), outcome: z.enum(['DECIDED','DRAW','UNKNOWN']),
    mvp: participationAwardSchema,
    whoRuined: participationAwardSchema.extend({ scope: z.enum(['LOSING_TEAM_ELIGIBLE','DRAW_ALL_ELIGIBLE','UNAVAILABLE']) })
  }),
  warnings: z.array(z.string()), limitations: z.array(z.string()),
  provenance: z.object({
    parserVersion: z.string(), normalizerVersion: z.string(), featureVersion: z.string(),
    sidecarReadOnly: z.literal(true), originalDemoParsedAtRequest: z.literal(false)
  })
});
export const participationRatingOpenApiSchema = z.toJSONSchema(participationRatingReportSchema, { target: 'openapi-3.0' });
export type ParticipationRatingReport = z.infer<typeof participationRatingReportSchema>;

export const scoringFindingCodes = [
  'ENEMY_KILL','OPENING_KILL','TRADE_KILL','ENEMY_DAMAGE','BOMB_DEFUSE','BOMB_PLANT_WIN',
  'TEAM_KILL','TEAM_DAMAGE','TEAM_FLASH','LIVE_SUICIDE','FLASH_SUPPORT'
] as const;
export const scoringFindingCodeSchema = z.enum(scoringFindingCodes);
export const evidenceStrengthSchema = z.enum(['DIRECT','DERIVED','RESEARCH_HYPOTHESIS']);
export const scoringFindingSchema = z.object({
  id, code: scoringFindingCodeSchema, category: z.enum(['POSITIVE','NEGATIVE','FACT']),
  scorerVersion: z.string().min(1), configHash: z.string().regex(/^[a-f0-9]{64}$/),
  playerId: id, roundId: id, tick: z.number().int().nonnegative(), magnitude: z.number().nonnegative(),
  confidence: z.number().min(0).max(1), weight: z.number().nonnegative(), weightedValue: z.number().nonnegative(),
  evidenceEventIds: z.array(id), evidenceStrength: evidenceStrengthSchema, explanationKey: z.string().min(1)
});
export type ScoringFinding = z.infer<typeof scoringFindingSchema>;

export const scoringEpisodeSchema = z.object({
  id, kind: z.enum(['HIGHLIGHT','ANTI_HIGHLIGHT','RESEARCH']), type: z.string().min(1),
  scorerVersion: z.string().min(1), configHash: z.string().regex(/^[a-f0-9]{64}$/),
  playerId: id, roundId: id, startTick: z.number().int().nonnegative(), endTick: z.number().int().nonnegative(),
  evidenceEventIds: z.array(id).min(1), observedFacts: z.array(z.string()), significance: z.number().nullable(),
  confidence: z.number().min(0).max(1), evidenceStrength: evidenceStrengthSchema, explanationKey: z.string().min(1),
  supportingFindingCodes: z.array(scoringFindingCodeSchema),
  context: z.object({
    phase: eventPhaseSchema.nullable(), side: sideSchema.nullable(), weapon: z.string().nullable(),
    bombState: z.enum(['NOT_PLANTED','PLANTED','DEFUSED','EXPLODED']).nullable(),
    secondsFromFreezeEnd: z.number().nullable(), equipmentValue: z.number().int().nonnegative().nullable(),
    aliveByTeamId: z.record(z.string(), z.number().int().nonnegative()).nullable()
  }),
  research: z.object({ classification: z.enum(['STRONG','MODERATE','NOT_TRIGGERED']), intervalSeconds: z.number().nonnegative(), alternatives: z.array(z.string()) }).nullable()
});
export type ScoringEpisode = z.infer<typeof scoringEpisodeSchema>;

const scoringWeightsSchema = z.object({
  enemyKill: z.number().nonnegative(), openingKill: z.number().nonnegative(), tradeKill: z.number().nonnegative(),
  enemyDamage: z.number().nonnegative(), bombDefuse: z.number().nonnegative(), bombPlantWin: z.number().nonnegative(),
  teamKill: z.number().nonnegative(), teamDamage: z.number().nonnegative(), teamFlash: z.number().nonnegative(),
  teamFlashConfidence: z.number().min(0).max(1), liveSuicide: z.number().nonnegative(), flashSupport: z.number().nonnegative()
});
export const scoringConfigSchema = z.object({
  schemaVersion: z.literal('scoring-config-1'), version: z.string().min(1), model: z.enum(['V1_COMPAT','SUCCESSOR']),
  alpha: z.number().min(0).max(1), beta: z.number().min(0).max(1), weights: scoringWeightsSchema,
  thresholds: z.object({ v1Spread: z.number().nonnegative(), v1TopMargin: z.number().nonnegative(), closeGap: z.number().nonnegative(), mvpCloseGap: z.number().nonnegative() }),
  policies: z.object({ bundleLethalTeamDamage: z.boolean(), alwaysAssignWhoRuinedOnEligibleSuccessor: z.boolean() })
}).superRefine((value, context) => {
  if (Math.abs(value.alpha + value.beta - 1) > 1e-9) context.addIssue({ code: 'custom', message: 'alpha + beta must equal 1' });
});
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

const nullableNonnegative = z.number().nonnegative().nullable();
export const scoringPlayerSchema = z.object({
  playerId: id, teamId: id, validRounds: z.number().int().nonnegative(), positive: z.number().nonnegative(),
  negative: z.number().nonnegative(), net: z.number(), positiveRate: nullableNonnegative, performanceRate: z.number().nullable(),
  contextContributionRate: nullableNonnegative, confirmedHarmRate: nullableNonnegative,
  teamReference: nullableNonnegative, positiveShortfall: nullableNonnegative,
  ruinRaw: nullableNonnegative, relativeIndex: z.number().int().min(0).max(100).nullable(),
  components: z.object({
    performance: z.object({ kills: nullableCount, assists: nullableCount, enemyDamage: nullableCount, adr: nullableMetric, kastPercent: nullableMetric, survivedRounds: nullableCount, multiKillRounds: z.number().int().nonnegative(), flashAssists: z.number().int().nonnegative(), enemyBlindSeconds: nullableMetric }),
    contextContribution: z.object({ points: z.number().nonnegative(), openingKills: nullableCount, tradeKills: nullableCount, killsWithAdvantage: nullableCount, killsAtDisadvantage: nullableCount, bombPlantsWon: z.number().int().nonnegative(), bombDefuses: nullableCount }),
    confirmedHarm: z.object({ points: z.number().nonnegative(), teamDamage: nullableCount, teamKills: nullableCount, teamBlindSeconds: nullableMetric, liveSuicides: nullableCount })
  }),
  findings: z.array(scoringFindingSchema), episodeIds: z.array(id)
});
export type ScoringPlayer = z.infer<typeof scoringPlayerSchema>;

const leaderSchema = z.object({ playerId: id, rate: z.number(), tied: z.boolean(), close: z.boolean(), tiedPlayerIds: z.array(id), margin: z.number().nonnegative(), reason: z.string() });
const whoRuinedSchema = z.object({ playerId: id, ruinRaw: z.number().nonnegative(), relativeIndex: z.number().int().min(0).max(100), primaryScoreTied: z.boolean(), close: z.boolean(), tiedPlayerIds: z.array(id), margin: z.number().nonnegative(), noConfirmedHarm: z.boolean(), reason: z.string() });
export const scoringRoundPlayerSchema = z.object({
  playerId: id, positive: z.number().nonnegative(), negative: z.number().nonnegative(),
  net: z.number(), findingIds: z.array(id), episodeIds: z.array(id)
});
export const scoringRoundSchema = z.object({
  roundId: id, ordinal: z.number().int().positive(), players: z.array(scoringRoundPlayerSchema)
});
export const scoringReportSchema = z.object({
  schemaVersion: z.literal('m3-score-1'), matchId: id, scorerVersion: z.string().min(1), configHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.enum(['V1_COMPAT','SUCCESSOR']), experimental: z.literal(true), status: z.enum(['COMPLETED','PARTIAL','UNSUPPORTED','INSUFFICIENT_COVERAGE']),
  quality: qualitySchema, winningTeamId: id.nullable(), losingTeamId: id.nullable(),
  coverage: z.object({ score: z.number().min(0).max(1), rounds: z.number().min(0).max(1), identities: z.number().min(0).max(1), deaths: z.number().min(0).max(1), enemyDamage: z.number().min(0).max(1), teamDamage: z.number().min(0).max(1), eligible: z.boolean(), reasons: z.array(z.string()) }),
  mvp: leaderSchema.nullable(), whoRuined: whoRuinedSchema.nullable(), v1ClearRuinerPlayerId: id.nullable(),
  players: z.array(scoringPlayerSchema), episodes: z.array(scoringEpisodeSchema),
  rounds: z.array(scoringRoundSchema),
  warnings: z.array(z.string()), limitations: z.array(z.string())
});
export type ScoringReport = z.infer<typeof scoringReportSchema>;

export const playerScoringReportSchema = z.object({
  schemaVersion: z.literal('m3-score-1'), matchId: id, scorerVersion: z.string().min(1),
  configHash: z.string().regex(/^[a-f0-9]{64}$/), model: z.enum(['V1_COMPAT','SUCCESSOR']),
  experimental: z.literal(true), player: scoringPlayerSchema, episodes: z.array(scoringEpisodeSchema),
  rounds: z.array(z.object({
    roundId: id, ordinal: z.number().int().positive(), player: scoringRoundPlayerSchema
  })),
  warnings: z.array(z.string()), limitations: z.array(z.string())
});
export type PlayerScoringReport = z.infer<typeof playerScoringReportSchema>;

export const rescoreRequestSchema = z.object({
  scoringVersion: z.string().min(1),
  configHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
});
export type RescoreRequest = z.infer<typeof rescoreRequestSchema>;

export const jobDtoSchema = z.object({
  id, matchId: id, status: jobStatusSchema, stage: z.string(), createdAt: z.string(), updatedAt: z.string(),
  errorCode: z.string().optional(), message: z.string().optional()
});
export type JobDto = z.infer<typeof jobDtoSchema>;

export const errorCodes = ['INVALID_DEMO','UNSUPPORTED_MODE','INCOMPLETE_MATCH','MISSING_REQUIRED_EVENTS','SIZE_LIMIT','PARSE_TIMEOUT','PARSE_FAILED','SCORING_FAILED','VALIDATION_FAILED','JOB_NOT_FOUND','MATCH_NOT_FOUND','PLAYER_NOT_FOUND','INTERNAL_ERROR'] as const;
export type ErrorCode = typeof errorCodes[number];
