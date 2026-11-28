import { expect, it } from 'vitest';
import { matchUploadResultSchema } from '../src/index.js';

it('accepts a legacy upload response and distinguishes new admission, active reuse and a ready result', () => {
  const ids = { matchId: 'match-1', jobId: 'parse-job-1' };
  expect(matchUploadResultSchema.safeParse({ ...ids, duplicate: true }).success).toBe(true);
  expect(matchUploadResultSchema.safeParse({ ...ids, duplicate: false, reuseStatus: 'ACCEPTED' }).success).toBe(true);
  for (const reuseStatus of ['ANALYSIS_IN_PROGRESS', 'RESULT_READY']) {
    expect(matchUploadResultSchema.safeParse({ ...ids, duplicate: true, reuseStatus }).success).toBe(true);
    expect(matchUploadResultSchema.safeParse({ ...ids, duplicate: false, reuseStatus }).success).toBe(false);
  }
  expect(matchUploadResultSchema.safeParse({ matchId: ids.matchId, jobId: '', duplicate: true }).success).toBe(false);
});
