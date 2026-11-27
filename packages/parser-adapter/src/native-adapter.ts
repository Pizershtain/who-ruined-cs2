import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);

export const PARSER_LIBRARY_VERSION = '0.42.3';

export type UnknownRow = Record<string, unknown>;

export interface DemoParserPort {
  parseHeader(path: string): unknown;
  parsePlayerInfo(path: string): unknown;
  listGameEvents(path: string): unknown;
  parseEvents(path: string, eventNames: string[], extraPlayer?: string[] | null, extraOther?: string[] | null): unknown;
  parseTicks(path: string, wantedProps: string[], wantedTicks?: number[] | null): unknown;
}

export const rowsSchema = z.array(z.record(z.string(), z.unknown()));

function parserRowTransportError(): Error {
  return new Error('PARSER_ROW_NOT_JSON_SAFE');
}

// Parser rows cross the child-process boundary as JSON, so normalize them before transport.
function normalizeParserRow(row: UnknownRow): UnknownRow {
  const normalized: UnknownRow = {};
  for (const [key, item] of Object.entries(row)) {
    const normalizedItem = normalizeParserRowValue(item);
    if (normalizedItem !== undefined) normalized[key] = normalizedItem;
  }
  return normalized;
}

function normalizeParserRowValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw parserRowTransportError();
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return Array.from(value, (item) => {
      const normalized = normalizeParserRowValue(item);
      if (normalized === undefined) throw parserRowTransportError();
      return normalized;
    });
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw parserRowTransportError();
    }
    return normalizeParserRow(value as UnknownRow);
  }
  throw parserRowTransportError();
}

function normalizeParserRows(rows: UnknownRow[]): UnknownRow[] {
  return rows.map(normalizeParserRow);
}

export function loadNativeParser(): DemoParserPort {
  return require('@laihoe/demoparser2') as DemoParserPort;
}

export function toRows(value: unknown): UnknownRow[] {
  if (Array.isArray(value)) return normalizeParserRows(rowsSchema.parse(value));
  if (value && typeof value === 'object') {
    const columns = value as Record<string, unknown>;
    const arrays = Object.entries(columns).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
    if (arrays.length === 0) return [];
    const length = Math.max(...arrays.map(([, items]) => items.length));
    return normalizeParserRows(Array.from(
      { length },
      (_, index) => Object.fromEntries(arrays.map(([key, items]) => [key, items[index] ?? null])),
    ));
  }
  return [];
}

export function isSource2Header(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const header = value as Record<string, unknown>;
  return header.demo_version_name === 'valve_demo_2' || (typeof header.demo_file_stamp === 'string' && header.demo_file_stamp.startsWith('PBDEMS2'));
}

export function sanitizeSchema(rows: UnknownRow[]): { count: number; columns: string[] } {
  return { count: rows.length, columns: [...new Set(rows.flatMap((row) => Object.keys(row)))].sort() };
}
