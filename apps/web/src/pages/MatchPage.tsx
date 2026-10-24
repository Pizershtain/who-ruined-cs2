import { useMatch } from '../hooks/useMatch.js';
import { useTranslation } from 'react-i18next';
import { MatchReport } from '../components/MatchReport.js';
import { ErrorState, RefreshStatus } from '../components/States.js';
import { errorMessage } from '../shared/messages.js';
import { useAnalytics } from '../hooks/useAnalytics.js';
import { ReportSkeleton } from '../components/Skeleton.js';
import { AnalyticsNotice } from '../components/AnalyticsNotice.js';
import { ScoringNotice } from '../components/ScoringNotice.js';
import { useScoring } from '../hooks/useScoring.js';
import { presentScoring } from '../analytics/adapter.js';

export function MatchPage() {
  const { t } = useTranslation();
  const query = useMatch();
  const analytics = useAnalytics(query.data);
  const scoring = useScoring(query.data);
  if (!query.data) return query.isError ? <ErrorState message={errorMessage(query.error, t)} busy={query.isFetching} retry={() => void query.refetch()}/> : <ReportSkeleton/>;
  const presentation = analytics.data && scoring.data ? presentScoring(query.data, analytics.data, scoring.data) : analytics.data;
  return <><RefreshStatus fetching={query.isFetching} error={query.error} retry={() => void query.refetch()}/><MatchReport key={query.data.matchId} match={query.data} base={`/matches/${encodeURIComponent(query.data.matchId)}`} analyticsLoading={analytics.isPending || scoring.isPending} {...(presentation ? { analytics: presentation } : {})} notices={<div className="notices"><AnalyticsNotice loading={analytics.isFetching} error={analytics.error} data={analytics.data} retry={() => void analytics.refetch()}/><ScoringNotice loading={scoring.isFetching} error={scoring.error} {...(scoring.data ? { report: scoring.data } : {})} retry={() => void scoring.refetch()}/></div>}/></>;
}
