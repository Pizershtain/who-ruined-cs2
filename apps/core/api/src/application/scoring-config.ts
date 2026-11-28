import type { ScoringConfig } from '@who-ruined/contracts';
import { SCORING_CONFIGS, scoringConfigHash, SUCCESSOR_75_25_CONFIG } from '@who-ruined/scoring';
import { ApplicationError } from './application-error.js';

export function resolveScoringConfig(version?: string, configHash?: string): ScoringConfig {
  const selectedVersion = version ?? SUCCESSOR_75_25_CONFIG.version;
  const config = SCORING_CONFIGS.find((candidate) =>
    candidate.version === selectedVersion
    && (configHash === undefined || scoringConfigHash(candidate) === configHash)
  );
  if (!config) throw new ApplicationError('UNSUPPORTED_MODE', 'Запрошенная версия scoring-конфигурации не поддерживается.', 422);
  return config;
}
