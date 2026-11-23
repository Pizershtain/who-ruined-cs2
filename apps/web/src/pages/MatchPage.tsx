import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnalyticsNotice, MatchReport, useAnalytics, useMatch } from '../features/match-report/index.js';
import { ErrorState, RefreshStatus, ReportSkeleton } from '../shared/ui/index.js';
import { errorMessage } from '../shared/messages.js';
import { EvpAwards, ScoringNotice, presentParticipationRating, useParticipationRating } from '../features/participation-rating/index.js';
import { useParticipationExplanation } from '../features/rating-explanation/index.js';

export function MatchPage() {
  const { t } = useTranslation();
  const { matchId = '' } = useParams();
  const query = useMatch(matchId);
  const analytics = useAnalytics(query.data);
  const explanation = useParticipationExplanation(query.data);
  const rating = useParticipationRating(query.data);
  if (!query.data) return query.isError ? <ErrorState message={errorMessage(query.error, t)} busy={query.isFetching} retry={() => void query.refetch()}/> : <ReportSkeleton/>;
  const presentation = rating.data ? presentParticipationRating(query.data, analytics.data, rating.data) : analytics.data;
  return <><RefreshStatus fetching={query.isFetching} error={query.error} retry={() => void query.refetch()}/>{!rating.data && <AnalyticsNotice loading={analytics.isFetching} error={analytics.error} data={analytics.data} retry={() => void analytics.refetch()}/>}<ScoringNotice loading={rating.isFetching} error={rating.error} {...(rating.data ? { report: rating.data } : {})} retry={() => void rating.refetch()}/><MatchReport awardsPanel={<EvpAwards match={query.data}/>} key={query.data.matchId} match={query.data} base={`/matches/${encodeURIComponent(query.data.matchId)}`} analyticsLoading={analytics.isPending || rating.isPending} momentsLoading={explanation.isPending || explanation.isFetching} momentsError={explanation.error} momentsRetry={() => void explanation.refetch()} {...(explanation.data ? { explanation: explanation.data } : {})} {...(presentation ? { analytics: presentation } : {})}/></>;
}
