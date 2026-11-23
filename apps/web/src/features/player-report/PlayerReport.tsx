import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, MatchEvent, StoredParticipationExplanation } from '@who-ruined/contracts';
import type { TFunction } from 'i18next';
import type { MatchAnalytics } from '../../entities/match/types.js';
import { playerEvents, teamOutcome, timeAtTick } from '../../entities/match/presentation.js';
import { steamProfileUrl } from '../../entities/match/player.js';
import { ImportantMoments } from '../important-moments/index.js';
import { Charts } from '../match-report/index.js';
import { Icon } from '../../shared/ui/Icon.js';
import { ErrorState, Unavailable } from '../../shared/ui/States.js';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import { RatingExplanation } from '../rating-explanation/index.js';
import { PlayerMetrics } from './PlayerMetrics.js';
import { ParticipationCoverage } from './ParticipationCoverage.js';
import { EventDetails } from './EventDetails.js';

function eventLabel(event: MatchEvent, playerId: string, t: TFunction): string {
  if (event.kind === 'PLAYER_DEATH' || event.kind === 'PLAYER_DEATH_NONLIVE') {
    if (event.targetId === playerId) return t('recorded-death', 'Recorded death');
    if (event.assisterId === playerId) return t('recorded-assist', 'Recorded assist');
    return event.attrs.friendlyFire === true ? t('recorded-teamkill', 'Recorded team kill') : t('recorded-kill', 'Recorded elimination');
  }
  switch (event.kind) {
    case 'PLAYER_HURT': return t('recorded-damage', 'Recorded damage');
    case 'PLAYER_BLIND': return t('recorded-flash', 'Recorded flash');
    case 'BOMB_PLANTED': return t('recorded-plant', 'Bomb planted');
    case 'BOMB_DEFUSED': return t('recorded-defuse', 'Bomb defused');
    case 'BOMB_EXPLODED': return t('recorded-explosion', 'Bomb exploded');
    case 'ECONOMY_SNAPSHOT': return t('recorded-equipment', 'Equipment recorded');
    default: return t('recorded-event', 'Recorded event');
  }
}
export function PlayerReport({ radarPanel, match, playerId, base, analytics, explanation, analyticsLoading = false, momentsLoading = false, momentsError, momentsRetry }: { radarPanel?: ReactNode; match: MatchData; playerId: string; base: string; analytics?: MatchAnalytics; explanation?: StoredParticipationExplanation; analyticsLoading?: boolean; momentsLoading?: boolean; momentsError?: unknown; momentsRetry?: () => void }) {
  const { t, i18n } = useTranslation('player');
  const { t: tm } = useTranslation('match');
  const [factCategory, setFactCategory] = useState('');
  const [roundId, setRoundId] = useState('');
  const [visible, setVisible] = useState(30);
  const player = match.players.find((item) => item.id === playerId);
  if (!player) return <ErrorState message={t('not-found', 'This player is not in this match.')}/>;
  const team = match.teams.find((item) => item.id === player.teamId);
  const steam = steamProfileUrl(player.steamId);
  const outcome = teamOutcome(match, player.teamId);
  const metrics = analytics?.players[playerId];
  const factEvents = new Set(metrics?.analytics?.facts.filter(fact => fact.category === factCategory).map(fact => fact.eventId));
  const events = playerEvents(match, playerId).filter((event) => (!roundId || event.roundId === roundId) && (!factCategory || factEvents.has(event.id))).sort((a, b) => a.tick - b.tick);
  const number = (value: number | null | undefined, digits = 1) => value == null ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: digits }).format(value);
  const pending = analyticsLoading && !analytics;
  const stats = [
    { title: 'K / D / A', value: [metrics ? metrics.kills : player.scoreboard?.kills, metrics ? metrics.deaths : player.scoreboard?.deaths, metrics ? metrics.assists : player.scoreboard?.assists].map(number).join(' / '), pending },
    { title: 'ADR', value: number(metrics?.adr), pending }, { title: 'KAST %', value: number(metrics?.kast), pending },
    { title: t('opening', 'Opening kills / deaths'), value: number(metrics?.openingKills) + ' / ' + number(metrics?.openingDeaths), pending },
    { title: t('trades', 'Successful trades'), value: number(metrics?.trades), pending },
  ];
  const rating = metrics?.rating;
  const explanationPlayer = explanation?.players.find((item) => item.playerId === playerId);
  const availabilityLabel = () => {
    switch (metrics?.ratingAvailability) {
      case 'PARTICIPATION_ABSENT_GT_2_ROUNDS': return t('rating-absent', 'Player was absent for too many verified rounds.');
      case 'PARTICIPATION_EVIDENCE_UNKNOWN': return t('rating-evidence-unknown', 'Participation evidence is unknown.');
      case 'PARTIAL_COVERAGE_INSUFFICIENT': return t('rating-partial-insufficient', 'Partial round coverage is insufficient.');
      case 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE': return t('rating-exposure-insufficient', 'There is not enough verified exposure.');
      case 'UNKNOWN_APPLICABILITY': return t('rating-applicability-unknown', 'Rating applicability is unknown.');
      default: return t('rating-unavailable', 'The active rating is unavailable.');
    }
  };
  const isMvp = analytics?.mvp.state === 'available' && analytics.mvp.playerId === playerId;
  const isWhoRuined = analytics?.whoRuined.state === 'available' && analytics.whoRuined.playerId === playerId;
  return <>
    <Link className="text-link back-link" to={base}><Icon name="back" size={17}/>{t('back', 'Back to match report')}</Link>
    <section className="player-hero panel"><span className="profile-avatar"><Icon name="crosshair" size={42}/></span><div><p className="eyebrow">{t('eyebrow', 'Player · this match only')}</p><h1>{player.displayName || t('unnamed', 'Unnamed player')}</h1><div className="player-meta"><span>{team?.label ?? '—'}</span><span>{match.map ?? '—'}</span>{steam && <a href={steam} target="_blank" rel="noreferrer">{t('steam', 'Steam profile')} ↗</a>}</div></div><span className={`pill ${outcome === 'win' ? 'success' : ''}`}>{outcome === 'win' ? t('won', 'Victory') : outcome === 'loss' ? t('lost', 'Defeat') : outcome === 'draw' ? t('draw', 'Draw') : t('unknown-result', 'Result unconfirmed')}</span></section>
    <section className="player-stats">{stats.map((item) => <div className="panel stat-card" key={item.title}><span>{item.title}</span><strong>{item.pending ? <Skeleton className="skeleton-metric"/> : item.value}</strong></div>)}</section>
    <section className="rating-section">
      <div className="player-insights scoring-components">
        <article className="panel rating-summary"><p className="eyebrow">{t('active-rating', 'Active participation rating')}</p><strong>{rating ? number(rating.value, 3) : '—'}</strong>
          {rating ? <dl className="detail-stats"><div><dt>{t('overall-rank', 'Overall rank')}</dt><dd>#{number(rating.rank, 0)}</dd></div>{rating.losingTeamRank !== null && <div><dt>{t('losing-team-rank', 'Losing-roster rank')}</dt><dd>#{number(rating.losingTeamRank, 0)}</dd></div>}</dl> : <><p>{availabilityLabel()}</p></>}
          {(isMvp || isWhoRuined) && <div className="award-badges">{isMvp && <span className="pill success">{t('mvp', 'Match MVP')}</span>}{isWhoRuined && <span className="pill warning">{t('who-ruined', 'Who Ruined')}</span>}</div>}
        </article>
        <article className="panel rating-coverage-card"><h2>{t('rating-coverage', 'Verified coverage')}</h2>{metrics?.ratingCoverage ? <dl className="detail-stats"><div><dt>{t('verified-rounds', 'Verified rounds')}</dt><dd>{number(metrics.ratingCoverage.verifiedRounds, 0)}</dd></div><div><dt>{t('partial-rounds', 'Partial rounds')}</dt><dd>{number(metrics.ratingCoverage.partialRounds, 0)}</dd></div><div><dt>{t('unknown-rounds', 'Unknown rounds')}</dt><dd>{number(metrics.ratingCoverage.unknownRounds, 0)}</dd></div><div><dt>{t('absent-rounds', 'Absent full rounds')}</dt><dd>{number(metrics.ratingCoverage.absentFullRounds, 0)}</dd></div></dl> : <Unavailable/>}<ParticipationCoverage metrics={metrics}/></article>
      </div>
      <RatingExplanation match={match} base={base} loading={momentsLoading} error={momentsError} {...(explanationPlayer ? { player: explanationPlayer } : {})} {...(momentsRetry ? { retry: momentsRetry } : {})}/>
    </section>
    {radarPanel}
    <ImportantMoments match={match} base={base} playerId={playerId} loading={momentsLoading} error={momentsError} {...(momentsRetry ? { retry: momentsRetry } : {})} {...(explanation ? { report: explanation } : {})}/>
    <PlayerMetrics metrics={metrics} loading={pending}/>
    <Charts match={{ ...match, players: [player] }} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>
    <section className="panel event-panel"><div className="section-heading"><div><p className="eyebrow">{t('facts', 'Recorded facts')}</p><h2>{t('events', 'Demo event log')}</h2></div><label className="select-label"><span className="sr-only">{t('filter-round', 'Filter by round')}</span><select value={roundId} onChange={(event) => { setRoundId(event.target.value); setVisible(30); }}><option value="">{t('all-rounds', 'All rounds')}</option>{match.rounds.map((round) => <option key={round.id} value={round.id}>{t('round', 'Round {{round}}', { round: round.ordinal })}</option>)}</select></label></div>
      <p className="data-note">{t('events-note', 'These are parsed events, not tactical judgements. Timecodes are absolute demo time, not video clips.')}</p>
      {metrics?.analytics && <div className="metric-tabs" role="group" aria-label={tm('metrics-fact-category', 'Fact category')}>{[
        { id: '', label: tm('metrics-all-events', 'All events') },
        { id: 'POSITIVE_CONTRIBUTION', label: tm('metrics-positive', 'Positive contributions') },
        { id: 'ERROR', label: tm('metrics-team-harm', 'Recorded team harm') },
        { id: 'NEUTRAL', label: tm('metrics-neutral', 'Neutral facts') },
      ].map(item => <button type="button" className="button secondary" key={item.id} aria-pressed={factCategory === item.id} onClick={() => { setFactCategory(item.id); setVisible(30); }}>{item.label}</button>)}</div>}
      {!events.length ? <div className="empty-state"><p>{t('no-events', 'No recorded events match this selection.')}</p>{roundId && <button className="button secondary" onClick={() => setRoundId('')}>{t('all-rounds', 'All rounds')}</button>}</div> :
        <ol className="event-list content-reveal" key={roundId}>{events.slice(0, visible).map((event) => <li key={event.id}><span className="event-tick">{timeAtTick(event.tick, match.tickRate) ?? '—'}</span><span><strong>{eventLabel(event, playerId, t)}</strong><EventDetails event={event}/><small>{t('round', 'Round {{round}}', { round: match.rounds.find((round) => round.id === event.roundId)?.ordinal ?? '—' })}{event.kind === 'PLAYER_DEATH_NONLIVE' ? ' · ' + t('non-live', 'Outside live round phase') : ''}</small></span><span className="event-target">{match.players.find((item) => item.id === (event.actorId === playerId ? event.targetId : event.actorId))?.displayName ?? '—'}</span></li>)}</ol>}
      {events.length > visible && <button className="button secondary" onClick={() => setVisible(visible + 30)}>{t('more-events', 'Show more events')}</button>}
    </section>
  </>;
}

