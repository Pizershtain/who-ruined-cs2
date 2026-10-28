import { canonicalMatchResultSchema, type CanonicalMatchResult } from '@who-ruined/contracts';
import { P72_POLICIES } from '@who-ruined/scoring';
import { ApiError } from './safe-exception.filter.js';
import { resolveActiveRatingPolicy } from './runtime-config.js';
import { readBoundedGzipJson } from './bounded-gzip.js';

export async function readCanonicalResult(stored: {
  id: string;
  resultFilePath: string | null;
  resultSha256: string | null;
  resultPolicyId: string | null;
  resultPolicyDigest: string | null;
}, requireActivePolicy = false): Promise<CanonicalMatchResult> {
  if (!stored.resultFilePath || !stored.resultSha256) throw new ApiError('REPORT_NOT_READY', 'Канонический отчёт ещё не готов.', 409);
  let decoded: unknown;
  try { decoded = await readBoundedGzipJson(stored.resultFilePath, stored.resultSha256); }
  catch { throw new ApiError('REPORT_CORRUPT', 'Канонический отчёт не является корректным gzip JSON.', 409); }
  const parsed = canonicalMatchResultSchema.safeParse(decoded);
  if (!parsed.success) throw new ApiError('REPORT_CORRUPT', 'Канонический отчёт не соответствует поддерживаемой схеме.', 409);
  const value = parsed.data;
  if (value.artifact.match.matchId !== stored.id || value.activeRating.matchId !== stored.id || value.internal.recomputeSeed.binding.matchId !== stored.id) {
    throw new ApiError('REPORT_CORRUPT', 'Канонический отчёт привязан к другому матчу.', 409);
  }
  if (value.internal.selectedPolicyId !== stored.resultPolicyId || value.internal.selectedPolicyDigest !== stored.resultPolicyDigest) throw new ApiError('REPORT_CORRUPT', 'Policy binding канонического отчёта и SQLite не совпадает.', 409);
  if (requireActivePolicy) {
    const expected = P72_POLICIES[resolveActiveRatingPolicy()];
    if (value.internal.selectedPolicyId !== expected.id || value.internal.selectedPolicyDigest !== expected.digest) {
      throw new ApiError('REPORT_POLICY_MISMATCH', 'Сохранённый отчёт создан для другой owner policy; выполните локальный rating:rebuild.', 409);
    }
  }
  return value;
}
