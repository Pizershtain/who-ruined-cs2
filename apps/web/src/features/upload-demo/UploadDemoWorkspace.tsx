import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DemoUploadForm } from './DemoUploadForm.js';
import { useRecentMatches } from './queries.js';
import { errorMessage, statusLabel } from '../../shared/messages.js';
import { Icon, RecentSkeleton, RefreshStatus, SignalIllustration, Story } from '../../shared/ui/index.js';

export function UploadDemoWorkspace() {
  const { t, i18n } = useTranslation('home');
  const common = useTranslation().t;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const recent = useRecentMatches();
  const items = recent.data?.pages.flatMap((page) => page.items) ?? [];

  return <>
    <Story hero className="upload-story" title={t('new-analysis', 'New analysis')} lead={t('description', 'Every round tells a story. Open your demo, explore the match and see what the numbers actually say.')}>
      <DemoUploadForm inputRef={input} onBusyChange={setBusy}/>
    </Story>
    <Story className="recent-story" title={t('recent-title', 'Recent matches')} lead={t('recent-note', 'Stored on this analysis server')}>
      <div className="recent">
        {recent.data && !recent.isFetchNextPageError && <RefreshStatus fetching={recent.isRefetching} error={recent.error} retry={() => void recent.refetch()}/>}
        {recent.isPending ? <RecentSkeleton/> :
          recent.isError && !recent.data ? <div className="empty-state" role="alert"><SignalIllustration mode="lost"/><p>{errorMessage(recent.error, common)}</p><button className="button primary" disabled={recent.isFetching} onClick={() => void recent.refetch()}>{common('retry', 'Try again')}</button></div> :
          !items.length ? <div className="empty-state empty-matches"><SignalIllustration mode="empty"/><div><h3>{t('empty-title', 'A clean slate.')}</h3><p>{t('empty-text', 'Your match reports will appear here after you upload a demo.')}</p><button className="button primary" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16}/>{t('step-upload', 'Bring your match')}</button></div></div> :
          <div className="recent-list">{items.map((item) => {
            const content = <><span className="map-tile"><Icon name="crosshair" size={26}/></span><span className="recent-map"><strong>{item.map ?? t('map-pending', 'Identifying map')}</strong><small>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</small></span><span className={`pill ${item.status === 'COMPLETED' ? 'success' : ''}`}>{statusLabel(item.status, common)}</span><Icon name={['COMPLETED', 'PARTIAL'].includes(item.status) ? 'arrow' : 'clock'}/></>;
            return ['COMPLETED', 'PARTIAL'].includes(item.status)
              ? <Link className="recent-row" key={item.id} to={`/matches/${encodeURIComponent(item.id)}`}>{content}</Link>
              : <div className="recent-row" key={item.id}>{content}</div>;
          })}</div>}
        {recent.isFetchNextPageError && <p className="inline-alert" role="status">{t('load-more-failed', 'Could not load more matches. Try again.')}</p>}
        {recent.hasNextPage && <button disabled={recent.isFetchingNextPage} className="button secondary load-more" onClick={() => void recent.fetchNextPage()}>{recent.isFetchingNextPage && <span className="spinner"/>}{t('load-more', 'Load more matches')}</button>}
      </div>
    </Story>
  </>;
}

