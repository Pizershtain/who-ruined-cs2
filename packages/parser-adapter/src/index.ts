import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
export const PARSER_LIBRARY_VERSION = '0.42.0';
export const NORMALIZER_VERSION = 'm2.5-0.2.0';

export type UnknownRow = Record<string, unknown>;
export interface DemoParserPort {
  parseHeader(path: string): unknown;
  parsePlayerInfo(path: string): unknown;
  listGameEvents(path: string): unknown;
  parseEvents(path: string, eventNames: string[], extraPlayer?: string[] | null, extraOther?: string[] | null): unknown;
  parseTicks(path: string, wantedProps: string[], wantedTicks?: number[] | null): unknown;
}

const rowsSchema = z.array(z.record(z.string(), z.unknown()));

export function loadNativeParser(): DemoParserPort {
  return require('@laihoe/demoparser2') as DemoParserPort;
}

export function toRows(value: unknown): UnknownRow[] {
  if (Array.isArray(value)) return rowsSchema.parse(value);
  if (value && typeof value === 'object') {
    const columns = value as Record<string, unknown>;
    const arrays = Object.entries(columns).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
    if (arrays.length === 0) return [];
    const length = Math.max(...arrays.map(([, items]) => items.length));
    return Array.from({ length }, (_, index) => Object.fromEntries(arrays.map(([key, items]) => [key, items[index] ?? null])));
  }
  return [];
}

export function asInteger(row: UnknownRow, aliases: string[]): number | null {
  for (const key of aliases) {
    const value = row[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

export function asText(row: UnknownRow, aliases: string[]): string | null {
  for (const key of aliases) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function isSource2Header(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const header = value as Record<string, unknown>;
  return header.demo_version_name === 'valve_demo_2' || (typeof header.demo_file_stamp === 'string' && header.demo_file_stamp.startsWith('PBDEMS2'));
}

export function sanitizeSchema(rows: UnknownRow[]): { count: number; columns: string[] } {
  return { count: rows.length, columns: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort() };
}

export interface ParsedDemoSnapshot {
  header: Record<string, unknown>;
  players: UnknownRow[];
  eventNames: string[];
  events: UnknownRow[];
  ticks: UnknownRow[];
}

export interface ReplaySamplingRound {
  id: string;
  ordinal: number;
  startTick: number;
  freezeEndTick: number | null;
  endTick: number;
}

export interface ReplaySamplingRequest {
  tickRate: number;
  sampleRateHz: number;
  rounds: ReplaySamplingRound[];
}

export interface ParsedReplaySnapshot {
  schemaVersion: 'parser-replay-snapshot@1';
  tickRate: number;
  sampleRateHz: number;
  rounds: ReplaySamplingRound[];
  rows: UnknownRow[];
}

const replaySamplingRoundSchema = z.object({
  id: z.string().min(1).max(160),
  ordinal: z.number().int().positive(),
  startTick: z.number().int().nonnegative(),
  freezeEndTick: z.number().int().nonnegative().nullable(),
  endTick: z.number().int().nonnegative()
}).refine((round) => round.startTick <= round.endTick && (round.freezeEndTick === null || round.freezeEndTick >= round.startTick && round.freezeEndTick <= round.endTick));

export const parsedReplaySnapshotSchema = z.object({
  schemaVersion: z.literal('parser-replay-snapshot@1'),
  tickRate: z.number().positive(),
  sampleRateHz: z.number().positive().max(32),
  rounds: z.array(replaySamplingRoundSchema).min(1).max(256),
  rows: rowsSchema.max(1_280_000)
});

export function validateParsedReplaySnapshot(value: unknown): ParsedReplaySnapshot {
  return parsedReplaySnapshotSchema.parse(value);
}

export function parseDemoReplaySnapshot(
  path: string,
  input: ReplaySamplingRequest,
  parser: DemoParserPort = loadNativeParser()
): ParsedReplaySnapshot {
  const request = z.object({
    tickRate: z.number().positive().max(1024),
    sampleRateHz: z.number().positive().max(32),
    rounds: z.array(replaySamplingRoundSchema).min(1).max(256)
  }).parse(input);
  const step = Math.max(1, Math.round(request.tickRate / request.sampleRateHz));
  const ticks = new Set<number>();
  for (const round of request.rounds) {
    for (let tick = round.startTick; tick <= round.endTick; tick += step) ticks.add(tick);
    ticks.add(round.endTick);
    if (round.freezeEndTick !== null) ticks.add(round.freezeEndTick);
  }
  if (ticks.size > 20_000) throw new Error('REPLAY_SAMPLE_LIMIT');
  const wantedTicks = [...ticks].sort((a, b) => a - b);
  const rows = toRows(parser.parseTicks(path, ['X','Y','Z','yaw','pitch','steamid','is_alive'], wantedTicks));
  return validateParsedReplaySnapshot({
    schemaVersion: 'parser-replay-snapshot@1',
    tickRate: request.tickRate,
    sampleRateHz: request.sampleRateHz,
    rounds: request.rounds,
    rows
  });
}

export const parsedDemoSnapshotSchema = z.object({
  header: z.record(z.string(), z.unknown()),
  players: rowsSchema,
  eventNames: z.array(z.string()),
  events: rowsSchema,
  ticks: rowsSchema
});

export function validateParsedDemoSnapshot(value: unknown): ParsedDemoSnapshot {
  return parsedDemoSnapshotSchema.parse(value);
}

const requiredCandidates = ['round_prestart','round_poststart','round_start','round_freeze_end','round_end','round_officially_ended','cs_win_panel_match','player_connect','player_connect_full','player_disconnect','player_death','player_hurt','bomb_beginplant','bomb_begindefuse','bomb_planted','bomb_defused','bomb_exploded','player_blind','flashbang_detonate','hegrenade_detonate','smokegrenade_detonate','inferno_startburn','inferno_expire'];
export function parseDemoSnapshot(path: string, parser: DemoParserPort = loadNativeParser()): ParsedDemoSnapshot {
  const rawHeader = parser.parseHeader(path);
  const header = rawHeader && typeof rawHeader === 'object' ? rawHeader as Record<string, unknown> : {};
  const players = toRows(parser.parsePlayerInfo(path));
  const listed = parser.listGameEvents(path);
  const eventNames = Array.isArray(listed) ? listed.filter((value): value is string => typeof value === 'string') : [];
  const selected = requiredCandidates.filter((eventName) => eventNames.includes(eventName));
  const events = selected.length ? toRows(parser.parseEvents(path, selected)) : [];
  const ticksToRead = [...new Set(events
    .map((row) => asInteger(row, ['tick']))
    .filter((tick): tick is number => tick !== null))].sort((a, b) => a - b);
  const tickProps = ['team_num','team_name','team_rounds_total','is_alive','game_time','current_equip_value','inventory','armor_value','has_helmet','has_defuser','cash'];
  const ticks = ticksToRead.length ? toRows(parser.parseTicks(path, tickProps, ticksToRead)) : [];
  return { header, players, eventNames, events, ticks };
}
