import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { playerPath } from '../../entities/match/presentation.js';
import { useFamilyLabels } from '../../entities/match/family-labels.js';
import { specializationAxis, useRadarLabels } from '../../entities/match/radar.js';
import { ErrorState, LoadingState, RefreshStatus } from '../../shared/ui/index.js';
import { errorMessage } from '../../shared/messages.js';
import { Metric, measurementValue } from './metrics.js';
import { uniqueProfileMatches, useProfileHistory } from './queries.js';

export function ProfileHistory({ steamId, personal, showAll }: { steamId: string; personal: boolean; showAll?: () => void }) {
  const query = useProfileHistory(steamId, showAll ? 3 : 20);
  const { t, i18n } = useTranslation('player');
  const common = useTranslation().t;
  const { t: tm } = useTranslation('match');
  const { t: home } = useTranslation('home');
  const families = useFamilyLabels();
  const axes = useRadarLabels();
  const dates = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });
  const items = query.data ? uniqueProfileMatches(query.data.pages).slice(0, showAll ? 3 : undefined) : [];
  return <section className="profile-section">
    <h2>{t('profile-history', 'Match history')}</h2>
    {!query.data ? (query.error
      ? <ErrorState message={errorMessage(query.error, common)} retry={() => void query.refetch()} busy={query.isFetching}/>
      : <LoadingState/>)
      : <>
        <RefreshStatus fetching={query.isFetching && !query.isFetchingNextPage} error={query.isFetchNextPageError ? null : query.error} retry={() => void query.refetch()}/>
        {!items.length && <p className="muted">{t('profile-empty-history', 'No matches in this profile yet.')}</p>}
        <ul className="profile-history">{items.map(match => {
          const { player } = match;
          const base = `/matches/${encodeURIComponent(match.matchId)}`;
          const stamp = match.playedAt ?? match.uploadedAt;
          const awardUnavailable = player.awards.mvp === null || player.awards.whoRuined === null || player.awards.evp === null;
          const outcome = player.outcome === 'WIN' ? t('won', 'Victory') : player.outcome === 'LOSS' ? t('lost', 'Defeat')
            : player.outcome === 'DRAW' ? t('draw', 'Draw') : t('unknown-result', 'Result unconfirmed');
          return <li key={match.matchId}>
            <div className="profile-history-heading"><div>
              <h3><Link to={base}><bdi>{match.map ?? tm('unknown-map', 'Unknown map')}</bdi></Link></h3>
              <div className="player-meta"><bdi>{player.displayName || t('unnamed', 'Unnamed player')}</bdi>
                {player.teamLabel && <bdi>{player.teamLabel}</bdi>}
                <span><time dateTime={stamp}>{dates.format(new Date(stamp))}</time>
                  {match.playedAt === null && <> · {t('profile-upload-date', 'Upload date')}</>}</span></div>
            </div><span className="pill">{outcome}</span></div>
            <dl className="profile-metrics">
              <Metric label="H3" value={player.rating?.value ?? null}/>
              <Metric label="K" value={measurementValue(player.measurements.kills)} datum={player.measurements.kills}/>
              <Metric label="D" value={measurementValue(player.measurements.deaths)} datum={player.measurements.deaths}/>
              <Metric label="A" value={measurementValue(player.measurements.assists)} datum={player.measurements.assists}/>
              <Metric label="ADR" value={measurementValue(player.measurements.adr)} datum={player.measurements.adr}/>
              <Metric label="KAST" value={measurementValue(player.measurements.kast, 100)} datum={player.measurements.kast} percent/>
            </dl>
            <div className="profile-history-actions">
              {player.awards.mvp && <b className="report-award mvp">MVP</b>}
              {player.awards.whoRuined && <b>{t('who-ruined', 'Who Ruined')}</b>}
              {player.awards.evp?.map(id => <b className="report-award evp" key={id}>EVP · {axes[specializationAxis[id]]}</b>)}
              {awardUnavailable && <small className="muted">{t('profile-awards-incomplete', 'Some award data is unavailable.')}</small>}
              {/^[A-Za-z0-9:_-]{1,160}$/u.test(player.playerId)
                && <Link className="button secondary" to={playerPath(base, player.playerId)}>{personal
                  ? t('profile-match-self', 'Me in this match') : t('profile-match-player', 'Player in this match')}</Link>}
              <Link className="button secondary" to={base}>{t('profile-to-match', 'View match')}</Link>
            </div>
            {player.rating && <details className="profile-family-history">
              <summary>{t('rating-explanation-title', 'How the rating was formed')}</summary>
              <dl className="profile-metrics">{player.rating.families.map(item =>
                <Metric key={item.family} label={families[item.family]} value={item.finalAttribution}/>)}</dl>
            </details>}
          </li>;
        })}</ul>
        {query.isFetchNextPageError && <p className="inline-alert" role="alert">{home('load-more-failed', 'Could not load more matches. Try again.')}</p>}
        {!showAll && query.hasNextPage && <button className="button secondary" type="button" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? common('loading', 'Loading…') : home('load-more', 'Load more matches')}
        </button>}
        {showAll && items.length > 0 && <button className="button secondary" type="button" onClick={showAll}>{t('profile-tab-matches', 'All matches')}</button>}
      </>}
  </section>;
}
