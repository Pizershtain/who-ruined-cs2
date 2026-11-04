import {
  matchArtifactSchema,
  matchDataSchema,
  participationSidecarSchema,
  type MatchArtifact,
  type ParticipationSidecar,
} from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { assertMatchRelations, normalizeSnapshot } from '@who-ruined/match-domain';
import {
  toNormalizationInput,
  type ParsedReplaySnapshot,
} from '@who-ruined/parser-adapter';
import {
  parseInKillableProcess,
  parseReplayInKillableProcess,
} from './parser-boundary.js';
import { buildParticipationSidecar } from './participation-sidecar.js';
import { REPLAY_SAMPLE_RATE_HZ } from './replay-artifact.js';
import type { WorkerRuntimeConfig } from './runtime-config.js';
import {
  reachOwnedStage,
  type JobFaultHooks,
} from './job-lifecycle.js';

export interface ParsedMatchPipelineResult {
  artifact: MatchArtifact;
  preparedSidecar: ParticipationSidecar;
  replaySnapshot: ParsedReplaySnapshot | null;
}

export async function runParsePipeline(options: {
  dataRoot: string;
  jobId: string;
  matchId: string;
  leaseToken: string;
  rawFilePath: string;
  fileSha256: string;
  config: WorkerRuntimeConfig;
  signal?: AbortSignal;
  hooks?: JobFaultHooks;
  assertOwned: () => Promise<void>;
  onStage: (stage: 'PARSING' | 'NORMALIZING' | 'VALIDATING' | 'FEATURIZING') => void;
}): Promise<ParsedMatchPipelineResult> {
  const reach = async (
    stage: 'PARSING' | 'NORMALIZING' | 'VALIDATING' | 'FEATURIZING',
  ): Promise<void> => {
    options.onStage(stage);
    await reachOwnedStage(
      options.jobId,
      options.leaseToken,
      stage,
      options.config,
      options.hooks,
    );
  };

  await reach('PARSING');
  const outputRelative = 'worker-tmp/' + options.jobId + '/'
    + options.leaseToken + '.snapshot.json.gz';
  const parsed = await parseInKillableProcess({
    dataRoot: options.dataRoot,
    rawRelative: options.rawFilePath,
    outputRelative,
    config: options.config,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const { snapshot, participation } = parsed;
  await options.assertOwned();

  await reach('NORMALIZING');
  const normalized = normalizeSnapshot(toNormalizationInput({
    matchId: options.matchId,
    fileSha256: options.fileSha256,
    snapshot,
  }));

  await reach('VALIDATING');
  const validated = matchDataSchema.parse(normalized);
  assertMatchRelations(validated);
  await options.assertOwned();

  let replaySnapshot: ParsedReplaySnapshot | null = null;
  if (validated.tickRate !== null && validated.rounds.length > 0) {
    try {
      const replayOutputRelative = 'worker-tmp/' + options.jobId + '/'
        + options.leaseToken + '.replay-snapshot.json.gz';
      replaySnapshot = await parseReplayInKillableProcess({
        dataRoot: options.dataRoot,
        rawRelative: options.rawFilePath,
        outputRelative: replayOutputRelative,
        replay: {
          tickRate: validated.tickRate,
          sampleRateHz: REPLAY_SAMPLE_RATE_HZ,
          rounds: validated.rounds.map(
            ({ id, ordinal, startTick, freezeEndTick, endTick }) => ({
              id,
              ordinal,
              startTick,
              freezeEndTick,
              endTick,
            }),
          ),
        },
        config: options.config,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      await options.assertOwned();
    } catch (error) {
      console.warn(JSON.stringify({
        level: 'warn',
        event: 'replay_parse_unavailable',
        code: error instanceof Error ? error.message : 'REPLAY_PARSE_FAILED',
      }));
    }
  }

  const preparedSidecar = participationSidecarSchema.parse(
    buildParticipationSidecar(
      snapshot,
      validated,
      participation,
    ),
  );
  await options.assertOwned();

  await reach('FEATURIZING');
  const analytics = computeMatchAnalytics(validated);
  const artifact = matchArtifactSchema.parse({
    schemaVersion: 'm2-artifact-1',
    match: validated,
    analytics,
  });
  return { artifact, preparedSidecar, replaySnapshot };
}
