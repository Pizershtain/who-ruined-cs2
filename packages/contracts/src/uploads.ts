import { z } from 'zod';
import { idSchema } from './internal.js';

export const matchUploadContractVersion = 'match-upload@1';
export const uploadReuseStatuses = ['ACCEPTED', 'ANALYSIS_IN_PROGRESS', 'RESULT_READY'] as const;
export const matchUploadResultSchema = z.object({
  matchId: idSchema,
  jobId: idSchema,
  duplicate: z.boolean(),
  reuseStatus: z.enum(uploadReuseStatuses).optional(),
}).refine(result => result.reuseStatus === undefined || result.duplicate === (result.reuseStatus !== 'ACCEPTED'));
export type MatchUploadResult = z.infer<typeof matchUploadResultSchema>;
