import { useTranslation } from 'react-i18next';
import type { H3ExplanationFamily } from '@who-ruined/contracts';

export function useFamilyLabels(): Record<H3ExplanationFamily['family'], string> {
  const { t } = useTranslation('player');
  return {
    ROUND_IMPACT: t('family-impact', 'Round impact'),
    COMBAT: t('family-combat', { ns: 'player', defaultValue: 'Combat' }),
    SUPPORT: t('family-support', { ns: 'player', defaultValue: 'Support' }),
    DEATH_RELATED: t('family-death-related', { ns: 'player', defaultValue: 'Death-related' }),
    OBJECTIVES: t('family-objectives', { ns: 'player', defaultValue: 'Objectives' }),
    CONTEXT: t('family-context', { ns: 'player', defaultValue: 'Context' }),
    DIRECT_HARM: t('family-direct-harm', { ns: 'player', defaultValue: 'Direct harm' })
  };
}
