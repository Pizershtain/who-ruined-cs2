export type RatingFamily = 'COMBAT' | 'SUPPORT' | 'DEATH_RELATED' | 'OBJECTIVES' | 'CONTEXT' | 'DIRECT_HARM';
export type RatingFamilies = Record<RatingFamily, number>;

export interface PlayerRating {
  value: number;
  rank: number;
  losingTeamRank: number | null;
  rawFamilyInputs: RatingFamilies;
  finalAttribution: RatingFamilies;
}

export type Award =
  | { state: 'available'; playerId: string; value: number; poolSize: number; close: boolean; tied: boolean; scoreGap: number | null; tiedPlayerIds: string[]; scope?: 'LOSING_TEAM_ELIGIBLE' | 'DRAW_ALL_ELIGIBLE' | 'UNAVAILABLE' }
  | { state: 'insufficient-data' | 'unavailable'; poolSize?: number; reason?: string | null; tied?: boolean; scope?: 'LOSING_TEAM_ELIGIBLE' | 'DRAW_ALL_ELIGIBLE' | 'UNAVAILABLE' };

export interface PlayerMetrics {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damage: number | null;
  adr: number | null;
  kast: number | null;
  openingKills: number | null;
  openingDeaths: number | null;
  trades: number | null;
  utilityDamage: number | null;
  heDamage?: number | null;
  fireDamage?: number | null;
  enemiesFlashed?: number | null;
  enemyBlindSeconds?: number | null;
  rating: PlayerRating | null;
  ratingAvailability?: 'CALCULATED_RESEARCH_ONLY' | 'PARTICIPATION_ABSENT_GT_2_ROUNDS' | 'PARTICIPATION_EVIDENCE_UNKNOWN' | 'PARTIAL_COVERAGE_INSUFFICIENT' | 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE' | 'UNKNOWN_APPLICABILITY';
  ratingReason?: string | null;
  ratingCoverage?: { verifiedRounds: number; partialRounds: number; unknownRounds: number; absentFullRounds: number; globalExcludedRounds: number };
}
export interface AnalysisMoment {
  id: string;
  playerId: string;
  roundId: string;
  tick: number;
  category: 'positive' | 'mistake' | 'fact';
  kind: string;
  importance: 'high' | 'medium';
  confidence: number | null;
  endTick?: number;
  evidenceStrength?: 'DIRECT' | 'DERIVED' | 'RESEARCH_HYPOTHESIS';
  observedFacts?: string[];
}
export interface MatchAnalytics {
  source?: 'm2' | 'm4';
  availability?: { damage: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; flashes: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; economy: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; aliveContext: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' };
  limitations?: string[];
  mvp: Award;
  whoRuined: Award;
  players: Record<string, PlayerMetrics>;
  moments: AnalysisMoment[] | null;
  roundImpact: Array<{ roundId: string; players: Record<string, number> }> | null;
  insights: Record<string, { strengths: Array<'opening-duels' | 'utility-support'>; opportunities: Array<'untraded-entries'> }> | null;
  activeRating?: {
    experimental: true;
    calibrated: false;
    causalBlame: false;
    eligiblePoolSize: number;
    incompletePool: boolean;
    outcome: 'DECIDED' | 'DRAW' | 'UNKNOWN';
    warnings: string[];
    limitations: string[];
  };
}
