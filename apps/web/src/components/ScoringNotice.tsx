import type { ScoringReport } from '@who-ruined/contracts';
import { useTranslation } from 'react-i18next';
import { ApiClientError } from '../api.js';
import { errorMessage } from '../shared/messages.js';
import { Icon } from './Icon.js';
import { Skeleton } from './Skeleton.js';

export function ScoringNotice({ loading, error, report, retry }: { loading: boolean; error: unknown; report?: ScoringReport; retry: () => void }) {
  const { t, i18n } = useTranslation('match');
  const common = useTranslation().t;
  const percent = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 0 }).format(value);
  if (loading && !report) return <div className="panel analytics-notice"><Skeleton className="skeleton-metric"/><span>{t('analytics-loading', 'Loading match metrics…')}</span></div>;
  if (error && !report) {
    const message = error instanceof ApiClientError && error.status === 409
      ? t('analytics-legacy', 'Metrics are unavailable for this report. Upload the demo again to run the current analysis.')
      : errorMessage(error, common);
    return <div className="inline-alert" role="status"><Icon name="warning"/><p>{message}</p><button className="button secondary" onClick={retry}>{common('retry', 'Try again')}</button></div>;
  }
  if (!report) return null;
  return <section className="panel analytics-notice" aria-label={t('awards-label', 'Match results')}>
    <div><span className="pill warning">{t('experimental', 'Experimental')}</span><strong>{report.scorerVersion}</strong><small>{t('relative-index-note', 'Relative index is not a probability or proof of intent.')}</small></div>
    <dl className="availability-list">
      <div><dt>{t('coverage', 'Coverage')}</dt><dd>{percent(report.coverage.score)}</dd></div>
      <div><dt>{t('round-history-short', 'Rounds')}</dt><dd>{percent(report.coverage.rounds)}</dd></div>
      <div><dt>{t('player', 'Player')}</dt><dd>{percent(report.coverage.identities)}</dd></div>
      <div><dt>{t('source-damage', 'Damage')}</dt><dd>{percent(Math.min(report.coverage.enemyDamage, report.coverage.teamDamage))}</dd></div>
    </dl>
    {(report.warnings.length > 0 || report.limitations.length > 0 || report.coverage.reasons.length > 0) && <details><summary>{t('quality-notes', 'Data quality notes')}</summary><p className="muted">{t('diagnostics-note', 'Original diagnostic messages from the analysis service.')}</p><ul>{[...report.coverage.reasons, ...report.warnings, ...report.limitations].map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
  </section>;
}
