import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { matchArtifactSchema, canonicalMatchResultSchema } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { evpReportBinding, parseEvpReport } from '@who-ruined/artifacts';
import { buildCanonicalMatchResult, buildEvpReport } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';
import { syntheticParticipationSidecar } from './fixtures/synthetic-participation-sidecar.js';
import { publishEvpReport, readStoredEvpReport } from '../src/evp-report-storage.js';

const roots: string[] = [];
const previousJsonLimit = process.env.MAX_RESULT_JSON_BYTES;

function canonical() {
  const match = syntheticValidMatch();
  const artifact = matchArtifactSchema.parse({
    schemaVersion: 'm2-artifact-1',
    match,
    analytics: computeMatchAnalytics(match),
  });
  return buildCanonicalMatchResult({
    artifact,
    sidecar: syntheticParticipationSidecar(),
    productionReports: [],
    sourceDemoRetained: false,
    createdAt: '2026-11-08T00:00:00.000Z',
  });
}

afterEach(async () => {
  if (previousJsonLimit === undefined) delete process.env.MAX_RESULT_JSON_BYTES;
  else process.env.MAX_RESULT_JSON_BYTES = previousJsonLimit;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'wrc-evp-report-'));
  roots.push(value);
  return value;
}

describe('immutable EVP report storage', () => {
  it('publishes, verifies, and reuses the same deterministic report', async () => {
    const dataRoot = await root();
    const source = canonical();
    const first = await publishEvpReport(dataRoot, source);
    const second = await publishEvpReport(dataRoot, source);

    expect(first.publication).toBe('CREATED');
    expect(second.publication).toBe('REUSED');
    expect(second.sha256).toBe(first.sha256);
    await expect(readStoredEvpReport(dataRoot, first.relativePath, first.sha256, source))
      .resolves.toEqual(first.report);
    expect(first.report.awards).toHaveLength(0);
    expect(first.report.mvpPlayerId).not.toBeNull();
    expect(first.report.awards.some((award) => award.playerId === first.report.mvpPlayerId)).toBe(false);
  });

  it('does not publish after lease fencing fails', async () => {
    const dataRoot = await root();
    const source = canonical();
    await expect(publishEvpReport(dataRoot, source, async () => {
      throw new Error('STALE_JOB_OWNER');
    })).rejects.toThrow('STALE_JOB_OWNER');
    const binding = evpReportBinding(source);
    const target = path.join(dataRoot, 'experimental', 'evp', source.artifact.match.matchId,
      `${binding.inputDigest}.evp-report@1.json.gz`);
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects checksum corruption and stale MVP/source bindings', async () => {
    const dataRoot = await root();
    const source = canonical();
    const published = await publishEvpReport(dataRoot, source);
    const originalBytes = await readFile(path.join(dataRoot, published.relativePath));
    await writeFile(path.join(dataRoot, published.relativePath), 'corrupt gzip');
    await expect(readStoredEvpReport(dataRoot, published.relativePath, published.sha256, source))
      .rejects.toMatchObject({ reason: 'CHECKSUM' });

    const changedMvp = source.activeRating.players.find((player) => (
      player.playerId !== source.activeRating.awards.mvp.playerId
    ))!.playerId;
    const staleSource = canonicalMatchResultSchema.parse({
      ...source,
      activeRating: {
        ...source.activeRating,
        awards: {
          ...source.activeRating.awards,
          mvp: { ...source.activeRating.awards.mvp, playerId: changedMvp },
        },
      },
    });
    const decoded = JSON.parse(gunzipSync(
      originalBytes,
    ).toString('utf8')) as unknown;
    expect(() => parseEvpReport(decoded, staleSource)).toThrowError(
      expect.objectContaining({ reason: 'BINDING_MISMATCH' }),
    );
  });

  it('rejects wrong schema/policy and configured output limits', async () => {
    const source = canonical();
    const report = buildEvpReport(source, evpReportBinding(source));
    expect(() => parseEvpReport({ ...report, schemaVersion: 'evp-report@0' }, source))
      .toThrowError(expect.objectContaining({ reason: 'SCHEMA_MISMATCH' }));
    expect(() => parseEvpReport({ ...report, policyId: 'other-policy' }, source))
      .toThrowError(expect.objectContaining({ reason: 'POLICY_MISMATCH' }));

    process.env.MAX_RESULT_JSON_BYTES = '64';
    await expect(publishEvpReport(await root(), source))
      .rejects.toMatchObject({ reason: 'DECOMPRESSED_LIMIT' });
  });
});
