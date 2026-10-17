// View model. M2 is mapped explicitly by adapter.ts; ratings exist only in dev previews.
export type Award =
  | { state: 'available'; playerId: string; value: number; confidence: number }
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
  category: 'positive' | 'mistake';
  kind: 'trade' | 'flash-assist' | 'untraded-entry';
  importance: 'high' | 'medium';
  confidence: number | null;
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
}
