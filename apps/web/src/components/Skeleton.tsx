import { useTranslation } from 'react-i18next';

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true"/>;
}

export function ReportSkeleton({ kind = 'match' }: { kind?: 'match' | 'player' }) {
  const { t } = useTranslation();
  return <section className={`report-skeleton ${kind}-skeleton`} role="status" aria-busy="true">
    <span className="sr-only">{t('loading', 'Loading…')}</span>
    <Skeleton className="skeleton-breadcrumb"/>
    <div className="panel skeleton-hero"><Skeleton className="skeleton-avatar"/><div><Skeleton className="skeleton-label"/><Skeleton className="skeleton-title"/><Skeleton className="skeleton-line"/></div><Skeleton className="skeleton-score"/></div>
    <div className={`skeleton-cards ${kind === 'player' ? 'skeleton-stats' : ''}`}>{Array.from({ length: kind === 'player' ? 5 : 2 }, (_, index) => <div className="panel skeleton-card" key={index}><Skeleton className="skeleton-label"/><Skeleton className="skeleton-title"/><Skeleton className="skeleton-line"/></div>)}</div>
    <div className="skeleton-table panel"><Skeleton className="skeleton-title"/>{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><Skeleton className="skeleton-avatar"/><Skeleton className="skeleton-line"/><Skeleton className="skeleton-cell"/><Skeleton className="skeleton-cell"/><Skeleton className="skeleton-cell"/></div>)}</div>
    <div className="skeleton-cards"><ChartSkeleton/><ChartSkeleton/></div>
  </section>;
}

export function RecentSkeleton() {
  const { t } = useTranslation();
  return <div className="recent-list" role="status" aria-busy="true"><span className="sr-only">{t('loading', 'Loading…')}</span>{[0, 1, 2].map((index) => <div className="panel recent-row skeleton-row" key={index}><Skeleton className="skeleton-avatar"/><div className="skeleton-row-copy"><Skeleton className="skeleton-label"/><Skeleton className="skeleton-line"/></div><Skeleton className="skeleton-cell"/></div>)}</div>;
}

export function ChartSkeleton() {
  const { t } = useTranslation();
  return <div className="chart-skeleton" role="status" aria-busy="true"><span className="sr-only">{t('loading', 'Loading…')}</span>{[72, 91, 58, 80, 44].map((width, index) => <div className="skeleton-chart-row" key={index}><Skeleton className="skeleton-label"/><div style={{ width: `${width}%` }}><Skeleton className="skeleton-line"/></div></div>)}</div>;
}

export function JobSkeleton() {
  const { t } = useTranslation();
  return <section className="job-page report-skeleton" role="status" aria-busy="true"><span className="sr-only">{t('loading', 'Loading…')}</span><Skeleton className="skeleton-breadcrumb"/><Skeleton className="skeleton-title"/><div className="panel job-panel"><Skeleton className="skeleton-orbit"/><Skeleton className="skeleton-line"/>{[0, 1, 2, 3].map((index) => <div className="skeleton-row" key={index}><Skeleton className="skeleton-avatar"/><Skeleton className="skeleton-line"/></div>)}</div></section>;
}
