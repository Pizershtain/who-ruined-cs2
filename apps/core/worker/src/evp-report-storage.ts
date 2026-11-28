import type { CanonicalMatchResult, EvpReport } from '@who-ruined/contracts';
import {
  FileArtifactStore,
  encodeEvpReport,
  evpReportBinding,
  evpReportRelativePath,
  readEvpReportArtifact,
} from '@who-ruined/artifacts';
import { buildEvpReport } from '@who-ruined/scoring';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

export interface PublishedEvpReport {
  report: EvpReport;
  relativePath: string;
  sha256: string;
  bytes: number;
  publication: 'CREATED' | 'REUSED';
}

function evpStore(dataRoot: string): FileArtifactStore {
  const config = resolveWorkerRuntimeConfig();
  return new FileArtifactStore(dataRoot, {
    compressedBytes: config.maxResultCompressedBytes,
    decompressedBytes: config.maxResultJsonBytes,
    jsonDepth: config.maxResultJsonDepth,
  });
}

export async function publishEvpReport(
  dataRoot: string,
  canonical: CanonicalMatchResult,
  beforeCommit?: () => Promise<void>,
): Promise<PublishedEvpReport> {
  const binding = evpReportBinding(canonical);
  const report = buildEvpReport(canonical, binding);
  const store = evpStore(dataRoot);
  const encoded = await encodeEvpReport(report, store.limits);
  const relativePath = evpReportRelativePath(report.matchId, binding.inputDigest);
  const published = await store.publishImmutable(relativePath, encoded.bytes, beforeCommit);
  const verified = await readEvpReportArtifact(
    store,
    relativePath,
    encoded.sha256,
    canonical,
  );
  return { report: verified, ...published };
}

export async function readStoredEvpReport(
  dataRoot: string,
  relativePath: string,
  expectedSha256: string,
  canonical: CanonicalMatchResult,
): Promise<EvpReport> {
  return readEvpReportArtifact(
    evpStore(dataRoot),
    relativePath,
    expectedSha256,
    canonical,
  );
}
