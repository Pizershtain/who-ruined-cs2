import { z } from 'zod';
import { idSchema as id } from './internal.js';

export const jobStatuses = ['QUEUED', 'PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'] as const;
export const jobStatusSchema = z.enum(jobStatuses);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobDtoSchema = z.object({
  id, matchId: id, status: jobStatusSchema, stage: jobStatusSchema, createdAt: z.string(), updatedAt: z.string(),
  errorCode: z.string().optional(), message: z.string().optional()
});
export type JobDto = z.infer<typeof jobDtoSchema>;

export const errorCodes = ['INVALID_DEMO','UNSUPPORTED_MODE','INCOMPLETE_MATCH','MISSING_REQUIRED_EVENTS','SIZE_LIMIT','PARSE_TIMEOUT','PARSE_FAILED','SCORING_FAILED','VALIDATION_FAILED','JOB_NOT_FOUND','MATCH_NOT_FOUND','PLAYER_NOT_FOUND','INTERNAL_ERROR'] as const;
export type ErrorCode = typeof errorCodes[number];
