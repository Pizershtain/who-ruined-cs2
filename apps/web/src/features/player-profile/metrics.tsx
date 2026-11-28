import type { ReactNode } from 'react';
import type { PlayerMeasurement, ProfileAggregate } from '@who-ruined/contracts';
import { useTranslation } from 'react-i18next';

export function measurementValue(measurement: PlayerMeasurement, scale = 1): number | null {
  if (measurement.numerator === null) return null;
  if (measurement.denominator === null) return measurement.numerator;
  return measurement.denominator > 0 ? scale * measurement.numerator / measurement.denominator : null;
}

export function Metric({ label, value, datum, percent = false }: {
  label: ReactNode; value: number | null; datum?: PlayerMeasurement | ProfileAggregate; percent?: boolean;
}) {
  const { t, i18n } = useTranslation('player');
  const format = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 });
  const observed = datum?.observedRounds ?? null;
  const coverage = datum?.status === 'PARTIAL' && (observed !== null && datum.expectedRounds > 0
    ? t('profile-round-coverage', '{{observed}}/{{expected}} rounds', { observed: format.format(observed), expected: format.format(datum.expectedRounds) })
    : 'observedMatches' in datum && datum.applicableMatches > 0
      ? t('profile-match-coverage', '{{observed}}/{{expected}} matches', { observed: format.format(datum.observedMatches), expected: format.format(datum.applicableMatches) })
      : t('partial', { ns: 'match', defaultValue: 'Partial data' }));
  const unavailable = datum?.status === 'NOT_APPLICABLE'
    ? t('profile-inapplicable', 'Not applicable')
    : t('unavailable', { ns: 'translation', defaultValue: 'Not available yet' });
  return <div className="profile-metric"><dt>{label}</dt>
    <dd>{value === null
      ? <span aria-label={unavailable} title={unavailable}>{datum?.status === 'NOT_APPLICABLE' ? unavailable : '—'}</span>
      : <bdi>{percent ? new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100) : format.format(value)}</bdi>}</dd>
    {coverage && <dd className="profile-coverage">{coverage}</dd>}
  </div>;
}
