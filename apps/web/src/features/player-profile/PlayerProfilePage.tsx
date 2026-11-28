import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { profileSteamIdSchema } from '@who-ruined/contracts';
import { steamProfileUrl } from '../../entities/match/player.js';
import { DemoUploadForm } from '../upload-demo/index.js';
import { ApiClientError } from '../../shared/api/transport.js';
import { errorMessage } from '../../shared/messages.js';
import { ErrorState, Icon, LoadingState, RefreshStatus } from '../../shared/ui/index.js';
import { usePlayerProfile } from './queries.js';
import { ProfileHistory } from './ProfileHistory.js';
import { ProfileSummary } from './ProfileSummary.js';
import { ProfileTabs, useProfileTabs, type ProfileTab } from './ProfileTabs.js';

export function PlayerProfilePage() {
  const { steamId } = useParams();
  const { t } = useTranslation('player');
  const validated = profileSteamIdSchema.safeParse(steamId);
  return validated.success ? <PlayerProfileView key={validated.data} steamId={validated.data} personal={false}/> :
    <ErrorState message={t('profile-invalid-steam-id', 'This link has an invalid SteamID64.')}/>;
}

export function PlayerProfileView({ steamId, nickname, personal, about }: {
  steamId: string | null; nickname?: string; personal: boolean; about?: ReactNode;
}) {
  const { t } = useTranslation('player');
  const common = useTranslation().t;
  const query = usePlayerProfile(steamId);
  const { tab, select, id } = useProfileTabs(personal, steamId !== null);
  const [loaded, setLoaded] = useState<ReadonlySet<ProfileTab>>(() => new Set([tab]));
  if (!loaded.has(tab)) setLoaded(new Set([...loaded, tab]));
  const retry = () => void query.refetch();
  const code = query.error instanceof ApiClientError ? query.error.code : null;
  const steam = steamId ? steamProfileUrl(steamId) : null;
  const profile = query.data?.profile;
  const syncState = query.data?.syncState;

  function emptyProfile() {
    if (!steamId) return <div className="profile-section">
      <p>{t('profile-link-prompt', 'Add your SteamID64 in About me.')}</p>
      <button type="button" className="button secondary" onClick={() => select('about')}>{t('profile-tab-about', 'About me')}</button>
    </div>;
    if (!query.error) return <LoadingState/>;
    if (code === 'PROFILE_NOT_FOUND' && personal) return <p className="profile-section">{t('profile-link-no-matches', 'No analyzed matches for this SteamID yet.')}</p>;
    const message = code === 'PROFILE_NOT_READY' ? t('profile-not-ready', 'This profile is still being synchronized.')
      : code === 'PROFILE_NOT_FOUND' ? t('profile-not-found', 'No saved profile was found for this player.')
      : code === 'UPSTREAM_UNAVAILABLE' || code === 'UPSTREAM_TIMEOUT' ? t('profile-service-unavailable', 'Player profiles are temporarily unavailable.')
      : errorMessage(query.error, common);
    return <ErrorState message={message} retry={retry} busy={query.isFetching}/>;
  }

  function panel(name: ProfileTab, content: ReactNode) {
    return <section role="tabpanel" tabIndex={0} id={`${id}-panel-${name}`} aria-labelledby={`${id}-tab-${name}`} hidden={tab !== name}>
      {loaded.has(name) && content}
    </section>;
  }

  return <article className="persistent-profile" data-profile-revision={query.data?.revision ?? undefined}>
    <header className={personal ? 'player-hero personal-profile-hero' : 'player-hero'}>
      <div className="profile-identity">
        <span className="profile-avatar" aria-hidden="true"><Icon name="crosshair" size={40}/></span>
        <div><p className="eyebrow">{personal ? t('profile-personal', 'My profile') : t('persistent-profile', 'Player profile')}</p>
          <h1><bdi>{profile?.displayName || nickname || t('unnamed', 'Unnamed player')}</bdi></h1>
          <div className="player-meta">{steamId && <bdi>{steamId}</bdi>}{steam && <a href={steam} target="_blank" rel="noreferrer">{t('steam', 'Steam profile')} ↗</a>}</div>
        </div>
      </div>
      {personal && <DemoUploadForm compact/>}
    </header>
    <ProfileTabs id={id} personal={personal} tab={tab} select={select}/>
    {steamId && profile && tab !== 'about' && <>
      <RefreshStatus fetching={query.isFetching} error={query.error} retry={retry}/>
      {syncState !== 'CURRENT' && <div className="inline-alert profile-freshness" role="status">
        <span>{syncState === 'REBUILDING' ? t('profile-rebuilding', 'The profile is being rebuilt. Showing the last saved data.')
          : t('profile-stale', 'This profile may be out of date. Showing the last saved data.')}</span>
        {!query.error && <button type="button" className="button secondary" disabled={query.isFetching} onClick={retry}>{common('retry', 'Try again')}</button>}
      </div>}
    </>}
    {panel('stats', steamId && profile ? <>
      <ProfileSummary profile={profile}/>
      <ProfileHistory key={steamId} steamId={steamId} personal={personal} showAll={() => {
        select('matches');
        document.getElementById(`${id}-tab-matches`)?.focus();
      }}/>
    </> : tab === 'stats' && emptyProfile())}
    {panel('matches', steamId && profile
      ? <ProfileHistory key={steamId} steamId={steamId} personal={personal}/>
      : tab === 'matches' && emptyProfile())}
    {personal && panel('about', about)}
  </article>;
}
