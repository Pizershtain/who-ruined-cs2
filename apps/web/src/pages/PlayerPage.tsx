import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatch } from '../hooks/useMatch.js';
import { errorMessage } from '../shared/messages.js';
import { ErrorState, RefreshStatus } from '../components/States.js';
import { PlayerReport } from '../components/PlayerReport.js';
import { useAnalytics } from '../hooks/useAnalytics.js';
import { ReportSkeleton } from '../components/Skeleton.js';
import { AnalyticsNotice } from '../components/AnalyticsNotice.js';
import { usePlayerScoring } from '../hooks/useScoring.js';
import { presentPlayerScoring } from '../analytics/adapter.js';

export function PlayerPage() {
  const { playerId = '' } = useParams();
  const { t } = useTranslation();
  const query = useMatch();
  const analytics = useAnalytics(query.data);
  const scoring = usePlayerScoring(query.data, playerId);
  if (!query.data) return query.isError ? <ErrorState message={errorMessage(query.error, t)} busy={query.isFetching} retry={() => void query.refetch()}/> : <ReportSkeleton kind="player"/>;
  const presentation = analytics.data && scoring.data ? presentPlayerScoring(query.data, analytics.data, scoring.data) : analytics.data;
  return <><RefreshStatus fetching={query.isFetching} error={query.error} retry={() => void query.refetch()}/><PlayerReport key={query.data.matchId + playerId} match={query.data} playerId={playerId} base={`/matches/${encodeURIComponent(query.data.matchId)}`} analyticsLoading={analytics.isPending || scoring.isPending} {...(presentation ? { analytics: presentation } : {})} {...(scoring.data ? { scoring: scoring.data } : {})} notices={<div className="notices"><AnalyticsNotice loading={analytics.isFetching} error={analytics.error} data={analytics.data} retry={() => void analytics.refetch()}/>{!!scoring.error && !scoring.data && <div className="inline-alert" role="status">{errorMessage(scoring.error, t)}</div>}</div>}/></>;
}
