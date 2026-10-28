import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, MatchEvent, PlayerScoringReport } from '@who-ruined/contracts';
import type { TFunction } from 'i18next';
import type { MatchAnalytics } from '../analytics/types.js';
import { playerEvents, teamOutcome, timeAtTick } from '../analytics/presentation.js';
import { steamProfileUrl } from '../player.js';
import { Moments } from './Moments.js';
import { Charts } from './Charts.js';
import { Icon } from './Icon.js';
import { ErrorState, Unavailable } from './States.js';
import { Skeleton } from './Skeleton.js';
import { Story } from './Story.js';
import { Decode } from './Decode.js';
import type { ReactNode } from 'react';

const INITIAL_EVENTS = 12;

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

/** One player's match as a sequence of stories: identity and figures first, evidence after. */
export function PlayerReport({ match, playerId, base, analytics, scoring, analyticsLoading = false, notices }: { match: MatchData; playerId: string; base: string; analytics?: MatchAnalytics; scoring?: PlayerScoringReport; analyticsLoading?: boolean; notices?: ReactNode }) {
  const { t, i18n } = useTranslation('player');
  const { t: matchT } = useTranslation('match');
  const [roundId, setRoundId] = useState('');
  const [visible, setVisible] = useState(INITIAL_EVENTS);
  const player = match.players.find((item) => item.id === playerId);
  if (!player) return <ErrorState message={t('not-found', 'This player is not in this match.')}/>;
  const team = match.teams.find((item) => item.id === player.teamId);
  const steam = steamProfileUrl(player.steamId);
  const outcome = teamOutcome(match, player.teamId);
  const metrics = analytics?.players[playerId];
  const insights = analytics?.insights?.[playerId];
  const events = playerEvents(match, playerId).filter((event) => !roundId || event.roundId === roundId);
  const number = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const count = new Intl.NumberFormat(i18n.resolvedLanguage);
  const pending = analyticsLoading && !analytics;
  const scored = scoring?.player;
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
  const context = outcome === 'win' ? t('win-context', 'Explore this player’s contribution to the win, alongside the actions that could be improved.') : outcome === 'loss' ? t('loss-context', 'Explore this player’s part in the result, including their positive contributions. Defeat alone does not establish blame.') : outcome === 'draw' ? undefined : t('unknown-context', 'The match outcome is unconfirmed. Available actions are shown without a result-based rating.');
  const eventLog = (limit: number) => <div className="events">
    <div className="stage-tools"><span className="pill">{count.format(events.length)}</span><label className="select-label"><span className="sr-only">{t('filter-round', 'Filter by round')}</span><select value={roundId} onChange={(event) => { setRoundId(event.target.value); setVisible(INITIAL_EVENTS); }}><option value="">{t('all-rounds', 'All rounds')}</option>{match.rounds.map((round) => <option key={round.id} value={round.id}>{t('round', 'Round {{round}}', { round: round.ordinal })}</option>)}</select></label></div>
    {!events.length ? <div className="empty-state"><p>{t('no-events', 'No recorded events match this selection.')}</p>{roundId && <button className="button secondary" onClick={() => setRoundId('')}>{t('all-rounds', 'All rounds')}</button>}</div> :
      <ol className="event-list content-reveal" key={roundId}>{events.slice(0, limit).map((event) => <li key={event.id}><span className="event-tick">{timeAtTick(event.tick, match.tickRate) ?? '—'}<small>{t('tick', 'Tick {{tick}}', { tick: event.tick })}</small></span><span><strong>{eventLabel(event, playerId, t)}</strong><small>{t('round', 'Round {{round}}', { round: match.rounds.find((round) => round.id === event.roundId)?.ordinal ?? '—' })}{event.kind === 'PLAYER_DEATH_NONLIVE' ? ' · ' + t('non-live', 'Outside live round phase') : ''}</small></span><span className="event-target">{match.players.find((item) => item.id === (event.actorId === playerId ? event.targetId : event.actorId))?.displayName ?? '—'}</span></li>)}</ol>}
    {events.length > limit && <button className="button primary" onClick={() => setVisible(visible + 30)}>{t('more-events', 'Show more events')}</button>}
  </div>;
  const utilityList = <dl className="detail-stats">{utilityStats.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : number(item.value)}</dd></div>)}<div><dt>{t('trades', 'Successful trades')}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : number(metrics?.trades)}</dd></div><div><dt>{t('opening', 'Opening kills / deaths')}</dt><dd>{pending ? <Skeleton className="skeleton-metric"/> : <>{number(metrics?.openingKills)} / {number(metrics?.openingDeaths)}</>}</dd></div></dl>;
  return <>
    <Link className="text-link back-link" to={base}><Icon name="back" size={17}/>{t('back', 'Back to match report')}</Link>
    <Story hero label={t('eyebrow', 'Player · this match only')} title={player.displayName || t('unnamed', 'Unnamed player')} lead={context}
      aside={<div className="story-aside"><span>{team?.label ?? '—'}</span><span>{match.map ?? '—'}</span>{steam && <a href={steam} target="_blank" rel="noreferrer">{t('steam', 'Steam profile')} ↗</a>}<span className={`pill ${outcome === 'win' ? 'success' : ''}`}>{outcome === 'win' ? t('won', 'Victory') : outcome === 'loss' ? t('lost', 'Defeat') : outcome === 'draw' ? t('draw', 'Draw') : t('unknown-result', 'Result unconfirmed')}</span></div>}
      expand={<div className="sheet-grid"><div className="stat-stage">{stats.map((item, index) => <div className={index === 0 ? 'primary-stat' : 'stat'} key={item.title}><span>{item.title}</span><strong>{item.pending ? <Skeleton className="skeleton-metric"/> : item.value}</strong></div>)}</div>{utilityList}</div>}>
      <div className="stat-stage">{stats.map((item, index) => <div className={index === 0 ? 'primary-stat' : 'stat'} key={item.title}><span>{item.title}</span><strong className="key-figure">{item.pending ? <Skeleton className="skeleton-metric"/> : index === 0 ? <Decode text={item.value}/> : item.value}</strong></div>)}</div>
    </Story>
    {notices}
    {scoring && scored && <Story alt label={t('experimental', 'Experimental')} title={t('relative-index', 'Relative index')} lead={t('relative-index-note', 'Relative index is not a probability or proof of intent.')}>
      <div className="scoring-stage">
        {scored.ruinRaw !== null && <div className="primary-stat"><span>{t('relative-index', 'Relative index')}</span><strong className="key-figure">{number(scored.relativeIndex)}</strong></div>}
        <div className="scoring-components">
          <article><h3>{t('performance', 'Performance')}</h3><strong className="key-figure">{number(scored.performanceRate)}</strong><dl className="detail-stats"><div><dt>K / A</dt><dd>{number(scored.components.performance.kills)} / {number(scored.components.performance.assists)}</dd></div><div><dt>ADR / KAST</dt><dd>{number(scored.components.performance.adr)} / {number(scored.components.performance.kastPercent)}</dd></div></dl></article>
          <article><h3>{t('context-contribution', 'Context Contribution')}</h3><strong className="key-figure">{number(scored.contextContributionRate)}</strong><dl className="detail-stats"><div><dt>{t('opening', 'Opening kills / deaths')}</dt><dd>{number(scored.components.contextContribution.openingKills)}</dd></div><div><dt>{t('trades', 'Successful trades')}</dt><dd>{number(scored.components.contextContribution.tradeKills)}</dd></div></dl></article>
          <article><h3>{t('confirmed-harm', 'Confirmed Harm')}</h3><strong className="key-figure">{number(scored.confirmedHarmRate)}</strong><dl className="detail-stats"><div><dt>TK</dt><dd>{number(scored.components.confirmedHarm.teamKills)}</dd></div><div><dt>HP</dt><dd>{number(scored.components.confirmedHarm.teamDamage)}</dd></div></dl></article>
        </div>
        {scored.components.confirmedHarm.points === 0 && <p className="stage-footnote">{t('no-confirmed-harm', 'No confirmed harmful action; selection is based on relative contribution shortfall.')}</p>}
      </div>
    </Story>}
    <Story band label={t('moments-eyebrow', 'The turning points', { ns: 'translation' })} title={t('player-actions', 'Key actions', { ns: 'translation' })} lead={t('moments-lead', 'Positive contributions and mistakes the analysis could confirm, each with the confidence it assigned.', { ns: 'translation' })} expand={<Moments full match={match} base={base} playerId={playerId} {...(analytics ? { analytics } : {})}/>}>
      <Moments match={match} base={base} playerId={playerId} {...(analytics ? { analytics } : {})}/>
    </Story>
    <Story alt label={t('utility', 'Utility & trades')} title={t('strengths', 'Strengths & opportunities')} lead={t('strengths-lead', 'What the recorded actions say about this player, with the utility and trade numbers behind them.')}>
      <div className="insight-stage">
        {insights ? <ul className="insight-list">{insights.strengths.map((item) => <li className="positive" key={item}><Icon name="check" size={17}/>{item === 'opening-duels' ? t('insight-duels', 'Effective in opening duels.') : t('insight-utility', 'Useful support through utility.')}</li>)}{insights.opportunities.map((item) => <li key={item}><Icon name="warning" size={17}/>{t('insight-trades', 'Keep a teammate in trading distance on entry attempts.')}</li>)}{!insights.opportunities.length && <li>{t('insight-no-weakness', 'No contextual weakness identified in the supplied analysis.')}</li>}</ul> : <Unavailable note={t('strengths-unavailable', 'Personal strengths and weaknesses require contextual analysis. No conclusions are inferred from K/D/A.')}/>}
        {utilityList}
      </div>
    </Story>
    <Story label={matchT('statistics', 'Statistics')} title={matchT('comparison', 'Player comparison')} lead={matchT('comparison-note', 'Compare the same metric across players. Missing values are excluded.')} expand={<Charts full match={{ ...match, players: [player] }} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>}>
      <Charts match={{ ...match, players: [player] }} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>
    </Story>
    <Story alt band label={t('facts', 'Recorded facts')} title={t('events', 'Demo event log')} lead={t('events-note', 'These are parsed events, not tactical judgements. Timecodes are absolute demo time, not video clips.')} expand={eventLog(Infinity)}>
      {eventLog(visible)}
    </Story>
  </>;
}
