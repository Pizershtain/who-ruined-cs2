import {
  ArtifactError,
  FileArtifactStore,
  assertParticipationSidecarBinding,
  assertParticipationSidecarFingerprint,
  canonicalJson,
  gzipJson,
  parseParticipationSidecar,
  participationSidecarRelativePath as artifactParticipationSidecarRelativePath,
  type ArtifactLimits,
} from '@who-ruined/artifacts';
import {
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
} from '@who-ruined/scoring';
import {
  PARTICIPATION_SIDECAR_POLICIES,
  PARTICIPATION_SIDECAR_SCHEMA_VERSION,
  type ParticipationSidecar,
} from './participation-model.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

export interface ParticipationSidecarCodecOptions {
  limits?: ArtifactLimits;
}

function sidecarLimits(options?: ParticipationSidecarCodecOptions): ArtifactLimits {
  if (options?.limits) return options.limits;
  const config = resolveWorkerRuntimeConfig();
  return {
    compressedBytes: config.maxResultCompressedBytes,
    decompressedBytes: config.maxResultJsonBytes,
    jsonDepth: config.maxResultJsonDepth,
  };
}

function errorCode(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function isExpectedPolicy(sidecar: ParticipationSidecar): boolean {
  return sidecar.model.preparedInputModel === C2S2_MODEL_VERSION
    && sidecar.model.preparedInputDigest === C2S2_POLICY_DIGEST
    && sidecar.model.referenceVersion === C2S2_REFERENCE_VERSION
    && canonicalJson(sidecar.model.policies) === canonicalJson(PARTICIPATION_SIDECAR_POLICIES);
}

export function validateParticipationSidecar(value: unknown): ParticipationSidecar {
  if (!value || typeof value !== 'object') {
    throw new Error('PARTICIPATION_SIDECAR_INVALID');
  }
  if ((value as { schemaVersion?: unknown }).schemaVersion !== PARTICIPATION_SIDECAR_SCHEMA_VERSION) {
    throw new Error('PARTICIPATION_SIDECAR_SCHEMA_MISMATCH');
  }

  let sidecar: ParticipationSidecar;
  try {
    sidecar = parseParticipationSidecar(value);
  } catch (error) {
    throw new Error('PARTICIPATION_SIDECAR_INVALID', { cause: error });
  }
  if (!isExpectedPolicy(sidecar)) {
    throw new Error('PARTICIPATION_SIDECAR_POLICY_MISMATCH');
  }
  try {
    assertParticipationSidecarFingerprint(sidecar);
  } catch (error) {
    throw new Error('PARTICIPATION_SIDECAR_INVALID', { cause: error });
  }
  return sidecar;
}

export function participationSidecarRelativePath(
  matchId: string,
  fileSha256: string,
): string {
  return artifactParticipationSidecarRelativePath(
    matchId,
    fileSha256,
    PARTICIPATION_SIDECAR_SCHEMA_VERSION,
    C2S2_POLICY_DIGEST,
  );
}

function validateBinding(
  sidecar: ParticipationSidecar,
  expected: ParticipationSidecar['binding'],
): void {
  try {
    assertParticipationSidecarBinding(sidecar, expected);
  } catch (error) {
    throw new Error('PARTICIPATION_SIDECAR_INVALID', { cause: error });
  }
}

async function readValidatedSidecar(
  store: FileArtifactStore,
  relativePath: string,
  expectedBinding: ParticipationSidecar['binding'],
): Promise<ParticipationSidecar> {
  const sidecar = validateParticipationSidecar(await store.readGzipJson(relativePath));
  validateBinding(sidecar, expectedBinding);
  return sidecar;
}

function sameSidecar(left: ParticipationSidecar, right: ParticipationSidecar): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export async function persistParticipationSidecar(
  dataRoot: string,
  value: ParticipationSidecar,
  beforeCommit?: () => Promise<void>,
  options?: ParticipationSidecarCodecOptions,
): Promise<string> {
  const sidecar = validateParticipationSidecar(value);
  const relativePath = participationSidecarRelativePath(
    sidecar.binding.matchId,
    sidecar.binding.fileSha256,
  );
  validateBinding(sidecar, sidecar.binding);
  const limits = sidecarLimits(options);
  const store = new FileArtifactStore(dataRoot, limits);

  try {
    const existing = await readValidatedSidecar(store, relativePath, sidecar.binding);
    if (sameSidecar(existing, sidecar)) return relativePath;
    throw new Error('PARTICIPATION_SIDECAR_IMMUTABLE_CONFLICT');
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'MISSING') {
      // Publication below owns the missing-file race.
    } else if (errorCode(error) === 'PARTICIPATION_SIDECAR_IMMUTABLE_CONFLICT') {
      throw error;
    } else {
      throw new Error('PARTICIPATION_SIDECAR_INVALID_EXISTING', { cause: error });
    }
  }

  let compressed: Buffer;
  try {
    compressed = await gzipJson(sidecar, limits);
  } catch (error) {
    if (
      error instanceof ArtifactError
      && (
        error.reason === 'DECOMPRESSED_LIMIT'
        || error.reason === 'COMPRESSED_LIMIT'
        || error.reason === 'DEPTH'
      )
    ) {
      throw new Error('PARTICIPATION_SIDECAR_INVALID', { cause: error });
    }
    throw error;
  }

  try {
    await store.publishImmutable(relativePath, compressed, beforeCommit);
  } catch (error) {
    if (!(error instanceof ArtifactError) || error.reason !== 'IMMUTABLE_CONFLICT') {
      throw error;
    }
  }

  let published: ParticipationSidecar;
  try {
    published = await readValidatedSidecar(store, relativePath, sidecar.binding);
  } catch (error) {
    throw new Error('PARTICIPATION_SIDECAR_INVALID_EXISTING', { cause: error });
  }
  if (!sameSidecar(published, sidecar)) {
    throw new Error('PARTICIPATION_SIDECAR_IMMUTABLE_CONFLICT');
  }
  return relativePath;
}

export async function readParticipationSidecar(
  dataRoot: string,
  relativePath: string,
  expectedBinding: ParticipationSidecar['binding'],
  options?: ParticipationSidecarCodecOptions,
): Promise<ParticipationSidecar> {
  const store = new FileArtifactStore(dataRoot, sidecarLimits(options));
  try {
    return await readValidatedSidecar(store, relativePath, expectedBinding);
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'MISSING') {
      throw new Error('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', {
        cause: error,
      });
    }
    if (errorCode(error)?.startsWith('PARTICIPATION_SIDECAR_')) throw error;
    throw new Error('PARTICIPATION_SIDECAR_INVALID', { cause: error });
  }
}
