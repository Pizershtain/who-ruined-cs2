import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeSnapshot } from '@who-ruined/match-domain';
import { PARSER_LIBRARY_VERSION, toNormalizationInput } from '../src/index.js';

function digest(match: ReturnType<typeof normalizeSnapshot>): string {
  expect(match.provenance.parserVersion).toBe(PARSER_LIBRARY_VERSION);
  // Keep the exact synthetic baseline comparable to the original 0.42.0 run.
  const fixture = { ...match, provenance: { ...match.provenance, parserVersion: '0.42.0' } };
  return createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
}

describe('synthetic parser-to-domain normalization equivalence', () => {
  it('does not guess absent rosters or rounds', () => {
    const match = normalizeSnapshot(toNormalizationInput({ matchId: 'm', fileSha256: 'b'.repeat(64), normalizedAt: '2026-10-15T00:00:00.000Z', snapshot: { header: { map_name: 'de_test' }, players: [], eventNames: [], events: [], ticks: [] } }));
    expect(digest(match)).toBe('e73523157a910d11754cfb1d7b0157ce49b19573f06be690058def6cdfed4e7a');
    expect(match.quality).toBe('PARTIAL');
    expect(match.qualityIssues.map((issue) => issue.code)).toContain('ROSTER_UNVERIFIED');
    expect(match.qualityIssues.map((issue) => issue.code)).toContain('ROUNDS_MISSING');
  });
  it('preserves stable roster identities across a synthetic side switch and validates score transitions', () => {
    const rosterA = Array.from({ length: 5 }, (_, index) => `7656119800000010${index}`);
    const rosterB = Array.from({ length: 5 }, (_, index) => `7656119800000020${index}`);
    const players = [...rosterA.map((steamid, index) => ({ steamid, name: `A${index}`, team_number: 2 })), ...rosterB.map((steamid, index) => ({ steamid, name: `B${index}`, team_number: 3 })), { steamid: rosterA[0], name: 'A0-reconnected', team_number: 2 }];
    const events: Array<Record<string, unknown>> = [];
    const ticks: Array<Record<string, unknown>> = [];
    let scoreA = 0; let scoreB = 0;
    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      const start = ordinal * 1000; const end = start + 900; const swapped = ordinal >= 5;
      const sideA = swapped ? 3 : 2; const sideB = swapped ? 2 : 3;
      for (const steamid of rosterA) ticks.push({ tick: start + 100, game_time: (start + 100) / 64, steamid, team_num: sideA, team_rounds_total: scoreA });
      for (const steamid of rosterB) ticks.push({ tick: start + 100, game_time: (start + 100) / 64, steamid, team_num: sideB, team_rounds_total: scoreB });
      const aWins = ordinal <= 5; if (aWins) scoreA += 1; else scoreB += 1;
      events.push({ event_name: 'round_start', tick: start }, { event_name: 'round_freeze_end', tick: start + 100 }, { event_name: 'round_end', tick: end, winner: aWins ? sideA : sideB });
      // At halftime demoparser2 may expose the new sides on the prior round's
      // official boundary tick. A complete two-team swap is valid there.
      const endSideA = ordinal === 4 ? 3 : sideA; const endSideB = ordinal === 4 ? 2 : sideB;
      for (const steamid of rosterA) ticks.push({ tick: end, game_time: end / 64, steamid, team_num: endSideA, team_rounds_total: scoreA });
      for (const steamid of rosterB) ticks.push({ tick: end, game_time: end / 64, steamid, team_num: endSideB, team_rounds_total: scoreB });
    }
    events.push(
      { event_name: 'player_death', tick: 5050, attacker_steamid: rosterA[0], user_steamid: rosterA[0], weapon: 'world' },
      { event_name: 'player_disconnect', tick: 5400, user_steamid: rosterA[0] },
      { event_name: 'player_connect_full', tick: 5450, user_steamid: rosterA[0] },
      { event_name: 'player_death', tick: 5950, attacker_steamid: rosterB[0], user_steamid: rosterB[0], weapon: 'world' },
      { event_name: 'player_hurt', tick: 5200, attacker_steamid: rosterA[1], user_steamid: rosterB[1], dmg_health: 37, health: 63, weapon: 'hegrenade' },
      { event_name: 'smokegrenade_detonate', tick: 5300, user_steamid: rosterA[2], entityid: 42 }
    );
    const match = normalizeSnapshot(toNormalizationInput({ matchId: 'm', fileSha256: 'c'.repeat(64), normalizedAt: '2026-10-15T00:00:00.000Z', snapshot: { header: { map_name: 'de_synthetic' }, players, eventNames: ['round_start','round_freeze_end','round_end'], events, ticks } }));
    expect(digest(match)).toBe('3c0861bf7b7c335f6a0ede2d0c1eb36472a9d01ea52a0ceed21587a9fd69163e');
    expect(match.quality).toBe('VALID');
    expect(match.teams).toHaveLength(2);
    expect(match.rounds).toHaveLength(8);
    expect(match.tickRate).toBe(64);
    expect(match.rounds[3]?.sideByTeamId).not.toEqual(match.rounds[4]?.sideByTeamId);
    expect(match.rounds.every((round) => round.isValid)).toBe(true);
    expect(match.players).toHaveLength(10);
    expect(match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE')).toHaveLength(2);
    expect(match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE').map((event) => event.context?.phase)).toEqual(['PRE_FREEZE', 'POST_ROUND']);
    expect(match.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'PLAYER_HURT', attrs: expect.objectContaining({ rawHealthDamage: 37, weapon: 'hegrenade' }), context: expect.objectContaining({ phase: 'LIVE' }) }),
      expect.objectContaining({ kind: 'SMOKE_DETONATE', actorId: rosterA[2] })
    ]));
    expect(match.events.filter((event) => event.kind === 'ECONOMY_SNAPSHOT')).toHaveLength(80);
    expect(match.players.find((player) => player.id === rosterA[0])?.scoreboard?.deaths).toBe(1);
    expect(match.players.find((player) => player.id === rosterB[0])?.scoreboard?.deaths).toBe(0);
  });

  it('marks rounds after a 12:12 regulation tie as overtime and preserves roster teams across side switches', () => {
    const rosterA = Array.from({ length: 5 }, (_, index) => `7656119800000030${index}`);
    const rosterB = Array.from({ length: 5 }, (_, index) => `7656119800000040${index}`);
    const players = [...rosterA.map((steamid) => ({ steamid, name: 'A', team_number: 2 })), ...rosterB.map((steamid) => ({ steamid, name: 'B', team_number: 3 }))];
    const events: Array<Record<string, unknown>> = []; const ticks: Array<Record<string, unknown>> = [];
    let scoreA = 0; let scoreB = 0;
    for (let ordinal = 1; ordinal <= 25; ordinal += 1) {
      const start = ordinal * 1000; const end = start + 900;
      const sideA = ordinal <= 12 || ordinal >= 25 ? 2 : 3; const sideB = sideA === 2 ? 3 : 2;
      for (const steamid of rosterA) ticks.push({ tick: start + 100, game_time: (start + 100) / 64, steamid, team_num: sideA, team_rounds_total: scoreA });
      for (const steamid of rosterB) ticks.push({ tick: start + 100, game_time: (start + 100) / 64, steamid, team_num: sideB, team_rounds_total: scoreB });
      const aWins = ordinal <= 24 ? ordinal % 2 === 1 : true; if (aWins) scoreA += 1; else scoreB += 1;
      events.push({ event_name: 'round_start', tick: start }, { event_name: 'round_freeze_end', tick: start + 100 }, { event_name: 'round_end', tick: end });
      const nextSideA = ordinal === 12 || ordinal === 24 ? (sideA === 2 ? 3 : 2) : sideA; const nextSideB = nextSideA === 2 ? 3 : 2;
      for (const steamid of rosterA) ticks.push({ tick: end, game_time: end / 64, steamid, team_num: nextSideA, team_rounds_total: scoreA });
      for (const steamid of rosterB) ticks.push({ tick: end, game_time: end / 64, steamid, team_num: nextSideB, team_rounds_total: scoreB });
    }
    const match = normalizeSnapshot(toNormalizationInput({ matchId: 'ot', fileSha256: 'd'.repeat(64), normalizedAt: '2026-10-16T00:00:00.000Z', snapshot: { header: { map_name: 'de_synthetic' }, players, eventNames: [], events, ticks } }));
    expect(digest(match)).toBe('0d9b63d3a83a283e88fda73587a038db2aa6d8b8c371b00cf21440571e8de143');
    expect(match.quality).toBe('VALID');
    expect(match.rounds).toHaveLength(25);
    expect(match.rounds[23]?.isOvertime).toBe(false);
    expect(match.rounds[24]?.isOvertime).toBe(true);
    expect(match.rounds[11]?.sideByTeamId).not.toEqual(match.rounds[12]?.sideByTeamId);
    expect(match.rounds[23]?.sideByTeamId).not.toEqual(match.rounds[24]?.sideByTeamId);
  });
});


