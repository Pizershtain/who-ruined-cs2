import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FAMILY_NAMES = new Set([
  'COMBAT', 'SUPPORT', 'DEATH_RELATED', 'OBJECTIVES', 'CONTEXT', 'DIRECT_HARM',
]);
const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
const EXPECTED_MATCH_KINDS = new Set(['FULL', 'PARTIAL', 'UNSUPPORTED']);
const EXPECTED_RATING_STATES = new Set(['AVAILABLE', 'UNAVAILABLE']);
const EXPECTED_REPLAY_STATES = new Set(['AVAILABLE', 'REPLAY_UNAVAILABLE', 'UNSUPPORTED_MAP']);

function argumentsMap(values) {
  return Object.fromEntries(values.map((value) => {
    const [key, ...rest] = value.replace(/^--/u, '').split('=');
    return [key, rest.join('=')];
  }));
}

function requiredOption(options, name, allowed, fallback) {
  const value = (options[name] || fallback).toUpperCase();
  if (!allowed.has(value)) {
    throw new Error(`--${name} must be one of: ${[...allowed].join(', ')}.`);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  assert.ok(isRecord(value), `${label} must be an object.`);
  return value;
}

function requireArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array.`);
  return value;
}

function requireUniqueIds(values, label) {
  const ids = values.map((value, index) => {
    const id = requireRecord(value, `${label}[${index}]`).id;
    assert.equal(typeof id, 'string', `${label}[${index}].id must be a string.`);
    assert.notEqual(id, '', `${label}[${index}].id must not be empty.`);
    return id;
  });
  assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate ids.`);
  return ids;
}

function assertSameIds(actual, expected, label) {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort(), `${label} binding mismatch.`);
}

function assertFiniteNumber(value, label) {
  assert.equal(typeof value, 'number', `${label} must be a number.`);
  assert.ok(Number.isFinite(value), `${label} must be finite.`);
}

function assertClose(actual, expected, tolerance, label) {
  assertFiniteNumber(actual, label);
  assertFiniteNumber(expected, `${label} expected value`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} mismatch: ${actual} != ${expected}.`);
}

async function requestJson(api, path, init) {
  const response = await fetch(`${api}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { body, ok: response.ok, status: response.status };
}

async function jsonRequest(api, path, init) {
  const result = await requestJson(api, path, init);
  if (!result.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function waitForJob(api, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStage = '';
  while (Date.now() < deadline) {
    const job = await jsonRequest(api, `/jobs/${jobId}`);
    if (job.stage !== lastStage) {
      console.log(`Job ${jobId}: ${job.status}/${job.stage}`);
      lastStage = job.stage;
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) return job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs} ms.`);
}

function assertMatch(match, matchId, expectedMatchKind) {
  requireRecord(match, 'match');
  assert.equal(match.matchId, matchId, 'Match endpoint binding mismatch.');
  const players = requireArray(match.players, 'match.players');
  const teams = requireArray(match.teams, 'match.teams');
  const rounds = requireArray(match.rounds, 'match.rounds');
  requireArray(match.events, 'match.events');

  const expectedQuality = expectedMatchKind === 'FULL' ? 'VALID' : expectedMatchKind;
  assert.equal(match.quality, expectedQuality, `Expected match quality ${expectedQuality}.`);

  const playerIds = requireUniqueIds(players, 'match.players');
  const teamIds = requireUniqueIds(teams, 'match.teams');
  const roundIds = requireUniqueIds(rounds, 'match.rounds');
  const rosterIds = teams.flatMap((team) => requireArray(team.playerIds, `team ${team.id}.playerIds`));
  assertSameIds(rosterIds, playerIds, 'Team roster/player');
  for (const player of players) {
    assert.ok(teamIds.includes(player.teamId), `Player ${player.id} references an unknown team.`);
    const team = teams.find((candidate) => candidate.id === player.teamId);
    assert.ok(team.playerIds.includes(player.id), `Player ${player.id} is missing from its team roster.`);
  }

  if (expectedMatchKind === 'FULL') {
    assert.equal(players.length, 10, 'FULL smoke requires exactly 10 players.');
    assert.equal(teams.length, 2, 'FULL smoke requires exactly two teams.');
    assert.ok(teams.every((team) => team.playerIds.length === 5), 'FULL smoke requires two 5-player rosters.');
    assert.ok(rounds.length > 0, 'FULL smoke requires at least one round.');
    assert.ok(match.events.length > 0, 'FULL smoke requires normalized match events.');
  } else if (expectedMatchKind === 'PARTIAL') {
    assert.ok(players.length > 0, 'PARTIAL smoke still requires identified players.');
    assert.ok(rounds.length > 0, 'PARTIAL smoke still requires identified rounds.');
  }
  return { playerIds, roundIds, teamIds };
}

function assertRatingArithmetic(rating, label) {
  requireRecord(rating, label);
  assertFiniteNumber(rating.value, `${label}.value`);
  const finalAttribution = requireRecord(rating.finalAttribution, `${label}.finalAttribution`);
  assertSameIds(Object.keys(finalAttribution), [...FAMILY_NAMES], `${label}.finalAttribution families`);
  const reconstructed = 1 + Object.values(finalAttribution).reduce((sum, value, index) => {
    assertFiniteNumber(value, `${label}.finalAttribution[${index}]`);
    return sum + value;
  }, 0);
  const arithmetic = requireRecord(rating.arithmetic, `${label}.arithmetic`);
  assert.equal(arithmetic.exactWithinTolerance, true, `${label} is not exact within its declared tolerance.`);
  assertClose(arithmetic.reconstructed, reconstructed, arithmetic.tolerance, `${label}.arithmetic.reconstructed`);
  assertClose(rating.value, reconstructed, arithmetic.tolerance, `${label}.value reconstruction`);
}

function assertRatingReport(rating, match, bindings, expectedMatchKind, expectedRatingState) {
  requireRecord(rating, 'rating report');
  assert.equal(rating.matchId, match.matchId, 'Rating/match binding mismatch.');
  const players = requireArray(rating.players, 'rating.players');
  const ratingPlayerIds = players.map((player) => player.playerId);
  assertSameIds(ratingPlayerIds, bindings.playerIds, 'Rating/player');
  assert.equal(new Set(ratingPlayerIds).size, ratingPlayerIds.length, 'Rating contains duplicate players.');
  assert.equal(rating.match.map, match.map, 'Rating map binding mismatch.');
  assert.equal(rating.match.quality, match.quality, 'Rating quality binding mismatch.');
  assert.equal(rating.match.totalRounds, match.rounds.length, 'Rating round-count binding mismatch.');
  assertSameIds(rating.match.teams.map((team) => team.teamId), bindings.teamIds, 'Rating/team');

  const calculated = [];
  for (const player of players) {
    const matchPlayer = match.players.find((candidate) => candidate.id === player.playerId);
    assert.equal(player.teamId, matchPlayer.teamId, `Rating team mismatch for ${player.playerId}.`);
    if (player.rating === null) {
      assert.notEqual(player.availability?.status, 'CALCULATED_RESEARCH_ONLY', `Null rating for ${player.playerId} is marked calculated.`);
    } else {
      assert.equal(player.availability?.status, 'CALCULATED_RESEARCH_ONLY', `Calculated rating for ${player.playerId} lacks calculated availability.`);
      assertRatingArithmetic(player.rating, `rating.players[${player.playerId}].rating`);
      calculated.push(player.playerId);
    }
  }
  assertSameIds(rating.ordering, calculated, 'Rating ordering/calculated players');
  assert.equal(rating.awards.eligiblePoolSize, calculated.length, 'Rating eligible pool does not match calculated players.');

  if (expectedRatingState === 'AVAILABLE') {
    assert.ok(calculated.length > 0, 'Expected calculated H2 ratings, received none.');
    if (expectedMatchKind === 'FULL') {
      assert.equal(calculated.length, 10, 'FULL smoke requires H2 ratings for all 10 players.');
    }
  } else {
    assert.equal(calculated.length, 0, 'Expected H2 to be unavailable, but calculated ratings were returned.');
  }
  return new Map(players.map((player) => [player.playerId, player]));
}

function assertMomentBindings(moments, match, label) {
  const playerIds = new Set(match.players.map((player) => player.id));
  const roundIds = new Set(match.rounds.map((round) => round.id));
  const eventIds = new Set(match.events.map((event) => event.id));
  for (const [index, moment] of requireArray(moments, label).entries()) {
    assert.ok(playerIds.has(moment.playerId), `${label}[${index}] references an unknown player.`);
    assert.ok(roundIds.has(moment.roundId), `${label}[${index}] references an unknown round.`);
    assert.ok(requireArray(moment.evidenceEventIds, `${label}[${index}].evidenceEventIds`).length > 0, `${label}[${index}] has no evidence.`);
    assert.ok(moment.evidenceEventIds.every((id) => eventIds.has(id)), `${label}[${index}] references an unknown event.`);
  }
}

function assertExplanation(explanation, match, ratingPlayers, expectedRatingState) {
  requireRecord(explanation, 'explanation report');
  assert.equal(explanation.matchId, match.matchId, 'Explanation/match binding mismatch.');
  const players = requireArray(explanation.players, 'explanation.players');
  assertSameIds(players.map((player) => player.playerId), [...ratingPlayers.keys()], 'Explanation/rating players');
  assert.equal(new Set(players.map((player) => player.playerId)).size, players.length, 'Explanation contains duplicate players.');

  for (const player of players) {
    const ratingPlayer = ratingPlayers.get(player.playerId);
    assert.equal(player.teamId, ratingPlayer.teamId, `Explanation team mismatch for ${player.playerId}.`);
    assert.equal(player.rating === null, ratingPlayer.rating === null, `Explanation availability mismatch for ${player.playerId}.`);
    if (player.rating !== null) {
      const families = requireArray(player.rating.families, `explanation.players[${player.playerId}].rating.families`);
      assert.equal(families.length, FAMILY_NAMES.size, `Explanation for ${player.playerId} must contain six families.`);
      assertSameIds(families.map((family) => family.family), [...FAMILY_NAMES], `Explanation families for ${player.playerId}`);
      const reconstructed = 1 + families.reduce((sum, family) => {
        assertFiniteNumber(family.rawInput, `Explanation ${player.playerId}/${family.family} raw input`);
        assertFiniteNumber(family.finalAttribution, `Explanation ${player.playerId}/${family.family} attribution`);
        requireArray(family.sources, `Explanation ${player.playerId}/${family.family} sources`);
        requireArray(family.transformations, `Explanation ${player.playerId}/${family.family} transformations`);
        return sum + family.finalAttribution;
      }, 0);
      assertClose(player.rating.value, ratingPlayer.rating.value, 1e-12, `Explanation/rating value for ${player.playerId}`);
      assertClose(player.rating.value, reconstructed, player.rating.arithmetic.tolerance, `Explanation reconstruction for ${player.playerId}`);
    }
    assertMomentBindings(player.importantMoments, match, `explanation.players[${player.playerId}].importantMoments`);
  }
  if (expectedRatingState === 'AVAILABLE') {
    assert.ok(players.some((player) => player.rating !== null), 'Expected meaningful explanation ratings, received none.');
  }
  assertMomentBindings(explanation.importantMoments, match, 'explanation.importantMoments');
}

function assertExpectedUnavailableResponse(result, label) {
  assert.equal(result.ok, false, `${label} unexpectedly returned a successful payload.`);
  assert.equal(result.status, 422, `${label} must use the typed unsupported-roster response.`);
  assert.equal(result.body?.error?.code, 'UNSUPPORTED_ROSTER_SIZE', `${label} returned an unexpected error code.`);
}

function assertReplayMetadata(replay, match, bindings, expectedReplayState) {
  requireRecord(replay, 'replay metadata');
  assert.equal(replay.matchId, match.matchId, 'Replay/match binding mismatch.');
  assert.equal(replay.availability, expectedReplayState, `Expected replay availability ${expectedReplayState}.`);
  assert.equal(replay.map, match.map, 'Replay map binding mismatch.');
  assertSameIds(requireArray(replay.players, 'replay.players').map((player) => player.id), bindings.playerIds, 'Replay/player');
  assertSameIds(requireArray(replay.teams, 'replay.teams').map((team) => team.id), bindings.teamIds, 'Replay/team');

  const matchRoundById = new Map(match.rounds.map((round) => [round.id, round]));
  const replayRounds = requireArray(replay.rounds, 'replay.rounds');
  requireUniqueIds(replayRounds, 'replay.rounds');
  for (const round of replayRounds) {
    const matchRound = matchRoundById.get(round.id);
    assert.ok(matchRound, `Replay references unknown round ${round.id}.`);
    for (const field of ['ordinal', 'startTick', 'freezeEndTick', 'endTick']) {
      assert.equal(round[field], matchRound[field], `Replay round ${round.id} ${field} binding mismatch.`);
    }
  }

  if (expectedReplayState === 'AVAILABLE') {
    assert.equal(replay.reason, null, 'Available replay must not have an unavailability reason.');
    assert.ok(replay.calibration, 'Available replay requires verified calibration.');
    assert.ok(replayRounds.length > 0, 'Available replay requires rounds.');
    assert.ok(replayRounds.some((round) => round.sampleCount > 0), 'Available replay requires sampled frames.');
    assert.ok(replay.totalFrames > 0, 'Available replay requires a positive total frame count.');
    assert.equal(replay.totalFrames, replayRounds.reduce((sum, round) => sum + round.sampleCount, 0), 'Replay frame total mismatch.');
    assert.ok(replay.totalCompressedBytes > 0, 'Available replay requires stored round payloads.');
  } else {
    assert.equal(replay.reason, expectedReplayState, 'Replay unavailability reason mismatch.');
    assert.equal(replay.calibration, null, 'Unavailable replay must not expose calibration.');
    if (expectedReplayState === 'REPLAY_UNAVAILABLE') {
      assert.equal(replay.totalFrames, 0, 'Missing replay must not claim stored frames.');
      assert.equal(replay.totalCompressedBytes, 0, 'Missing replay must not claim stored bytes.');
    }
  }
  return replayRounds;
}

function assertReplayRound(roundPayload, replayRound, matchId) {
  requireRecord(roundPayload, 'replay round');
  assert.equal(roundPayload.binding?.matchId, matchId, 'Replay round/match binding mismatch.');
  assert.equal(roundPayload.round?.id, replayRound.id, 'Replay round id binding mismatch.');
  for (const field of ['ordinal', 'startTick', 'freezeEndTick', 'endTick']) {
    assert.equal(roundPayload.round[field], replayRound[field], `Replay round payload ${field} binding mismatch.`);
  }
  assert.equal(requireArray(roundPayload.frames, 'replay round frames').length, replayRound.sampleCount, 'Replay round sample count mismatch.');
  assert.equal(requireArray(roundPayload.events, 'replay round events').length, replayRound.eventCount, 'Replay round event count mismatch.');
}

async function inspectMatch(api, matchId, expectations) {
  const match = await jsonRequest(api, `/matches/${matchId}`);
  const bindings = assertMatch(match, matchId, expectations.match);
  const [ratingResult, explanationResult, replay] = await Promise.all([
    requestJson(api, `/matches/${matchId}/experimental-participation-rating`),
    requestJson(api, `/matches/${matchId}/experimental-participation-explanation`),
    jsonRequest(api, `/matches/${matchId}/replay?version=2`),
  ]);

  let rating = null;
  let explanation = null;
  if (!ratingResult.ok || !explanationResult.ok) {
    assert.equal(expectations.ratings, 'UNAVAILABLE', 'H2 endpoints failed although calculated ratings were expected.');
    assertExpectedUnavailableResponse(ratingResult, 'Rating endpoint');
    assertExpectedUnavailableResponse(explanationResult, 'Explanation endpoint');
  } else {
    rating = ratingResult.body;
    explanation = explanationResult.body;
    const ratingPlayers = assertRatingReport(rating, match, bindings, expectations.match, expectations.ratings);
    assertExplanation(explanation, match, ratingPlayers, expectations.ratings);
  }

  const replayRounds = assertReplayMetadata(replay, match, bindings, expectations.replay);
  let replayRound = null;
  if (expectations.replay === 'AVAILABLE') {
    replayRound = await jsonRequest(api, `/matches/${matchId}/replay/rounds/${replayRounds[0].id}`);
    assertReplayRound(replayRound, replayRounds[0], matchId);
  }

  const calculatedRatings = rating?.players.filter((player) => player.rating !== null).length ?? null;
  return {
    snapshot: { match, rating, explanation, replay, replayRound },
    summary: {
      matchId,
      map: match.map,
      quality: match.quality,
      players: match.players.length,
      rounds: match.rounds.length,
      events: match.events.length,
      ratingPlayers: rating?.players.length ?? null,
      calculatedRatings,
      explanationPlayers: explanation?.players.length ?? null,
      importantMoments: explanation?.importantMoments.length ?? null,
      replayAvailability: replay.availability,
      replayRounds: replay.availability === 'AVAILABLE' ? replayRounds.length : null,
      replayFrames: replay.availability === 'AVAILABLE' ? replay.totalFrames : null,
    },
  };
}

function assertStableAfterRescore(before, after) {
  assert.deepEqual(after.match, before.match, 'Canonical match changed during RESCORE.');
  assert.deepEqual(after.rating, before.rating, 'H2 result changed during same-version RESCORE.');
  assert.deepEqual(after.explanation, before.explanation, 'H2 explanation changed during same-version RESCORE.');
  assert.deepEqual(after.replay, before.replay, 'Replay metadata changed during RESCORE.');
  assert.deepEqual(after.replayRound, before.replayRound, 'Replay round changed during RESCORE.');
}

function resolveExpectations(options) {
  const match = requiredOption(options, 'expect', EXPECTED_MATCH_KINDS, 'FULL');
  const defaultRatings = match === 'UNSUPPORTED' ? 'UNAVAILABLE' : 'AVAILABLE';
  const defaultReplay = match === 'UNSUPPORTED' ? 'UNSUPPORTED_MAP' : 'AVAILABLE';
  const ratings = requiredOption(options, 'expect-ratings', EXPECTED_RATING_STATES, defaultRatings);
  const replay = requiredOption(options, 'expect-replay', EXPECTED_REPLAY_STATES, defaultReplay);
  if (match === 'FULL' && ratings !== 'AVAILABLE') {
    throw new Error('FULL smoke cannot expect unavailable H2 ratings.');
  }
  return { match, ratings, replay };
}

export async function runRealDemoSmoke(rawArguments = process.argv.slice(2)) {
  const options = argumentsMap(rawArguments);
  const api = (options.api || 'http://127.0.0.1:3000/api/v1').replace(/\/$/u, '');
  const timeoutMs = Number(options['timeout-ms'] || 10 * 60_000);
  const expectations = resolveExpectations(options);
  let matchId = options.match;
  let parseJob = null;

  if (!matchId) {
    if (!options.demo) {
      throw new Error('Usage: npm.cmd run quality:real-demo -- --demo=<path.dem> [--expect=FULL|PARTIAL|UNSUPPORTED] [--expect-ratings=AVAILABLE|UNAVAILABLE] [--expect-replay=AVAILABLE|REPLAY_UNAVAILABLE|UNSUPPORTED_MAP] [--api=<api-root>] or --match=<id>');
    }
    const demoPath = resolve(options.demo);
    const form = new FormData();
    form.append('demo', await openAsBlob(demoPath), basename(demoPath));
    const uploaded = await jsonRequest(api, '/matches', { method: 'POST', body: form });
    assert.equal(typeof uploaded.matchId, 'string', 'Upload response has no matchId.');
    assert.equal(typeof uploaded.jobId, 'string', 'Upload response has no jobId.');
    matchId = uploaded.matchId;
    parseJob = await waitForJob(api, uploaded.jobId, timeoutMs);
    const expectedParseStatus = expectations.match === 'FULL' ? 'COMPLETED' : 'PARTIAL';
    assert.equal(parseJob.status, expectedParseStatus, `Expected PARSE job status ${expectedParseStatus}.`);
    assert.equal(parseJob.matchId, matchId, 'PARSE job/match binding mismatch.');
  }

  const beforeRescore = await inspectMatch(api, matchId, expectations);
  let rescoreJob = null;
  if (!options.match && options['skip-rescore'] !== '1') {
    const queued = await jsonRequest(api, `/matches/${matchId}/rescore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scoringVersion: 'scoring-successor@0.1.0-alpha75-beta25' }),
    });
    assert.equal(queued.matchId, matchId, 'RESCORE admission/match binding mismatch.');
    assert.equal(typeof queued.jobId, 'string', 'RESCORE admission has no jobId.');
    rescoreJob = await waitForJob(api, queued.jobId, timeoutMs);
    assert.equal(rescoreJob.status, 'COMPLETED', `RESCORE job failed: ${JSON.stringify(rescoreJob)}`);
    assert.equal(rescoreJob.matchId, matchId, 'RESCORE job/match binding mismatch.');
  }
  const afterRescore = await inspectMatch(api, matchId, expectations);
  assertStableAfterRescore(beforeRescore.snapshot, afterRescore.snapshot);

  const result = {
    expectations,
    parseJob: parseJob && { id: parseJob.id, status: parseJob.status, stage: parseJob.stage },
    rescoreJob: rescoreJob && { id: rescoreJob.id, status: rescoreJob.status, stage: rescoreJob.stage },
    beforeRescore: beforeRescore.summary,
    afterRescore: afterRescore.summary,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runRealDemoSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
