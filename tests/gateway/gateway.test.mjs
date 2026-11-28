import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const project = `wrc-gateway-test-${randomUUID().slice(0, 8)}`;

function compose(...args) {
  return execFileSync('docker', ['compose', '-p', project, '-f', 'tests/gateway/compose.yml', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function openRequest(origin, path, options) {
  let outgoing;
  const response = new Promise((fulfill, reject) => {
    outgoing = request(origin, { ...options, path }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        fulfill({ status: incoming.statusCode, headers: incoming.headers, body, json: () => JSON.parse(body) });
      });
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(75_000, () => outgoing.destroy(new Error('Test client timed out')));
  });
  return { outgoing, response };
}

async function until(check, expected) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await check();
      if (expected(response)) return response;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error;
    }
    await delay(250);
  }
  assert.fail('Gateway condition was not observed within 15 seconds');
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  const body = response.json();
  assert.equal(body.error.code, code);
  assert.ok(body.requestId);
  assert.equal(response.headers['x-request-id'], body.requestId);
}

test('Nginx Gateway preserves public HTTP and isolates independent upstreams', async (t) => {
  t.after(() => compose('down'));
  compose('up', '--build', '-d', 'gateway', 'web', 'api');
  const origin = `http://${compose('port', 'gateway', '8080')}`;
  const send = (path, options) => {
    const { outgoing, response } = openRequest(origin, path, options);
    outgoing.end();
    return response;
  };
  const profile = '/api/v1/players/76561198000000000/profile';
  const ready = (path) => until(() => send(path), ({ status }) => status === 200);
  await ready('/healthz');
  await ready('/api/v1/health');
  await ready('/');

  await t.test('Core/Web work without Profiles, with a typed outage and subsequent recovery', async () => {
    assertError(await send(profile), 503, 'UPSTREAM_UNAVAILABLE');
    compose('up', '-d', 'profiles');
    let body = (await ready(profile)).json();
    assert.equal(body.service, 'profiles');
    body = (await send(`${profile}/matches?limit=2&cursor=a%3Db`)).json();
    assert.equal(body.target, `${profile}/matches?limit=2&cursor=a%3Db`);
    assert.equal((await send('/matches/demo/players/example')).json().service, 'web');
  });

  await t.test('Auth routes are explicit, preserve Origin and cookies, and fail independently', async () => {
    assertError(await send('/api/v1/auth/me'), 503, 'AUTH_UNAVAILABLE');
    assert.equal((await send('/api/v1/health')).status, 200);
    assert.equal((await send(profile)).status, 200);
    compose('up', '-d', 'auth');
    await ready('/api/v1/auth/me');
    const headers = { Origin: origin, Cookie: 'fixture_auth=synthetic', 'X-Real-IP': '192.0.2.42' };
    for (const route of ['login', 'refresh', 'logout']) {
      const result = await send(`/api/v1/auth/${route}?echoHeaders`, { method: 'POST', headers });
      assert.equal(result.status, 200);
      assert.equal(result.json().headers.origin, origin);
      assert.equal(result.json().headers.cookie, headers.Cookie);
      assert.notEqual(result.json().headers.realIp, headers['X-Real-IP']);
      assert.deepEqual(result.headers['set-cookie'], ['fixture_auth=synthetic; HttpOnly; SameSite=Strict; Path=/']);
    }
    const core = await send('/api/v1/matches?echoHeaders', { headers });
    assert.equal(core.json().headers.cookie, null);
    for (const path of ['health', 'ready', 'register', 'dev-user', 'login']) assertError(await send('/api/v1/auth/' + path), 404, 'NOT_FOUND');
    assertError(await send('/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Length': 4097 } }), 413, 'SIZE_LIMIT');
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const link = await send('/api/v1/auth/player-link?echoHeaders', { method, headers: { Origin: origin } });
      assert.equal(link.status, 200);
      assert.equal(link.json().method, method);
      assert.equal(link.json().headers.origin, origin);
    }
    for (const method of ['POST', 'PATCH', 'OPTIONS']) {
      assertError(await send('/api/v1/auth/player-link', { method }), 404, 'NOT_FOUND');
    }
  });

  await t.test('allowed routes preserve method, query, encoded IDs, typed errors and bytes', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/matches?cursor=next'],
      ['GET', '/api/v1/jobs/job-1'],
      ['GET', '/api/v1/matches/match-1/replay/rounds/round%3A1?version=2'],
      ['GET', '/api/v1/matches/match-1/players/player:1/report'],
      ['POST', '/api/v1/matches/match-1/rescore'],
      ['DELETE', '/api/v1/matches/match-1'],
      ['OPTIONS', '/api/v1/matches/match-1/rescore'],
    ]) {
      const { status, json } = await send(path, { method });
      assert.equal(status, 200, `${method} ${path}`);
      assert.deepEqual(json(), { service: 'core', target: path.replace('%3A', ':'), method });
    }
    assert.equal((await send(profile, { method: 'HEAD' })).body.length, 0);
    assertError(await send('/api/v1/matches?typed'), 422, 'FIXTURE_ERROR');
    assertError(await send('/api/v1/matches?typed=unavailable'), 503, 'FIXTURE_ERROR');
    assert.deepEqual((await send('/api/v1/matches/match-1/replay?bytes')).body, Buffer.from([0x00, 0x29, 0xfe, 0xff]));
  });

  await t.test('API dispatch is fail closed for private, ambiguous, unknown and wrong-method paths', async () => {
    for (const path of [
      '/api/v1/internal/match-publications',
      '/api/v1/internal/match-publications/example',
      '/api/v1/unknown',
      '/api/v1/matches/one/unknown',
      '/api/v1//matches',
      '/api/v1/%69nternal/match-publications',
      '/api/v1/internal%2Fmatch-publications',
      '/api/v1/matches/../internal/match-publications',
      '/api/v1/matches/%2e%2e/internal/match-publications',
      '/api/v1/matches/../../../',
      '/API/v1/internal/match-publications',
      '/api/docs',
    ]) {
      const reply = await send(path, { headers: { Authorization: 'Bearer synthetic' } });
      assert.ok([400, 404].includes(reply.status), path);
      assert.equal(reply.headers['content-type'], 'application/json', path);
    }
    assertError(await send(profile, { method: 'POST' }), 404, 'NOT_FOUND');
  });

  await t.test('forwarded headers are generated by Gateway and cross-origin is preserved', async () => {
    const path = '/api/v1/matches?echoHeaders';
    const upstream = await send(path, { headers: {
      Origin: origin,
      Forwarded: 'for=synthetic',
      'X-Forwarded-For': 'synthetic',
      'X-Real-IP': 'synthetic',
      'X-Request-ID': 'synthetic',
    } });
    const { headers } = upstream.json();
    assert.equal(headers.origin, null);
    assert.equal(headers.forwarded, null);
    assert.notEqual(headers.forwardedFor, 'synthetic');
    assert.equal(headers.forwardedFor, headers.realIp);
    assert.equal(headers.requestId, upstream.headers['x-request-id']);
    assert.equal((await send(path, { headers: { Origin: 'https://other.example' } })).json().headers.origin, 'https://other.example');
  });

  await t.test('streams large incomplete uploads, cancels on disconnect and rejects oversized bodies', async () => {
    const path = '/api/v1/matches';
    const readProgress = () => send('/api/v1/health?uploadStatus');
    const size = 8 * 1024 * 1024;
    const partial = openRequest(origin, path, { method: 'POST', headers: { 'Content-Length': size } });
    partial.outgoing.write(Buffer.alloc(1024));
    await until(readProgress, (response) => response.json().startedUploads === 1);
    partial.outgoing.end(Buffer.alloc(size - 1024));
    const accepted = await partial.response;
    assert.equal(accepted.status, 202);
    assert.equal(accepted.json().receivedBytes, size);

    const cancelled = openRequest(origin, path, { method: 'POST' });
    cancelled.outgoing.write(Buffer.alloc(1024));
    const rejected = assert.rejects(cancelled.response);
    await until(readProgress, (response) => response.json().startedUploads === 2);
    cancelled.outgoing.destroy();
    await rejected;
    await until(readProgress, (response) => response.json().abortedUploads === 1);

    assertError(await send(path, { method: 'POST', headers: { 'Content-Length': 2050 * 1024 * 1024 } }), 413, 'SIZE_LIMIT');
    assert.equal((await readProgress()).json().startedUploads, 2);
  });

  await t.test('Core outage leaves Profiles and Gateway live, and Core recovers', async () => {
    compose('stop', 'api');
    assertError(await send('/api/v1/matches'), 503, 'UPSTREAM_UNAVAILABLE');
    assert.equal((await send(profile)).status, 200);
    assert.equal((await send('/healthz')).status, 200);
    compose('up', '-d', 'api');
    await ready('/api/v1/health');
  });

  await t.test('Gateway returns a typed 504 when the upstream is silent past the read timeout', async () => {
    assertError(await send('/api/v1/health?stall'), 504, 'UPSTREAM_TIMEOUT');
  });
});
