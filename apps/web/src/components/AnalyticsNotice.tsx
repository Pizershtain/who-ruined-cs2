import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiClientError } from '../api.js';
import type { MatchAnalytics } from '../analytics/types.js';
import { Icon } from './Icon.js';
import { errorMessage } from '../shared/messages.js';

export function AnalyticsNotice({ loading, error, data, retry }: { loading: boolean; error: unknown; data: MatchAnalytics | undefined; retry: () => void }) {
  const { t } = useTranslation('match');
  const common = useTranslation().t;
  if (loading && !data) return <div className="analytics-notice muted" role="status"><span className="spinner"/>{t('analytics-loading', 'Loading match metrics…')}</div>;
  if (error) {
    const legacy = error instanceof ApiClientError && error.status === 409;
    return <div className="inline-alert analytics-notice" role="status"><Icon name="warning"/><div><p>{legacy ? t('analytics-legacy', 'Metrics are unavailable for this report. Upload the demo again to run the current analysis.') : errorMessage(error, common)}</p>{data && <small>{common('refresh-failed', 'Could not refresh. Your last loaded data is still shown.')}</small>}</div>{legacy ? <Link className="button secondary" to="/">{t('upload-again', 'Upload demo')}</Link> : <button className="button secondary" disabled={loading} onClick={retry}>{common('retry', 'Try again')}</button>}</div>;
  }
  if (!data?.availability) return null;
  const complete = Object.values(data.availability).every((value) => value === 'AVAILABLE');
  return <details className={`analytics-notice analytics-quality ${complete ? 'complete' : ''}`}><summary><Icon name={complete ? 'check' : 'warning'} size={17}/>{complete ? t('analytics-ready', 'Match metrics are ready') : t('analytics-partial', 'Some metrics have limited source data')}<span className="disclosure-mark" aria-hidden="true">+</span></summary><div className="availability-grid">{[
    { label: t('source-damage', 'Damage'), value: data.availability.damage },
    { label: t('source-flashes', 'Flashes'), value: data.availability.flashes },
    { label: t('source-economy', 'Economy'), value: data.availability.economy },
    { label: t('source-alive', 'Alive-player context'), value: data.availability.aliveContext },
  ].map(({ label, value }) => <div key={label}><span>{label}</span><strong className={value === 'AVAILABLE' ? 'positive-text' : 'muted'}>{value === 'AVAILABLE' ? t('source-available', 'Available') : value === 'PARTIAL' ? t('source-partial', 'Partial') : t('source-unavailable', 'Unavailable')}</strong></div>)}</div>{!!data.limitations?.length && <div className="analysis-limitations"><p>{t('diagnostics-note', 'Original diagnostic messages from the analysis service.')}</p><ul>{data.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}</details>;
}
