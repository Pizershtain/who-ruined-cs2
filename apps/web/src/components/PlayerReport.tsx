import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, MatchEvent } from '@who-ruined/contracts';
import type { TFunction } from 'i18next';
import type { MatchAnalytics } from '../analytics/types.js';
import { playerEvents, teamOutcome, timeAtTick } from '../analytics/presentation.js';
import { steamProfileUrl } from '../player.js';
import { Moments } from './Moments.js';
import { Charts } from './Charts.js';
import { Icon } from './Icon.js';
import { ErrorState, Unavailable } from './States.js';
import { Skeleton } from './Skeleton.js';

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
export function PlayerReport({ match, playerId, base, analytics, analyticsLoading = false }: { match: MatchData; playerId: string; base: string; analytics?: MatchAnalytics; analyticsLoading?: boolean }) {
  const { t, i18n } = useTranslation('player');
  const [roundId, setRoundId] = useState('');
  const [visible, setVisible] = useState(30);
  const player = match.players.find((item) => item.id === playerId);
  if (!player) return <ErrorState message={t('not-found', 'This player is not in this match.')}/>;
  const team = match.teams.find((item) => item.id === player.teamId);
  const steam = steamProfileUrl(player.steamId);
  const outcome = teamOutcome(match, player.teamId);
  const metrics = analytics?.players[playerId];
  const insights = analytics?.insights?.[playerId];
  const events = playerEvents(match, playerId).filter((event) => !roundId || event.roundId === roundId);
  const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const pending = analyticsLoading && !analytics;
  const stats = [
    { title: 'K / D / A', value: [player.scoreboard?.kills, player.scoreboard?.deaths, player.scoreboard?.assists].map(number).join(' / '), pending: false },
    { title: 'ADR', value: number(metrics?.adr), pending }, { title: 'KAST %', value: number(metrics?.kast), pending },
    ...(analytics?.source === 'm2' ? [
      { title: t('opening', 'Opening kills / deaths'), value: number(metrics?.openingKills) + ' / ' + number(metrics?.openingDeaths), pending: false },
      { title: t('trades', 'Successful trades'), value: number(metrics?.trades), pending: false },
    ] : [{ title: t('performance', 'Performance'), value: number(metrics?.performance), pending: false }, { title: t('impact', 'Impact'), value: number(metrics?.impact), pending: false }]),
  ];
  const utilityStats = analytics?.source === 'm2' ? [
    { label: t('he-damage', 'HE damage'), value: metrics?.heDamage }, { label: t('fire-damage', 'Fire damage'), value: metrics?.fireDamage },
    { label: t('enemies-flashed', 'Enemies flashed'), value: metrics?.enemiesFlashed }, { label: t('blind-seconds', 'Enemy blind time (seconds)'), value: metrics?.enemyBlindSeconds },
  ] : [{ label: t('utility-damage', 'Utility damage'), value: metrics?.utilityDamage }];
  return <>
    <Link className="text-link back-link" to={base}><Icon name="back" size={17}/>{t('back', 'Back to match report')}</Link>
    <section className="player-hero panel"><span className="profile-avatar"><Icon name="crosshair" size={42}/></span><div><p className="eyebrow">{t('eyebrow', 'Player · this match only')}</p><h1>{player.displayName || t('unnamed', 'Unnamed player')}</h1><div className="player-meta"><span>{team?.label ?? '—'}</span><span>{match.map ?? '—'}</span>{steam && <a href={steam} target="_blank" rel="noreferrer">{t('steam', 'Steam profile')} ↗</a>}</div></div><span className={`pill ${outcome === 'win' ? 'success' : ''}`}>{outcome === 'win' ? t('won', 'Victory') : outcome === 'loss' ? t('lost', 'Defeat') : outcome === 'draw' ? t('draw', 'Draw') : t('unknown-result', 'Result unconfirmed')}</span></section>
    {outcome !== 'draw' && <p className="player-context">{outcome === 'win' ? t('win-context', 'Explore this player’s contribution to the win, alongside the actions that could be improved.') : outcome === 'loss' ? t('loss-context', 'Explore this player’s part in the result, including their positive contributions. Defeat alone does not establish blame.') : t('unknown-context', 'The match outcome is unconfirmed. Available actions are shown without a result-based rating.')}</p>}
    <section className="player-stats">{stats.map((item) => <div className="panel stat-card" key={item.title}><span>{item.title}</span><strong>{item.pending ? <Skeleton className="skeleton-metric"/> : item.value}</strong></div>)}</section>
    <Moments match={match} base={base} playerId={playerId} {...(analytics ? { analytics } : {})}/>
    <section className="player-insights"><article className="panel"><h2>{t('strengths', 'Strengths & opportunities')}</h2>{insights ? <ul className="insight-list">{insights.strengths.map((item) => <li className="positive" key={item}><Icon name="check" size={17}/>{item === 'opening-duels' ? t('insight-duels', 'Effective in opening duels.') : t('insight-utility', 'Useful support through utility.')}</li>)}{insights.opportunities.map((item) => <li key={item}><Icon name="warning" size={17}/>{t('insight-trades', 'Keep a teammate in trading distance on entry attempts.')}</li>)}{!insights.opportunities.length && <li>{t('insight-no-weakness', 'No contextual weakness identified in the supplied analysis.')}</li>}</ul> : <Unavailable note={t('strengths-unavailable', 'Personal strengths and weaknesses require contextual analysis. No conclusions are inferred from K/D/A.')}/>}</article><article className="panel"><h2>{t('utility', 'Utility & trades')}</h2><dl className="detail-stats">{utilityStats.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : number(item.value)}</dd></div>)}<div><dt>{t('trades', 'Successful trades')}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : number(metrics?.trades)}</dd></div><div><dt>{t('opening', 'Opening kills / deaths')}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : <>{number(metrics?.openingKills)} / {number(metrics?.openingDeaths)}</>}</dd></div></dl></article></section>
    <Charts match={{ ...match, players: [player] }} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>
    <section className="panel event-panel"><div className="section-heading"><div><p className="eyebrow">{t('facts', 'Recorded facts')}</p><h2>{t('events', 'Demo event log')}</h2></div><label className="select-label"><span className="sr-only">{t('filter-round', 'Filter by round')}</span><select value={roundId} onChange={(event) => { setRoundId(event.target.value); setVisible(30); }}><option value="">{t('all-rounds', 'All rounds')}</option>{match.rounds.map((round) => <option key={round.id} value={round.id}>{t('round', 'Round {{round}}', { round: round.ordinal })}</option>)}</select></label></div>
      <p className="data-note">{t('events-note', 'These are parsed events, not tactical judgements. Timecodes are absolute demo time, not video clips.')}</p>
      {!events.length ? <div className="empty-state"><p>{t('no-events', 'No recorded events match this selection.')}</p>{roundId && <button className="button secondary" onClick={() => setRoundId('')}>{t('all-rounds', 'All rounds')}</button>}</div> :
        <ol className="event-list content-reveal" key={roundId}>{events.slice(0, visible).map((event) => <li key={event.id}><span className="event-tick">{timeAtTick(event.tick, match.tickRate) ?? '—'}<small>{t('tick', 'Tick {{tick}}', { tick: event.tick })}</small></span><span><strong>{eventLabel(event, playerId, t)}</strong><small>{t('round', 'Round {{round}}', { round: match.rounds.find((round) => round.id === event.roundId)?.ordinal ?? '—' })}{event.kind === 'PLAYER_DEATH_NONLIVE' ? ' · ' + t('non-live', 'Outside live round phase') : ''}</small></span><span className="event-target">{match.players.find((item) => item.id === (event.actorId === playerId ? event.targetId : event.actorId))?.displayName ?? '—'}</span></li>)}</ol>}
      {events.length > visible && <button className="button secondary" onClick={() => setVisible(visible + 30)}>{t('more-events', 'Show more events')}</button>}
    </section>
  </>;
}
