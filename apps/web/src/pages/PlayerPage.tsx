import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMatch } from '../hooks/useMatch.js';
import { errorMessage } from '../shared/messages.js';
import { ErrorState, RefreshStatus } from '../components/States.js';
import { PlayerReport } from '../components/PlayerReport.js';
import { useAnalytics } from '../hooks/useAnalytics.js';
import { ReportSkeleton } from '../components/Skeleton.js';
import { AnalyticsNotice } from '../components/AnalyticsNotice.js';
import { useParticipationExplanation, useParticipationRating } from '../hooks/useScoring.js';
import { presentParticipationRating } from '../analytics/adapter.js';
import { ScoringNotice } from '../components/ScoringNotice.js';

export function PlayerPage() {
  const { playerId = '' } = useParams();
  const { t } = useTranslation();
  const query = useMatch();
  const analytics = useAnalytics(query.data);
  const explanation = useParticipationExplanation(query.data);
  const rating = useParticipationRating(query.data);
  if (!query.data) return query.isError ? <ErrorState message={errorMessage(query.error, t)} busy={query.isFetching} retry={() => void query.refetch()}/> : <ReportSkeleton kind="player"/>;
  const presentation = rating.data ? presentParticipationRating(query.data, analytics.data, rating.data) : analytics.data;
  return <><RefreshStatus fetching={query.isFetching} error={query.error} retry={() => void query.refetch()}/>{!rating.data && <AnalyticsNotice loading={analytics.isFetching} error={analytics.error} data={analytics.data} retry={() => void analytics.refetch()}/>}<ScoringNotice loading={rating.isFetching} error={rating.error} {...(rating.data ? { report: rating.data } : {})} retry={() => void rating.refetch()}/><PlayerReport key={query.data.matchId + playerId} match={query.data} playerId={playerId} base={`/matches/${encodeURIComponent(query.data.matchId)}`} analyticsLoading={analytics.isPending || rating.isPending} momentsLoading={explanation.isPending || explanation.isFetching} momentsError={explanation.error} momentsRetry={() => void explanation.refetch()} {...(explanation.data ? { explanation: explanation.data } : {})} {...(presentation ? { analytics: presentation } : {})}/></>;
}
