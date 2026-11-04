export const ACTIVE_JOB_STAGES = [
  'PARSING',
  'NORMALIZING',
  'VALIDATING',
  'FEATURIZING',
  'SCORING',
] as const;

export type ActiveJobStage = typeof ACTIVE_JOB_STAGES[number];

export const JOB_TYPES = ['PARSE', 'RESCORE'] as const;
export type JobType = typeof JOB_TYPES[number];

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && JOB_TYPES.includes(value as JobType);
}

export function initialJobStageFor(type: JobType): 'PARSING' | 'SCORING' {
  switch (type) {
    case 'PARSE':
      return 'PARSING';
    case 'RESCORE':
      return 'SCORING';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export const UNFINISHED_JOB_STATUSES = [
  'QUEUED',
  ...ACTIVE_JOB_STAGES,
] as const;
