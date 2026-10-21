// View model. M2 is mapped explicitly by adapter.ts; ratings exist only in dev previews.
export type Award =
  | { state: 'available'; playerId: string; value: number; margin: number; close: boolean; tied: boolean; noConfirmedHarm?: boolean }
  | { state: 'low-confidence' | 'insufficient-data' | 'unavailable' };

export interface PlayerMetrics {
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
  performance: number | null;
  impact: number | null;
  mistakes: number | null;
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
  source?: 'm2';
  availability?: { damage: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; flashes: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; economy: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE'; aliveContext: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' };
  limitations?: string[];
  mvp: Award;
  whoRuined: Award;
  players: Record<string, PlayerMetrics>;
  moments: AnalysisMoment[] | null;
  roundImpact: Array<{ roundId: string; players: Record<string, number> }> | null;
  insights: Record<string, { strengths: Array<'opening-duels' | 'utility-support'>; opportunities: Array<'untraded-entries'> }> | null;
  scoring?: {
    scorerVersion: string;
    configHash: string;
    model: 'V1_COMPAT' | 'SUCCESSOR';
    experimental: true;
    status: 'COMPLETED' | 'PARTIAL' | 'UNSUPPORTED' | 'INSUFFICIENT_COVERAGE';
    coverage: { score: number; rounds: number; identities: number; deaths: number; enemyDamage: number; teamDamage: number; eligible: boolean; reasons: string[] };
    warnings: string[];
    limitations: string[];
  };
}
