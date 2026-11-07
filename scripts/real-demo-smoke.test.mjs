import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runRealDemoSmoke } from './real-demo-smoke.mjs';

const MATCH_ID = 'synthetic-smoke-match';
const FAMILIES = ['COMBAT', 'SUPPORT', 'DEATH_RELATED', 'OBJECTIVES', 'CONTEXT', 'DIRECT_HARM'];

function runSmokeCli(argumentsList) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve('scripts/real-demo-smoke.mjs'), ...argumentsList], {
      cwd: resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('close', (code) => resolveRun({ code, stderr, stdout }));
  });
}

function fullFixture() {
  const teams = ['team-a', 'team-b'].map((id, teamIndex) => ({
    id,
    label: id,
    playerIds: Array.from({ length: 5 }, (_, index) => `player-${teamIndex * 5 + index + 1}`),
  }));
  const players = teams.flatMap((team) => team.playerIds.map((id) => ({ id, teamId: team.id, displayName: id })));
  const round = {
    id: 'round-1', ordinal: 1, startTick: 100, freezeEndTick: 120, endTick: 1000,
    isValid: true,
  };
  const match = {
    matchId: MATCH_ID,
    map: 'de_dust2',
    quality: 'VALID',
    teams,
    players,
    rounds: [round],
    events: [{ id: 'event-1', roundId: round.id }],
  };
  const attribution = Object.fromEntries(FAMILIES.map((family) => [family, 0]));
  const ratingPlayers = players.map((player, index) => ({
    playerId: player.id,
    teamId: player.teamId,
    availability: { status: 'CALCULATED_RESEARCH_ONLY', reason: null },
    rating: {
      value: 1,
      rank: index + 1,
      finalAttribution: attribution,
      arithmetic: { origin: 1, reconstructed: 1, tolerance: 1e-12, exactWithinTolerance: true },
    },
  }));
  const rating = {
    matchId: MATCH_ID,
    match: {
      map: match.map,
      quality: match.quality,
      totalRounds: match.rounds.length,
      teams: teams.map((team) => ({ teamId: team.id, score: 1 })),
    },
    players: ratingPlayers,
    ordering: players.map((player) => player.id),
    losingTeamOrdering: teams[1].playerIds,
    awards: { eligiblePoolSize: 10 },
  };
  const explanation = {
    matchId: MATCH_ID,
    players: players.map((player) => ({
      playerId: player.id,
      teamId: player.teamId,
      availability: { status: 'CALCULATED_RESEARCH_ONLY', reason: null },
      rating: {
        value: 1,
        arithmetic: { origin: 1, reconstructed: 1, tolerance: 1e-12, exactWithinTolerance: true },
        families: FAMILIES.map((family) => ({
          family, rawInput: 0, finalAttribution: 0, sources: [], transformations: [],
        })),
      },
      importantMoments: [],
    })),
    importantMoments: [],
  };
  const replay = {
    matchId: MATCH_ID,
    availability: 'AVAILABLE',
    reason: null,
    map: match.map,
    calibration: { id: 'verified-calibration' },
    players: players.map((player) => ({ id: player.id, teamId: player.teamId, displayName: player.displayName })),
    teams,
    rounds: [{ ...round, sampleCount: 2, eventCount: 1, coverage: 'COMPLETE' }],
    totalFrames: 2,
    totalCompressedBytes: 100,
  };
  const replayRound = {
    binding: { matchId: MATCH_ID },
    round,
    frames: [{ tick: 100, states: [] }, { tick: 200, states: [] }],
    events: [{ id: 'event-1' }],
  };
  return { explanation, match, rating, replay, replayRound };
}

async function withMockApi(fixture, callback) {
  const server = createServer((request, response) => {
    request.resume();
    const url = new URL(request.url, 'http://127.0.0.1');
    let status = 200;
    let body;
    if (request.method === 'POST' && url.pathname === '/api/v1/matches') {
      body = { matchId: MATCH_ID, jobId: 'parse-job' };
    } else if (request.method === 'POST' && url.pathname === `/api/v1/matches/${MATCH_ID}/rescore`) {
      body = { matchId: MATCH_ID, jobId: 'rescore-job' };
    } else if (url.pathname === '/api/v1/jobs/parse-job') {
      body = { id: 'parse-job', matchId: MATCH_ID, status: 'COMPLETED', stage: 'COMPLETED' };
    } else if (url.pathname === '/api/v1/jobs/rescore-job') {
      body = { id: 'rescore-job', matchId: MATCH_ID, status: 'COMPLETED', stage: 'COMPLETED' };
    } else if (url.pathname === `/api/v1/matches/${MATCH_ID}`) {
      body = fixture.match;
    } else if (url.pathname === `/api/v1/matches/${MATCH_ID}/experimental-participation-rating`) {
      status = fixture.ratingStatus ?? 200;
      body = fixture.rating;
    } else if (url.pathname === `/api/v1/matches/${MATCH_ID}/experimental-participation-explanation`) {
      status = fixture.explanationStatus ?? 200;
      body = fixture.explanation;
    } else if (url.pathname === `/api/v1/matches/${MATCH_ID}/replay`) {
      body = fixture.replay;
    } else if (url.pathname === `/api/v1/matches/${MATCH_ID}/replay/rounds/round-1`) {
      body = fixture.replayRound;
    } else {
      status = 404;
      body = { error: { code: 'NOT_FOUND' } };
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
}

test('full smoke rejects successful empty H2 and unavailable replay responses', async () => {
  const fixture = fullFixture();
  fixture.rating.players = [];
  fixture.rating.ordering = [];
  fixture.rating.awards.eligiblePoolSize = 0;
  fixture.explanation.players = [];
  fixture.replay = {
    ...fixture.replay,
    availability: 'REPLAY_UNAVAILABLE',
    reason: 'REPLAY_UNAVAILABLE',
    calibration: null,
    rounds: [],
    totalFrames: 0,
    totalCompressedBytes: 0,
  };

  await withMockApi(fixture, async (api) => {
    const result = await runSmokeCli([`--match=${MATCH_ID}`, `--api=${api}`]);
    assert.equal(result.code, 1, `False-pass fixture unexpectedly exited 0: ${result.stdout}`);
    assert.match(result.stderr, /Rating\/player binding mismatch|Expected replay availability AVAILABLE/u);
  });
});

test('full smoke accepts bound H2, explanation and replay before and after RESCORE', async () => {
  const root = resolve(`.real-demo-smoke-${randomUUID()}`);
  const demo = join(root, 'synthetic.dem');
  try {
    await mkdir(root, { recursive: true });
    await writeFile(demo, 'synthetic test bytes');
    await withMockApi(fullFixture(), async (api) => {
      const result = await runRealDemoSmoke([`--demo=${demo}`, `--api=${api}`, '--timeout-ms=1000']);
      assert.equal(result.beforeRescore.calculatedRatings, 10);
      assert.equal(result.afterRescore.replayFrames, 2);
      assert.equal(result.rescoreJob.status, 'COMPLETED');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--match validates persisted results without upload or RESCORE', async () => {
  await withMockApi(fullFixture(), async (api) => {
    const result = await runRealDemoSmoke([`--match=${MATCH_ID}`, `--api=${api}`]);
    assert.equal(result.parseJob, null);
    assert.equal(result.rescoreJob, null);
    assert.equal(result.afterRescore.calculatedRatings, 10);
  });
});

test('explicit UNSUPPORTED semantics accept typed H2 unavailability without inventing zero results', async () => {
  const fixture = {
    match: {
      matchId: MATCH_ID,
      map: null,
      quality: 'UNSUPPORTED',
      teams: [],
      players: [],
      rounds: [],
      events: [],
    },
    ratingStatus: 422,
    rating: { error: { code: 'UNSUPPORTED_ROSTER_SIZE' } },
    explanationStatus: 422,
    explanation: { error: { code: 'UNSUPPORTED_ROSTER_SIZE' } },
    replay: {
      matchId: MATCH_ID,
      availability: 'UNSUPPORTED_MAP',
      reason: 'UNSUPPORTED_MAP',
      map: null,
      calibration: null,
      players: [],
      teams: [],
      rounds: [],
      totalFrames: 0,
      totalCompressedBytes: 0,
    },
  };

  await withMockApi(fixture, async (api) => {
    const result = await runRealDemoSmoke([
      `--match=${MATCH_ID}`,
      `--api=${api}`,
      '--expect=UNSUPPORTED',
    ]);
    assert.equal(result.afterRescore.calculatedRatings, null);
    assert.equal(result.afterRescore.replayFrames, null);
  });
});
