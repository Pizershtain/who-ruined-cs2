import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthPlayerLink, AuthPlayerLinkInput } from '@who-ruined/contracts';
import { authPlayerLinkSchema } from '@who-ruined/contracts';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/index.js';
import { ApiClientError, request } from '../../shared/api/transport.js';
import { ErrorState, LoadingState } from '../../shared/ui/index.js';
import { ProfileAbout } from './ProfileAbout.js';
import { PlayerProfileView } from './PlayerProfilePage.js';

export function PersonalProfilePage() {
  const { snapshot, session } = useAuth();
  const { t } = useTranslation();
  if (snapshot.state === 'CHECKING') return <LoadingState/>;
  if (snapshot.state === 'UNAVAILABLE') return <div className="profile-section" role="status">
    <p>{t('auth-unavailable', 'Sign-in is temporarily unavailable.')}</p>
    {snapshot.logoutUnconfirmed
      ? <button type="button" className="button secondary" disabled={snapshot.busy} onClick={() => void session.logout()}>{t('retry', 'Try again')}</button>
      : <Link className="button secondary" to="/login">{t('auth-login', 'Sign in')}</Link>}
  </div>;
  if (!snapshot.user) return <Navigate to="/login" replace/>;
  return <AccountProfile key={snapshot.user.id} userId={snapshot.user.id} displayName={snapshot.user.displayName}/>;
}

function AccountProfile({ userId, displayName }: { userId: string; displayName: string }) {
  const { session, snapshot } = useAuth();
  const { t } = useTranslation();
  const client = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const key = ['auth-player-link', userId] as const;
  async function playerLink(method: 'GET' | 'PUT' | 'DELETE', input?: AuthPlayerLinkInput, signal?: AbortSignal) {
    try {
      return await session.withAccess(token => request('/api/v1/auth/player-link', {
        method, credentials: 'same-origin', cache: 'no-store', signal: signal ?? AbortSignal.timeout(15_000),
        headers: input ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${token}` },
        ...(input ? { body: JSON.stringify(input) } : {}),
      }, authPlayerLinkSchema));
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401 && !snapshot.busy
          && session.getSnapshot().user?.id === userId) void session.restore();
      throw error;
    }
  }
  const linkQuery = useQuery({
    queryKey: key, queryFn: ({ signal }) => playerLink('GET', undefined, signal),
    // A private query is keyed by account and discarded when its page unmounts.
    gcTime: 0, retry: false,
  });

  const change = useMutation({
    gcTime: 0,
    mutationFn: (input: AuthPlayerLinkInput | null) => input === null ? playerLink('DELETE') : playerLink('PUT', input),
    onSuccess: async (link: AuthPlayerLink) => {
      if (session.getSnapshot().user?.id !== userId) return;
      await client.cancelQueries({ queryKey: key, exact: true });
      if (session.getSnapshot().user?.id !== userId) return;
      client.setQueryData(key, link);
      const params = new URLSearchParams(search);
      params.set('tab', link.state === 'LINKED' ? 'stats' : 'about');
      setSearch(params, { preventScrollReset: true });
    },
  });

  if (!linkQuery.data) return linkQuery.isError
    ? <ErrorState message={t('auth-unavailable', 'Sign-in is temporarily unavailable.')}
      retry={() => void linkQuery.refetch()} busy={linkQuery.isFetching}/>
    : <LoadingState/>;
  const link = linkQuery.data;
  return <PlayerProfileView personal steamId={link.state === 'LINKED' ? link.steamId : null}
    nickname={link.state === 'LINKED' ? link.nickname : displayName}
    about={<ProfileAbout link={link} busy={change.isPending || snapshot.busy}
      error={change.error ?? linkQuery.error} save={input => change.mutate(input)}/>}/>;
}
