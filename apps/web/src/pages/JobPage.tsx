import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getJob } from '../api.js';
import { errorMessage } from '../shared/messages.js';
import { ErrorState, RefreshStatus } from '../components/States.js';
import { JobSkeleton } from '../components/Skeleton.js';
import { JobProgress } from '../components/JobProgress.js';
export function JobPage() {
  const { jobId = '' } = useParams();
  const common = useTranslation().t;
  const query = useQuery({
    queryKey: ['job', jobId], queryFn: ({ signal }) => getJob(jobId, signal),
    refetchInterval: (state) => {
      if (state.state.error) return false;
      return state.state.data && ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(state.state.data.status) ? false : 2000;
    },
  });
  if (query.data && ['COMPLETED', 'PARTIAL'].includes(query.data.status)) return <Navigate replace to={`/matches/${encodeURIComponent(query.data.matchId)}`}/>;
  if (!query.data) return query.isError ? <ErrorState message={errorMessage(query.error, common)} busy={query.isFetching} retry={() => void query.refetch()}/> : <JobSkeleton/>;
  return <><RefreshStatus fetching={query.isFetching && !!query.error} error={query.error} retry={() => void query.refetch()}/><JobProgress job={query.data}/></>;
}
