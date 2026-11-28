import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseEquipmentInKillableProcess,
  parseInKillableProcess,
  parseReplayInKillableProcess,
} from '../src/parser-boundary.js';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), 'wrc-parser-boundary-'));
  roots.push(value);
  return value;
}

function config(overrides: NodeJS.ProcessEnv = {}) {
  return resolveWorkerRuntimeConfig({
    PARSE_TIMEOUT_MS: '2000',
    CHILD_KILL_GRACE_MS: '1000',
    MAX_PARSE_ARTIFACT_BYTES: '1048576',
    MAX_PARSE_ARTIFACT_OUTPUT_BYTES: '4194304',
    ...overrides,
  });
}

async function parse(
  outputRelative: string,
  overrides: NodeJS.ProcessEnv = {},
) {
  return parseInKillableProcess({
    dataRoot: await root(),
    rawRelative: 'uploads/synthetic.dem',
    outputRelative,
    config: config(overrides),
    childEntrypoint: fixture('artifact-child'),
  });
}

describe('isolated parser artifact boundary', () => {
  it('identifies the equipment-only capability failure without weakening the primary parse boundary', async () => {
    const options = {
      dataRoot: await root(), rawRelative: 'uploads/synthetic.dem', config: config(),
      childEntrypoint: fixture('artifact-child'),
    };
    await expect(parseEquipmentInKillableProcess({
      ...options, outputRelative: 'worker-tmp/optional-equipment-unavailable.equipment-snapshot.json.gz', ticks: [1],
    })).rejects.toThrow('EQUIPMENT_SOURCE_UNAVAILABLE');
    await expect(parseInKillableProcess({
      ...options, outputRelative: 'worker-tmp/optional-equipment-unavailable.snapshot.json.gz',
    })).rejects.toThrow('PARSE_FAILED');
  });

  it('keeps native parser entrypoints out of the worker and preparation parents', async () => {
    const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
    const parentFiles = [
      path.join(sourceRoot, 'parse-pipeline.ts'),
      path.join(sourceRoot, 'participation-sidecar.ts'),
      path.join(sourceRoot, 'prepared-participation-input.ts'),
      path.join(sourceRoot, 'prepare-participation.ts'),
      fileURLToPath(new URL(
        '../../api/src/infrastructure/local-demo-files.ts',
        import.meta.url,
      )),
    ];
    const forbidden = /\b(?:loadNativeParser|parseHeader|parseDemoSnapshot|parseDemoMatchSnapshot)\b/;
    const violations = [];
    for (const file of parentFiles) {
      if (forbidden.test(await readFile(file, 'utf8'))) violations.push(file);
    }
    expect(violations).toEqual([]);
  });

  it('preserves lifecycle and hostage row order, including equal ticks', async () => {
    const value = await parse('worker-tmp/valid-envelope.snapshot.json.gz');

    expect(value.participation.evidence.lifecycleRows.map((row) => row.event_name))
      .toEqual(['player_spawn', 'player_disconnect']);
    expect(value.participation.prepared.lifecycleRows.map((row) => row.event_name))
      .toEqual(['player_team', 'player_spawn']);
    expect(value.participation.prepared.hostageRows.map((row) => row.event_name))
      .toEqual(['hostage_hurt']);
  });

  it('supports explicit empty supplemental rows', async () => {
    await expect(parse('worker-tmp/empty-supplement.snapshot.json.gz'))
      .resolves.toMatchObject({
        participation: {
          evidence: { lifecycleEventNames: [], lifecycleRows: [] },
          prepared: { lifecycleRows: [], hostageRows: [] },
        },
      });
  });

  it.each(['missing-supplement', 'invalid-supplement'])(
    'rejects %s instead of inventing empty evidence',
    async (kind) => {
      await expect(parse(`worker-tmp/${kind}.snapshot.json.gz`))
        .rejects.toThrow('PARSE_CHILD_OUTPUT_INVALID');
    },
  );

  it('rejects compressed output before reading beyond the configured bound', async () => {
    await expect(parse(
      'worker-tmp/oversized-compressed.snapshot.json.gz',
      { MAX_PARSE_ARTIFACT_BYTES: '64' },
    )).rejects.toThrow('PARSE_CHILD_OUTPUT_INVALID');
  });

  it('rejects decompressed output independently of the compressed limit', async () => {
    await expect(parse(
      'worker-tmp/oversized-output.snapshot.json.gz',
      { MAX_PARSE_ARTIFACT_OUTPUT_BYTES: '128' },
    )).rejects.toThrow('PARSE_CHILD_OUTPUT_INVALID');
  });

  it.each(['malformed-gzip', 'truncated-gzip', 'corrupt-json'])(
    'rejects controlled %s output',
    async (kind) => {
      await expect(parse(`worker-tmp/${kind}.snapshot.json.gz`))
        .rejects.toThrow('PARSE_CHILD_OUTPUT_INVALID');
    },
  );

  it('removes a partial artifact after child failure', async () => {
    const dataRoot = await root();
    const outputRelative = 'worker-tmp/partial.snapshot.json.gz';
    await expect(parseInKillableProcess({
      dataRoot,
      rawRelative: 'uploads/synthetic.dem',
      outputRelative,
      config: config(),
      childEntrypoint: fixture('artifact-child'),
    })).rejects.toThrow('PARSE_FAILED');
    await expect(access(path.join(dataRoot, ...outputRelative.split('/'))))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a child temporary artifact after timeout', async () => {
    const dataRoot = await root();
    const outputRelative = 'worker-tmp/partial-temp.snapshot.json.gz';
    await expect(parseInKillableProcess({
      dataRoot,
      rawRelative: 'uploads/synthetic.dem',
      outputRelative,
      config: config({ PARSE_TIMEOUT_MS: '100' }),
      childEntrypoint: fixture('artifact-child'),
    })).rejects.toThrow('PARSE_TIMEOUT');
    const outputPath = path.join(dataRoot, ...outputRelative.split('/'));
    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${outputPath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps replay parsing behind the same bounded child lifecycle', async () => {
    await expect(parseReplayInKillableProcess({
      dataRoot: await root(),
      rawRelative: 'uploads/synthetic.dem',
      outputRelative: 'worker-tmp/valid-replay.replay-snapshot.json.gz',
      replay: {
        tickRate: 64,
        sampleRateHz: 4,
        rounds: [{ id: 'round-1', ordinal: 1, startTick: 100, freezeEndTick: 110, endTick: 140 }],
      },
      config: config(),
      childEntrypoint: fixture('artifact-child'),
    })).resolves.toMatchObject({
      schemaVersion: 'parser-replay-snapshot@1',
      rows: [{ tick: 100, steamid: 'a' }],
    });
  });
});
