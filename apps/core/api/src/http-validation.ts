import type { Request } from 'express';
import { ApiError } from './safe-exception.filter.js';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export function assertOpaqueId(value: string, missingCode: 'MATCH_NOT_FOUND'|'JOB_NOT_FOUND'|'PLAYER_NOT_FOUND'|'REPLAY_ROUND_NOT_FOUND'): string {
  if (!OPAQUE_ID.test(value) || value.normalize('NFC') !== value) {
    const message = missingCode === 'JOB_NOT_FOUND' ? 'Задача не найдена.'
      : missingCode === 'PLAYER_NOT_FOUND' ? 'Игрок не найден.'
        : missingCode === 'REPLAY_ROUND_NOT_FOUND' ? 'Раунд 2D-реконструкции не найден.' : 'Матч не найден.';
    throw new ApiError(missingCode, message, 404);
  }
  return value;
}

export function assertExactQuery(request: Request, allowed: readonly string[]): Record<string, string> {
  const allow = new Set(allowed);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.query)) {
    if (!allow.has(key) || typeof value !== 'string' || value.length === 0 || value.length > 160 || value.normalize('NFC') !== value || !TOKEN.test(value)) {
      throw new ApiError('INVALID_QUERY', 'Некорректные параметры запроса.', 422);
    }
    result[key] = value;
  }
  return result;
}

export function assertNoPolicySelector(request: Request): void {
  for (const key of Object.keys(request.query)) {
    const normalized = key.normalize('NFKC').toLowerCase();
    if (normalized === 'policy' || normalized.startsWith('policy[')) {
      throw new ApiError('INVALID_POLICY_SELECTOR', 'Выбор rating policy через HTTP запрещён; policy задаётся только владельцем backend.', 422);
    }
  }
  assertExactQuery(request, []);
}

export function assertPlainObjectWithKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ApiError('INVALID_REQUEST', 'Тело запроса должно быть JSON-объектом.', 422);
  }
  const allow = new Set(allowed);
  if (Object.keys(value).some((key) => !allow.has(key))) throw new ApiError('INVALID_REQUEST', 'Тело запроса содержит неподдерживаемые поля.', 422);
}

