import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runOwnedChild } from '../src/owned-child.js';
import { parseInKillableProcess } from '../src/parser-boundary.js';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('real OS child lifecycle', () => {
  it('forcibly terminates a synchronously hung child within a bounded wall clock', async () => {
    const started = performance.now();
    const result = await runOwnedChild({ entrypoint: fixture('hang'), timeoutMs: 150, killGraceMs: 2_000 });
    const elapsed = performance.now() - started;
    expect(result.timedOut).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(2_500);
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

  it('kills its owned child when the supervisor aborts', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runOwnedChild({ entrypoint: fixture('hang'), timeoutMs: 5_000, killGraceMs: 2_000, signal: controller.signal });
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it('rejects a supervisor IPC disconnect without accepting a result', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-ipc-'));
    roots.push(root);
    await expect(parseInKillableProcess({
      dataRoot: root, rawRelative: 'uploads/unused.dem', outputRelative: 'worker-tmp/result.snapshot.json.gz',
      config: resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '1000' }), supervisorEntrypoint: fixture('silent-supervisor')
    })).rejects.toThrow('PARSE_SUPERVISOR_EXITED');
  });

  it('rejects and removes a partial child output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-partial-'));
    roots.push(root);
    const outputRelative = 'worker-tmp/result.snapshot.json.gz';
    await expect(parseInKillableProcess({
      dataRoot: root, rawRelative: 'uploads/unused.dem', outputRelative,
      config: resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '1000' }), supervisorEntrypoint: fixture('partial-supervisor')
    })).rejects.toThrow();
    await expect(access(path.join(root, ...outputRelative.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
