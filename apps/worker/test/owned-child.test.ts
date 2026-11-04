import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { getEventListeners } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runOwnedChild } from '../src/owned-child.js';
import {
  parseInKillableProcess,
  resolveParserChildLaunch,
} from '../src/parser-boundary.js';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('real OS child lifecycle', () => {
  it('launches TypeScript child entrypoints through the explicit tsx hook', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-ts-child-'));
    roots.push(root);
    const entrypoint = path.join(root, 'child.ts');
    await writeFile(entrypoint, 'const exitCode: number = 0; process.exitCode = exitCode;\n');

    const result = await runOwnedChild({
      entrypoint,
      nodeArguments: ['--import', 'tsx'],
      timeoutMs: 2_000,
      killGraceMs: 2_000,
    });

    expect(result).toMatchObject({ code: 0, timedOut: false, aborted: false });
  });

  it('selects TypeScript in dev and JavaScript in compiled worker builds', () => {
    const source = resolveParserChildLaunch(pathToFileURL(path.join(
      os.tmpdir(),
      'apps/worker/src/parser-boundary.ts',
    )).href);
    const compiled = resolveParserChildLaunch(pathToFileURL(path.join(
      os.tmpdir(),
      'apps/worker/dist/parser-boundary.js',
    )).href);

    expect(source.entrypoint).toMatch(/[\\/]src[\\/]parser-child\.ts$/);
    expect(source.nodeArguments).toEqual(['--import', 'tsx']);
    expect(compiled.entrypoint).toMatch(/[\\/]dist[\\/]parser-child\.js$/);
    expect(compiled.nodeArguments).toEqual([]);
  });

  it('forcibly terminates a synchronously hung child within a bounded wall clock', async () => {
    const controller = new AbortController();
    const started = performance.now();
    const result = await runOwnedChild({ entrypoint: fixture('hang'), timeoutMs: 150, killGraceMs: 2_000, signal: controller.signal });
    const elapsed = performance.now() - started;
    expect(result.timedOut).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(2_500);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    await expect(access(fixture('hang'))).resolves.toBeUndefined();
  });

  it('does not accept a child that would return just after the deadline', async () => {
    const result = await runOwnedChild({ entrypoint: fixture('late-success'), args: ['250'], timeoutMs: 100, killGraceMs: 2_000 });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it.each(['exit-one', 'throw'])('reports nonzero completion for %s', async (name) => {
    const result = await runOwnedChild({ entrypoint: fixture(name), timeoutMs: 2_000, killGraceMs: 2_000 });
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
  });

  it('kills its owned child when the owner aborts', async () => {
    const controller = new AbortController();
    const pending = runOwnedChild({ entrypoint: fixture('hang'), timeoutMs: 5_000, killGraceMs: 2_000, signal: controller.signal });
    queueMicrotask(() => controller.abort());
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it.each([
    ['success', 'late-success', ['0']],
    ['nonzero exit', 'exit-one', []],
  ])('removes the owner abort listener after %s', async (_case, name, args) => {
    const controller = new AbortController();
    await runOwnedChild({
      entrypoint: fixture(name),
      args,
      timeoutMs: 2_000,
      killGraceMs: 2_000,
      signal: controller.signal,
    });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('does not install lifecycle resources when spawn rejects synchronously', async () => {
    const controller = new AbortController();
    await expect(runOwnedChild({
      entrypoint: '\0',
      timeoutMs: 2_000,
      killGraceMs: 2_000,
      signal: controller.signal,
    })).rejects.toThrow();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('does not accumulate owner listeners across sequential runs', async () => {
    const controller = new AbortController();
    for (let index = 0; index < 10; index += 1) {
      await runOwnedChild({
        entrypoint: fixture('late-success'),
        args: ['0'],
        timeoutMs: 2_000,
        killGraceMs: 2_000,
        signal: controller.signal,
      });
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    }
  });

  it('terminates the parser child when the parse timeout expires', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-ipc-'));
    roots.push(root);
    await expect(parseInKillableProcess({
      dataRoot: root, rawRelative: 'uploads/unused.dem', outputRelative: 'worker-tmp/result.snapshot.json.gz',
      config: resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '100' }), childEntrypoint: fixture('hang')
    })).rejects.toThrow('PARSE_TIMEOUT');
  });

  it('terminates the parser child when the owning attempt is aborted', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-abort-'));
    roots.push(root);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(parseInKillableProcess({
      dataRoot: root, rawRelative: 'uploads/unused.dem', outputRelative: 'worker-tmp/result.snapshot.json.gz',
      config: resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '5000' }),
      signal: controller.signal,
      childEntrypoint: fixture('hang')
    })).rejects.toThrow('STALE_JOB_OWNER');
  });

  it('rejects and removes a partial child output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-partial-'));
    roots.push(root);
    const outputRelative = 'worker-tmp/partial.snapshot.json.gz';
    await expect(parseInKillableProcess({
      dataRoot: root, rawRelative: 'uploads/unused.dem', outputRelative,
      config: resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '1000' }), childEntrypoint: fixture('artifact-child')
    })).rejects.toThrow();
    await expect(access(path.join(root, ...outputRelative.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
