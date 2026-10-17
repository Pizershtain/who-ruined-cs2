import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportSkeleton, RecentSkeleton, JobSkeleton } from '../components/Skeleton.js';
import { ErrorState, Unavailable } from '../components/States.js';
import { JobProgress } from '../components/JobProgress.js';
import { SignalIllustration } from '../components/SignalIllustration.js';
import { Icon } from '../components/Icon.js';

export default function StateGallery() {
  const { t } = useTranslation('preview');
  const { t: common } = useTranslation();
  const { t: home } = useTranslation('home');
  const [search, setSearch] = useSearchParams();
  const [started] = useState(() => new Date(Date.now() - 125_000).toISOString());
  const labels = {
    'match-loading': t('state-match-loading', 'Match loading'),
    'player-loading': t('state-player-loading', 'Player loading'),
    'recent-loading': t('state-recent-loading', 'Match list loading'),
    'job-loading': t('state-job-loading', 'Job loading'),
    processing: t('state-processing', 'Processing a demo'),
    failed: t('state-failed', 'Processing failed'),
    ready: t('state-ready', 'Report ready'),
    error: t('state-error', 'Request error'),
    empty: t('state-empty', 'No matches yet'),
    unavailable: t('state-unavailable', 'Unavailable metrics'),
    offline: t('state-offline', 'Offline'),
  };
  const requested = search.get('view') ?? 'match-loading';
  const view = Object.hasOwn(labels, requested) ? requested : 'match-loading';
  return <><aside className="preview-banner" role="note"><Icon name="warning"/><div><strong>{t('title', 'Design preview · synthetic data')}</strong><span>{t('description', 'Invented players, statistics and ratings. This is not a real demo analysis.')}</span></div></aside><section className="state-gallery-controls panel"><div><p className="eyebrow">{t('state-gallery', 'Interface states')}</p><p className="muted">{t('state-gallery-note', 'Choose a state to inspect its layout and motion. No requests are sent.')}</p></div><label><span className="sr-only">{t('scenario', 'Preview scenario')}</span><select value={view} onChange={(event) => setSearch({ view: event.target.value })}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></section><div className="state-gallery-view content-reveal" key={view}>
    {view === 'match-loading' && <ReportSkeleton/>}
    {view === 'player-loading' && <ReportSkeleton kind="player"/>}
    {view === 'recent-loading' && <RecentSkeleton/>}
    {view === 'job-loading' && <JobSkeleton/>}
    {['processing', 'failed', 'ready'].includes(view) && <JobProgress reportPath="/preview/available" job={{ id: 'synthetic-job', matchId: 'synthetic-design-match', createdAt: started, updatedAt: started, stage: 'PARSING', status: view === 'failed' ? 'FAILED' : view === 'ready' ? 'COMPLETED' : 'PARSING', ...(view === 'failed' ? { errorCode: 'PARSE_FAILED' } : {}) }}/>
    }
    {view === 'error' && <ErrorState message={common('error-network', 'Cannot reach the analysis service. Check your connection and try again.')} retry={() => setSearch({ view: 'match-loading' })}/>}
    {view === 'empty' && <div className="panel empty-state empty-matches"><SignalIllustration mode="empty"/><div><h3>{home('empty-title', 'A clean slate.')}</h3><p>{home('empty-text', 'Your match reports will appear here after you upload a demo.')}</p></div></div>}
    {view === 'unavailable' && <div className="panel"><Unavailable/></div>}
    {view === 'offline' && <div className="connection-banner" role="status"><Icon name="offline"/>{common('offline', 'You are offline. Updates will resume when your connection returns.')}</div>}
  </div></>;
}
