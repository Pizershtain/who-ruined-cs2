import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getJob, getMatches } from './api.js';

export const uploadDemoKeys = {
  matches: ['matches'] as const,
  job: (jobId: string) => ['job', jobId] as const,
};

export function useRecentMatches() {
  return useInfiniteQuery({
    queryKey: uploadDemoKeys.matches,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => getMatches(signal, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((item) => !['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(item.status))) ? 4000 : false,
  });
}

export function useAnalysisJob(jobId: string) {
  return useQuery({
    queryKey: uploadDemoKeys.job(jobId),
    queryFn: ({ signal }) => getJob(jobId, signal),
    refetchOnWindowFocus: true,
    refetchInterval: (state) => {
      if (state.state.error) return false;
      return state.state.data && ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(state.state.data.status) ? false : 2000;
    },
  });
}
