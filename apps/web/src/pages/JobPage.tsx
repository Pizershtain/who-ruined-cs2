import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../shared/messages.js';
import { ErrorState, JobSkeleton, RefreshStatus } from '../shared/ui/index.js';
import { JobProgress, ReuseNotice, useAnalysisJob } from '../features/upload-demo/index.js';
export function JobPage() {
  const { jobId = '' } = useParams();
  const common = useTranslation().t;
  const query = useAnalysisJob(jobId);
  if (query.data && ['COMPLETED', 'PARTIAL'].includes(query.data.status)) return <Navigate replace to={`/matches/${encodeURIComponent(query.data.matchId)}`}/>;
  return <><ReuseNotice status="ANALYSIS_IN_PROGRESS"/>
    {!query.data ? (query.isError ? <ErrorState message={errorMessage(query.error, common)} busy={query.isFetching} retry={() => void query.refetch()}/> : <JobSkeleton/>)
      : <><RefreshStatus fetching={query.isFetching && !!query.error} error={query.error} retry={() => void query.refetch()}/><JobProgress job={query.data}/></>}
  </>;
}
