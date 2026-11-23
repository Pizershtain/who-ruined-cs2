import type { StoredParticipationRating } from '@who-ruined/contracts';
import { useTranslation } from 'react-i18next';
import { ApiClientError } from '../../shared/api/transport.js';
import { errorMessage } from '../../shared/messages.js';
import { canRetryRatingError } from '../../shared/scoring.js';
import { Icon } from '../../shared/ui/Icon.js';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import { Disclosure } from '../../shared/ui/Disclosure.js';

export function ScoringNotice({ loading, error, report, retry }: { loading: boolean; error: unknown; report?: StoredParticipationRating; retry: () => void }) {
  const { t, i18n } = useTranslation('match');
  const common = useTranslation().t;
  const integer = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  if (loading && !report) return <div className="panel analytics-notice" role="status" aria-busy="true"><Skeleton className="skeleton-metric"/><span>{t('rating-loading', 'Loading the experimental rating…')}</span></div>;
  if (error && !report) {
    const message = error instanceof ApiClientError ? errorMessage(error, common) : common('error-general', 'Something went wrong. Please try again.');
    const retryable = canRetryRatingError(error);
    return <div className="inline-alert" role="status"><Icon name="warning"/><p>{message}</p>{retryable && <button className="button secondary" onClick={retry}>{common('retry', 'Try again')}</button>}</div>;
  }
  if (!report) return null;
  return <section className="panel scoring-notice" aria-label={t('active-rating', 'Experimental participation rating')}>
    <Disclosure className="rating-beta" variant="quiet" title={t('rating-beta', 'Beta')}><p>{t('rating-noncausal', 'This uncalibrated score describes measured participation. It is not proof of tactical blame or intent.')}</p></Disclosure>
    <dl className="availability-list">
      <div className="rating-pool"><dt>{t('eligible-pool', 'Calculated players')}</dt><dd>{integer(report.awards.eligiblePoolSize)} / {integer(report.players.length)}</dd></div>
      <div><dt>{t('award-outcome', 'Outcome')}</dt><dd>{report.awards.outcome === 'DECIDED' ? t('outcome-decided', 'Decided') : report.awards.outcome === 'DRAW' ? t('outcome-draw', 'Draw') : t('outcome-unknown', 'Unknown')}</dd></div>
      <div className={report.awards.incompletePool ? 'coverage-partial' : 'coverage-complete'}><dt>{t('rating-coverage', 'Rating coverage')}</dt><dd>{report.awards.incompletePool ? t('coverage-partial', 'Partial') : t('coverage-complete', 'Complete')}</dd></div>
    </dl>
  </section>;
}

