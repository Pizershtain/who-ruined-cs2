import { createHash } from 'node:crypto';

export const C2S2_MODEL_VERSION = 'm3c8-c2-s2@1.0.0-experimental' as const;
export const C2S2_SCHEMA_VERSION = 'm3c8-c2s2-integration-1' as const;
export const C2S2_REFERENCE_VERSION = 'p5-c2-p51-s2-development-67@1' as const;
export const C2S2_P5_C2_POLICY_DIGEST = '17c0963ceb557bc3adf08487f93ab7ff1b0b591e098ddfbec2cd8921b365e41c' as const;
export const C2S2_P51_SOFT_POLICY_DIGEST = 'b909c15ff8d87633a81d15118251aa3c8dba436328cea224bbfa7bfd87de3c61' as const;

export type C2S2Scenario = 'BOMB' | 'HOSTAGE' | 'UNKNOWN';
export type C2S2Status = 'CALCULATED_RESEARCH_ONLY' | 'WITHHELD_REQUIRED_INPUT' | 'UNKNOWN_APPLICABILITY';
export type C2S2Family = 'COMBAT' | 'SUPPORT' | 'DEATH_RELATED' | 'DIRECT_HARM' | 'CONTEXT' | 'OBJECTIVES';
export type C2S2PhysicalFamily = Exclude<C2S2Family, 'CONTEXT' | 'OBJECTIVES'>;

export type C2S2EpisodeContribution = {
  anchorId: string;
  chosenAxis: string;
  family: C2S2PhysicalFamily;
  base: number;
  tags: string[];
};

type PreparedModelRow = {
  status: C2S2Status;
  reason?: string | null;
  familyContributions?: Partial<Record<C2S2Family, number>> | null;
  objectiveSignals?: Record<string, number> | null;
  episodeContributions?: C2S2EpisodeContribution[] | null;
};

export type C2S2PreparedProfile = {
  profileKey: string;
  scenario: C2S2Scenario;
  p4CPlus: PreparedModelRow;
  p4BPlus: PreparedModelRow;
};

export type C2S2CalculatedRow = {
  profileKey: string;
  status: 'CALCULATED_RESEARCH_ONLY';
  reason: null;
  modelVersion: typeof C2S2_MODEL_VERSION;
  policyDigest: string;
  rating: number;
  familyContributions: Record<C2S2Family, number>;
  factorContributions: { CONTEXT: Record<string, number>; OBJECTIVES: Record<string, number> };
  directHarm: { raw: number; soft: number; adjustment: number; transformed: boolean; k: number; a: number };
  context: { uncenteredSignal: number; saturated: boolean; winningTagByAnchor: Record<string, string> };
  objectives: { positiveCapped: boolean; negativeCapped: boolean };
  directHarmRoundAllocation: Record<string, number>;
};

export type C2S2UnavailableRow = {
  profileKey: string;
  status: Exclude<C2S2Status, 'CALCULATED_RESEARCH_ONLY'>;
  reason: string | null;
  modelVersion: typeof C2S2_MODEL_VERSION;
  policyDigest: string;
  rating: null;
  familyContributions: null;
  factorContributions: null;
  directHarm: null;
  context: null;
  objectives: null;
  directHarmRoundAllocation: null;
};

export type C2S2Row = C2S2CalculatedRow | C2S2UnavailableRow;

const contextModifiers = Object.freeze({
  OPENING: 1.05,
  TRADE: 1.04,
  FAST_TRADE: 1.06,
  MULTI_KILL: 1.03,
  DISADVANTAGE: 1.05,
  ALIVE_LEAD_TAKEN: 1.04,
  POSTPLANT: 1.03,
  FLASH_ASSIST: 1.04,
  FLASH_TEAM_KILL_WINDOW: 1.05,
  FLASH_TEAM_DAMAGE_WINDOW: 1.025,
  LOW_EQUIP_COMBAT: 1.03
});

const contextFactorBaselines = Object.freeze({
  ALIVE_LEAD_TAKEN: 0.004204405742521476,
  DISADVANTAGE: 0.008991074615790465,
  FAST_TRADE: 0.0012172778535296295,
  FLASH_ASSIST: 0.000548932129437035,
  FLASH_TEAM_DAMAGE_WINDOW: 0.0003118232209718216,
  FLASH_TEAM_KILL_WINDOW: 0.0004917459624953092,
  LOW_EQUIP_COMBAT: 0.0019294647083280213,
  MULTI_KILL: 0.003306143989342091,
  OPENING: 0.004054371146409274,
  POSTPLANT: 0.0012348161791791675,
  TRADE: 0.000661238095692258
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const C2S2_POLICY = deepFreeze({
  schemaVersion: 'm3c8-c2s2-frozen-policy-1',
  modelVersion: C2S2_MODEL_VERSION,
  referenceVersion: C2S2_REFERENCE_VERSION,
  sourceDigests: {
    p5C2Policy: C2S2_P5_C2_POLICY_DIGEST,
    p51SoftPolicyBundle: C2S2_P51_SOFT_POLICY_DIGEST
  },
  origin: 1,
  scoreScale: 0.1,
  context: {
    modifiers: contextModifiers,
    deltaScale: 1.5,
    maxMultiplier: 1.1,
    maxUncenteredSignal: 0.19999999999999998,
    factorBaselines: contextFactorBaselines
  },
  objectives: { positiveCap: 0.08, negativeHostageHarmFloor: -0.02 },
  directHarm: { method: 'SOFT_S2_LOG1P', k: 0.075, a: 0.05 }
} as const);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function c2s2PolicyDigest(): string {
  return createHash('sha256').update(JSON.stringify(canonical(C2S2_POLICY))).digest('hex');
}

export const C2S2_POLICY_DIGEST = '3c3ab8e042609295bf32cad7223a388f33876d89bcee5045bd006261cae0a744' as const;

function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${label}_MUST_BE_FINITE`);
}

export function softDirectHarmS2(raw: number): number {
  finite(raw, 'DIRECT_HARM_RAW');
  if (raw > 0) throw new RangeError('DIRECT_HARM_RAW_MUST_BE_NONPOSITIVE');
  const x = -raw;
  if (x === 0) return 0;
  const { k, a } = C2S2_POLICY.directHarm;
  if (x <= k) return -x;
  const ratio = (x - k) / a;
  const logarithm = Number.isFinite(ratio) ? Math.log1p(ratio) : Math.log(x - k + a) - Math.log(a);
  const result = -(k + a * logarithm);
  finite(result, 'DIRECT_HARM_SOFT');
  return result;
}

function roundIdFromAnchor(anchorId: string): string {
  const colon = anchorId.indexOf(':');
  return colon === -1 ? anchorId : anchorId.slice(0, colon);
}

function directHarmRoundAllocation(episodes: C2S2EpisodeContribution[], raw: number, soft: number): Record<string, number> {
  const harm = episodes.filter((episode) => episode.family === 'DIRECT_HARM' && episode.base < 0)
    .sort((left, right) => left.anchorId.localeCompare(right.anchorId));
  if (raw === 0) return {};
  if (harm.length === 0) throw new Error('DIRECT_HARM_EVIDENCE_UNAVAILABLE');
  const baseTotal = harm.reduce((total, episode) => total + episode.base, 0);
  if (!(baseTotal < 0)) throw new Error('DIRECT_HARM_EPISODES_DO_NOT_RECONSTRUCT_RAW_SIGNAL');
  const rows: Record<string, number> = {};
  let allocated = 0;
  for (const episode of harm) {
    const roundId = roundIdFromAnchor(episode.anchorId);
    const value = soft * (episode.base / baseTotal);
    rows[roundId] = (rows[roundId] ?? 0) + value;
    allocated += value;
  }
  const residual = soft - allocated;
  if (residual !== 0) {
    const firstRound = roundIdFromAnchor(harm[0]!.anchorId);
    rows[firstRound] = (rows[firstRound] ?? 0) + residual;
  }
  return Object.fromEntries(Object.entries(rows).sort(([left], [right]) => left.localeCompare(right)));
}

function calculatedFamilies(row: PreparedModelRow): Record<C2S2Family, number> {
  const result = row.familyContributions;
  if (!result) throw new Error('C2S2_MISSING_P4_FAMILIES');
  for (const family of ['COMBAT', 'SUPPORT', 'DEATH_RELATED', 'DIRECT_HARM'] as const) finite(result[family], `C2S2_${family}`);
  return {
    COMBAT: result.COMBAT!, SUPPORT: result.SUPPORT!, DEATH_RELATED: result.DEATH_RELATED!,
    DIRECT_HARM: result.DIRECT_HARM!, CONTEXT: 0, OBJECTIVES: 0
  };
}

function contextContribution(episodes: C2S2EpisodeContribution[]): C2S2CalculatedRow['context'] & { contribution: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  const winningTagByAnchor: Record<string, string> = {};
  let total = 0;
  for (const episode of episodes) {
    if (!['COMBAT', 'SUPPORT'].includes(episode.family) || !(episode.base > 0)) continue;
    const winner = episode.tags
      .filter((tag) => Object.hasOwn(contextModifiers, tag))
      .map((tag) => ({ tag, multiplier: Math.min(C2S2_POLICY.context.maxMultiplier, 1 + C2S2_POLICY.context.deltaScale * (contextModifiers[tag as keyof typeof contextModifiers] - 1)) }))
      .sort((left, right) => right.multiplier - left.multiplier || left.tag.localeCompare(right.tag))[0];
    if (!winner || winner.multiplier <= 1) continue;
    const value = episode.base * (winner.multiplier - 1);
    factors[winner.tag] = (factors[winner.tag] ?? 0) + value;
    winningTagByAnchor[episode.anchorId] = winner.tag;
    total += value;
  }
  const saturated = total > C2S2_POLICY.context.maxUncenteredSignal;
  if (saturated) {
    const factor = C2S2_POLICY.context.maxUncenteredSignal / total;
    for (const key of Object.keys(factors)) factors[key] = (factors[key] ?? 0) * factor;
    total = C2S2_POLICY.context.maxUncenteredSignal;
  }
  const centered = Object.fromEntries(Object.keys(contextFactorBaselines).map((tag) => [
    tag,
    C2S2_POLICY.scoreScale * ((factors[tag] ?? 0) - contextFactorBaselines[tag as keyof typeof contextFactorBaselines])
  ]));
  return { contribution: Object.values(centered).reduce((sum, value) => sum + value, 0), factors: centered, uncenteredSignal: total, saturated, winningTagByAnchor };
}

function objectiveContribution(signals: Record<string, number>): { contribution: number; factors: Record<string, number>; positiveCapped: boolean; negativeCapped: boolean } {
  const raw = Object.fromEntries(Object.entries(signals).map(([axis, value]) => {
    finite(value, `C2S2_OBJECTIVE_${axis}`);
    return [axis, C2S2_POLICY.scoreScale * value];
  }));
  const positive = Object.values(raw).filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = Object.values(raw).filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  const positiveCappedValue = Math.min(C2S2_POLICY.objectives.positiveCap, positive);
  const negativeCappedValue = Math.max(C2S2_POLICY.objectives.negativeHostageHarmFloor, negative);
  const factors = Object.fromEntries(Object.entries(raw).map(([axis, value]) => {
    const scale = value > 0 && positive > 0 ? positiveCappedValue / positive : value < 0 && negative < 0 ? negativeCappedValue / negative : 1;
    return [axis, value * scale];
  }));
  return {
    contribution: Object.values(factors).reduce((sum, value) => sum + value, 0), factors,
    positiveCapped: positive > positiveCappedValue,
    negativeCapped: negative < negativeCappedValue
  };
}

function objectiveSignals(profile: C2S2PreparedProfile): Record<string, number> {
  const signals = profile.p4CPlus.objectiveSignals;
  if (!signals) throw new Error('C2S2_OBJECTIVE_SIGNALS_UNAVAILABLE');
  const expected = profile.scenario === 'BOMB'
    ? ['objective:plants', 'objective:defuses']
    : ['objective:hostageRescues', 'objective:hostageHurts'];
  const actual = Object.keys(signals).sort();
  if (actual.join('|') !== [...expected].sort().join('|')) throw new Error(`C2S2_OBJECTIVE_SIGNAL_SET_MISMATCH:${profile.scenario}`);
  return signals;
}

export function scoreC2S2PreparedProfile(profile: C2S2PreparedProfile): C2S2Row {
  if (c2s2PolicyDigest() !== C2S2_POLICY_DIGEST) throw new Error('C2S2_POLICY_DIGEST_MISMATCH');
  const source = profile.p4CPlus;
  if (source.status !== 'CALCULATED_RESEARCH_ONLY') {
    return {
      profileKey: profile.profileKey, status: source.status, reason: source.reason ?? null,
      modelVersion: C2S2_MODEL_VERSION, policyDigest: C2S2_POLICY_DIGEST, rating: null,
      familyContributions: null, factorContributions: null, directHarm: null, context: null,
      objectives: null, directHarmRoundAllocation: null
    };
  }
  if (profile.scenario === 'UNKNOWN') throw new Error('C2S2_UNKNOWN_SCENARIO_MUST_NOT_BE_CALCULATED');
  if (profile.p4BPlus.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('C2S2_CONTEXT_SOURCE_UNAVAILABLE');
  const episodes = profile.p4BPlus.episodeContributions ?? [];
  const families = calculatedFamilies(source);
  const context = contextContribution(episodes);
  const objectives = objectiveContribution(objectiveSignals(profile));
  const raw = families.DIRECT_HARM;
  const soft = softDirectHarmS2(raw);
  families.CONTEXT = context.contribution;
  families.OBJECTIVES = objectives.contribution;
  families.DIRECT_HARM = soft;
  const rating = C2S2_POLICY.origin + Object.values(families).reduce((sum, value) => sum + value, 0);
  finite(rating, 'C2S2_RATING');
  return {
    profileKey: profile.profileKey, status: 'CALCULATED_RESEARCH_ONLY', reason: null,
    modelVersion: C2S2_MODEL_VERSION, policyDigest: C2S2_POLICY_DIGEST, rating,
    familyContributions: families,
    factorContributions: { CONTEXT: context.factors, OBJECTIVES: objectives.factors },
    directHarm: { raw, soft, adjustment: soft - raw, transformed: -raw > C2S2_POLICY.directHarm.k, k: C2S2_POLICY.directHarm.k, a: C2S2_POLICY.directHarm.a },
    context: { uncenteredSignal: context.uncenteredSignal, saturated: context.saturated, winningTagByAnchor: context.winningTagByAnchor },
    objectives: { positiveCapped: objectives.positiveCapped, negativeCapped: objectives.negativeCapped },
    directHarmRoundAllocation: directHarmRoundAllocation(episodes, raw, soft)
  };
}

export function scoreC2S2PreparedProfiles(profiles: C2S2PreparedProfile[]): C2S2Row[] {
  const keys = profiles.map((profile) => profile.profileKey);
  if (new Set(keys).size !== keys.length) throw new Error('C2S2_DUPLICATE_PROFILE_KEY');
  return profiles.map(scoreC2S2PreparedProfile);
}
