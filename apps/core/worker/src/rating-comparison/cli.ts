import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import type { C2S2PreparedSidecar } from '@who-ruined/contracts';
import { NORMALIZER_VERSION, PARSER_LIBRARY_VERSION } from '@who-ruined/parser-adapter';
import { COVERAGE, COVERAGE_VERSION, H3_FAMILIES, H3_POLICY, H3_POLICY_DIGEST, NORMALIZED_FACT_MAP,
  projectH3, researchDigest, type JointEvidence } from '@who-ruined/scoring/h3';

import { inventory, prepareDemoEvidence, readNormalizedDemo, type ResearchDemoSource } from './demo-input.js';
import { countBy, distribution } from './statistics.js';

type Binding = { relativePath: string; sha256: string; status: 'EVALUATED' | 'UNSUPPORTED'; digest: string | null; reason: string | null };
export const researchBaselinePolicyDigest = '634309c1182b605726230f72af08e8b81f7feb58ea27a2eeb3e86821f7fd1e49';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readBaseline(path: string): Promise<Map<string, Binding>> {
  const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!record(saved) || saved.schemaVersion !== 'h3-real-demo-evaluation@1' || saved.policyDigest !== researchBaselinePolicyDigest
    || saved.parserVersion !== PARSER_LIBRARY_VERSION || saved.normalizerVersion !== NORMALIZER_VERSION
    || !Array.isArray(saved.manifest) || saved.manifest.length === 0) throw new Error('H3 baseline version or policy binding mismatch');
  const rows = new Map<string, Binding>();
  for (const row of saved.manifest as unknown[]) {
    if (!record(row) || typeof row.relativePath !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
      || (row.status !== 'EVALUATED' && row.status !== 'UNSUPPORTED')
      || (row.status === 'EVALUATED' && (typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest) || row.reason !== null))
      || (row.status === 'UNSUPPORTED' && (row.digest !== null || typeof row.reason !== 'string'))
      || rows.has(row.relativePath)) throw new Error('Invalid H3 baseline manifest row');
    rows.set(row.relativePath, { relativePath: row.relativePath, sha256: row.sha256, status: row.status,
      digest: row.digest as string | null, reason: row.reason as string | null });
  }
  return rows;
}

export function compareBinding(current: Binding, expected: Binding): void {
  if (current.relativePath !== expected.relativePath || current.sha256 !== expected.sha256) throw new Error('H3 baseline demo binding mismatch');
  if (current.status !== expected.status || current.digest !== expected.digest || current.reason !== expected.reason) {
    throw new Error('H3 baseline result digest or applicability mismatch');
  }
}

function auditUnresolvedDeaths(
  data: JointEvidence,
  result: ReturnType<typeof projectH3>,
  roundEvidence: C2S2PreparedSidecar['roundEvidence'],
) {
  return result.actionLedger.filter((row) => row.reason === 'EXACT_DEATH_ANCHOR_UNAVAILABLE').map((row) => {
    const profile = data.profiles.find((p) => p.playerId === row.playerId)!;
    const rawBoundary = roundEvidence.find((r) => r.roundId === row.roundId);
    const events = row.evidenceIds.map((id) => {
      const event = data.match.events.find((e) => e.id === id);
      return { id, tick: event?.tick ?? null, phase: event?.context?.phase ?? null };
    });
    const summarize = (variant: typeof profile.prepared.p4BPlus) => ({
      status: variant.status, deathFamilyInput: variant.familyContributions?.DEATH_RELATED ?? null,
      anchor: (variant.episodeContributions ?? []).filter((e) => e.anchorId === row.anchorId)
        .map(({ chosenAxis, family, base }) => ({ chosenAxis, family, base })),
      deathAnchorsInRound: (variant.episodeContributions ?? []).filter((e) => e.chosenAxis === 'ownDeaths'
        && data.match.events.some((fact) => fact.id === e.anchorId && fact.roundId === row.roundId))
        .map(({ anchorId, base }) => ({ anchorId, base })),
    });
    return {
      profileKey: profile.profileKey, roundId: row.roundId, anchorId: row.anchorId, events,
      countedRound: row.roundId !== null && profile.countedRoundIds.includes(row.roundId),
      scoringWindow: rawBoundary ? {
        clean: rawBoundary.clean, reasons: rawBoundary.reasons,
        liveStart: rawBoundary.boundary.liveStart ?? null, liveEnd: rawBoundary.boundary.liveEnd ?? null,
        terminalSource: rawBoundary.boundary.terminalSource ?? null,
      } : null,
      p4BPlus: summarize(profile.prepared.p4BPlus), p4CPlus: summarize(profile.prepared.p4CPlus),
    };
  });
}

function compareDemo(root: string, source: ResearchDemoSource, againstResearch: boolean) {
  const path = join(root, source.relativePath);
  const normalized = readNormalizedDemo(path, source);
  const { match } = normalized;
  const kinds = countBy(match.events.map((event) => event.kind));
  const meta = { map: match.map, rounds: match.rounds.length, normalizedEvents: kinds,
    players: match.players.length, rosterSizes: match.teams.map((team) => team.playerIds.length) };
  const binding = { relativePath: source.relativePath, sha256: source.sha256 };
  if (meta.players !== 10 || meta.rosterSizes.length !== 2 || meta.rosterSizes.some((size) => size !== 5)) {
    return { ...source, ...meta, binding: { ...binding, status: 'UNSUPPORTED' as const, digest: null, reason: 'UNSUPPORTED_5V5_ROSTER' }, comparison: null };
  }
  const { data, scenario, roundEvidence } = prepareDemoEvidence(path, normalized);
  if (meta.rounds <= 1 || data.baseline.every((row) => row.rating === null)) {
    return { ...source, ...meta, scenario, binding: { ...binding, status: 'UNSUPPORTED' as const, digest: null, reason: 'INSUFFICIENT_VERIFIED_ROUNDS_OR_ELIGIBILITY' }, comparison: null };
  }
  const h3 = projectH3(data);
  const players = h3.players.map((row, index) => {
    const h2 = data.baseline[index]!;
    if (row.playerId !== h2.playerId || row.teamId !== h2.teamId || row.status !== h2.status || (row.rating === null) !== (h2.rating === null)) {
      throw new Error('H3 eligibility or player binding drift');
    }
    if (row.finalAttribution !== null && row.rating !== null) {
      const sum = H3_FAMILIES.reduce((total, family) => total + (row.finalAttribution![family] ?? 0), 1);
      if (!Number.isFinite(sum) || Math.abs(sum - row.rating) > 1e-12) throw new Error('H3 rating attribution does not reconstruct');
    }
    return { profileKey: row.profileKey, status: row.status, countedRounds: row.countedRoundIds.length,
      h2: h2.rating, h3: row.rating, delta: row.rating === null || h2.rating === null ? null : row.rating - h2.rating,
      familyInputs: row.rawFamilyInputs, finalAttribution: row.finalAttribution, roundImpact: row.roundImpact };
  });
  const productionDigest = researchDigest(h3);
  const digest = againstResearch ? researchDigest({
    ...h3, schemaVersion: 'h3-seven-family@1-research', policyDigest: researchBaselinePolicyDigest,
  }) : productionDigest;
  return { ...source, ...meta, scenario, binding: { ...binding, status: 'EVALUATED' as const, digest, reason: null },
    comparison: { players, productionDigest, unresolvedTrades: auditUnresolvedDeaths(data, h3, roundEvidence) } };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { baseline: { type: 'string' }, help: { type: 'boolean' } } });
  const usage = 'Usage: pnpm rating:compare <demo-root> <new-report.json> [--baseline <e8-report.json>]';
  if (values.help) { process.stdout.write(`${usage}\n`); return; }
  const [input, output] = positionals;
  if (!input || !output || positionals.length !== 2) throw new Error(usage);
  const root = resolve(input);
  const baseline = values.baseline ? await readBaseline(resolve(values.baseline)) : null;
  const files = await inventory(root);
  if (baseline && (files.length !== baseline.size || files.some((file) => baseline.get(file.relativePath)?.sha256 !== file.sha256))) {
    throw new Error('H3 baseline corpus files or their SHA-256 values differ');
  }
  const manifest = [];
  for (const file of files) {
    const row = compareDemo(root, file, baseline !== null);
    if (baseline) {
      try { compareBinding(row.binding, baseline.get(file.relativePath)!); }
      catch (error) { throw new Error(`Baseline mismatch for ${file.relativePath}`, { cause: error }); }
    }
    manifest.push(row);
    process.stderr.write(`${manifest.length}/${files.length} ${row.binding.status} ${row.map ?? '?'}\n`);
  }
  const comparable = manifest.flatMap((row) => row.comparison?.players.filter((p) => p.h2 !== null && p.h3 !== null) ?? []);
  if (!comparable.length) throw new Error('No eligible comparisons in the corpus');
  const observedKinds = [...new Set(manifest.flatMap((row) => Object.keys(row.normalizedEvents)))].sort();
  const summary = { status: countBy(manifest.map((row) => row.binding.status)),
    baselineMatched: baseline ? manifest.length : null, observedKinds,
    unclassifiedKinds: observedKinds.filter((kind) => !Object.hasOwn(NORMALIZED_FACT_MAP, kind)),
    coverageStatuses: countBy(Object.values(COVERAGE).map((row) => row[1])),
    h2: distribution(comparable.map((row) => row.h2!)), h3: distribution(comparable.map((row) => row.h3!)),
    delta: distribution(comparable.map((row) => row.delta!)),
    unresolvedTrades: manifest.reduce((n, row) => n + (row.comparison?.unresolvedTrades.length ?? 0), 0) };
  await writeFile(resolve(output), `${JSON.stringify({ schemaVersion: 'h2-h3-comparison@1', generatedAt: new Date().toISOString(),
    parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION, policy: H3_POLICY, policyDigest: H3_POLICY_DIGEST,
    coverageVersion: COVERAGE_VERSION, summary, manifest }, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.unclassifiedKinds.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
