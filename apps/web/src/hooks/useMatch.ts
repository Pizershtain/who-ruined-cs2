import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getMatch } from '../api.js';

export function useMatch() {
  const { matchId = '' } = useParams();
  return useQuery({ queryKey: ['match', matchId], queryFn: ({ signal }) => getMatch(matchId, signal), staleTime: 60_000, retry: 1 });
}
