import { Disclosure } from '../../shared/ui/Disclosure.js';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics, PlayerMetrics } from '../../entities/match/types.js';
import { finalScore, playerPath } from '../../entities/match/presentation.js';
import { steamProfileUrl } from '../../entities/match/player.js';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import { metricGroups, compareMetricValues, type MetricColumn } from '../../entities/match/metric-groups.js';

export type ScoreboardAwards = { mvpPlayerId: string | null; evpPlayerIds: readonly string[] };

export function Scoreboard({ match, analytics, base, awards, loading = false }: { match: MatchData; analytics?: MatchAnalytics; base: string; awards?: ScoreboardAwards; loading?: boolean }) {
  const { t, i18n } = useTranslation('match');
  const [groupId, setGroupId] = useState('combat');
  const [sort, setSort] = useState({ id: 'rating', direction: 'desc' as 'asc' | 'desc' });
  const groups = metricGroups(t);
  const group = groups.find(item => item.id === groupId) ?? groups[0]!;
  const collator = new Intl.Collator(i18n.resolvedLanguage, { numeric: true, sensitivity: 'base' });
  const changeSort = (id: string) => setSort(current => ({ id, direction: current.id === id && current.direction === 'desc' ? 'asc' : 'desc' }));
  const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: digits }).format(value);
  const ratingStatus = (metrics: PlayerMetrics | undefined) => {
    switch (metrics?.ratingAvailability) {
      case 'PARTICIPATION_ABSENT_GT_2_ROUNDS': return t('rating-absent', 'Player was absent for too many verified rounds');
      case 'PARTICIPATION_EVIDENCE_UNKNOWN': return t('rating-evidence-unknown', 'Participation evidence is unknown');
      case 'PARTIAL_COVERAGE_INSUFFICIENT': return t('rating-partial-insufficient', 'Partial coverage is insufficient');
      case 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE': return t('rating-exposure-insufficient', 'Not enough verified exposure');
      case 'UNKNOWN_APPLICABILITY': return t('rating-applicability-unknown', 'Rating applicability is unknown');
      default: return t('ratings-unavailable', 'Rating not available yet');
    }
  };
  const columns: MetricColumn[] = [
    { id: 'kills', label: 'K', value: p => p?.kills },
    { id: 'deaths', label: 'D', value: p => p?.deaths },
    { id: 'assists', label: 'A', value: p => p?.assists },
    ...group.columns,
    { id: 'rating', label: t('rating', 'Rating'), value: p => p?.rating?.value },
  ];
  const valueFor = (id: string, column: MetricColumn) => {
    const metrics = analytics?.players[id];
    if (!metrics && (column.id === 'kills' || column.id === 'deaths' || column.id === 'assists')) return match.players.find(p => p.id === id)?.scoreboard?.[column.id];
    return column.value(metrics);
  };
  const sortValue = (id: string) => sort.id === 'name' ? match.players.find(p => p.id === id)?.displayName : valueFor(id, columns.find(c => c.id === sort.id) ?? columns[0]!);
  const sortedPlayerIds = (ids: string[]) => [...ids].sort((a, b) => compareMetricValues(sortValue(a), sortValue(b), sort.direction, collator));
  const selectGroup = (id: string) => { setGroupId(id); setSort({ id: 'rating', direction: 'desc' }); };
  const playerIdentity = (id: string, teamIndex: number, ordinal: number) => {
    const player = match.players.find(item => item.id === id);
    const steam = steamProfileUrl(player?.steamId ?? null);
    const award = awards?.mvpPlayerId === id ? 'MVP' : awards?.evpPlayerIds.includes(id) ? 'EVP' : null;
    return <div className="player-cell">
      <span className={`player-avatar team-${teamIndex}`} aria-hidden="true">{String(ordinal + 1).padStart(2, '0')}</span>
      <span className="player-identity">
        <span className="player-name-row">
          {player ? <Link to={playerPath(base, id)}><bdi>{player.displayName || t('unnamed-player', 'Unnamed player')}</bdi></Link> : <span>{t('unknown-player', 'Unknown player')}</span>}
          {award && <b className={`report-award ${award.toLowerCase()}`}>{award}</b>}
        </span>
        {steam && <a className="steam-link" href={steam} target="_blank" rel="noreferrer" aria-label={t('steam-profile', 'Steam profile: {{name}}', { name: player?.displayName })}>Steam ↗</a>}
      </span>
    </div>;
  };
  const metricValue = (id: string, column: MetricColumn) => {
    const metrics = analytics?.players[id];
    if (loading && !analytics) return <Skeleton className="skeleton-metric"/>;
    if (column.id === 'rating' && !metrics?.rating) return <span title={ratingStatus(metrics)} aria-label={ratingStatus(metrics)}>—</span>;
    return <>{number(valueFor(id, column), column.id === 'rating' ? 3 : 1)}{column.id === 'rating' && metrics?.rating && <small title={t('rating-rank-title', 'Overall rank {{rank}}', { rank: metrics.rating.rank })}>#{number(metrics.rating.rank, 0)}</small>}</>;
  };
  return <section className="scoreboards"><div className="section-heading"><div><p className="eyebrow">{t('rosters', 'The full picture')}</p><h2>{t('scoreboard', 'Player scoreboard')}</h2></div><span className="muted">{t('scoreboard-help', 'Select a player to explore their match')}</span></div>
    <div className="metric-tabs" role="group" aria-label={t('metrics-group', 'Metric group')}>{groups.map(item => <button className="button secondary" type="button" key={item.id} aria-pressed={groupId === item.id} onClick={() => selectGroup(item.id)}>{item.label}</button>)}</div>
    <label className="scoreboard-group-select">{t('metrics-group', 'Metric group')}<select value={groupId} onChange={event => selectGroup(event.target.value)}>{groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="scoreboard-sort"><label>{t('metrics-sort', 'Sort by')}<select value={sort.id} onChange={event => setSort({ id: event.target.value, direction: event.target.value === 'name' ? 'asc' : 'desc' })}><option value="name">{t('player', 'Player')}</option>{columns.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}</select></label><button type="button" className="button secondary" onClick={() => setSort(current => ({ ...current, direction: current.direction === 'asc' ? 'desc' : 'asc' }))}>{sort.direction === 'asc' ? t('metrics-ascending', 'Ascending') : t('metrics-descending', 'Descending')} <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span></button></div>
    {!match.teams.length && <div className="panel empty-state">{t('no-teams', 'No confirmed rosters are available.')}</div>}
    {match.teams.map((team, teamIndex) => <article className="panel team-board" key={team.id}>
      <header><div className={`team-marker team-${teamIndex}`}/><h3>{team.label}</h3><span className="side-label">{match.rounds.at(-1)?.sideByTeamId[team.id] ?? '—'}</span><span className="team-score">{number(finalScore(match, team.id), 0)}</span></header>
      <div className="table-scroll" onScroll={event => event.currentTarget.classList.toggle('is-scrolled', Math.abs(event.currentTarget.scrollLeft) > 1)} role="region" tabIndex={0} aria-label={t('team-scoreboard', '{{team}} scoreboard', { team: team.label })}><table><thead><tr><th scope="col" aria-sort={sort.id === 'name' ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort('name')}>{t('player', 'Player')}</button></th>{columns.map(column => <th scope="col" key={column.id} aria-sort={sort.id === column.id ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => changeSort(column.id)}>{column.label}<span aria-hidden="true">{sort.id === column.id ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕'}</span></button></th>)}</tr></thead>
        <tbody>{sortedPlayerIds(team.playerIds).map(id => <tr key={id}><th scope="row">{playerIdentity(id, teamIndex, team.playerIds.indexOf(id))}</th>{columns.map(column => <td key={column.id} className={column.id === 'rating' ? 'accent-stat' : ''}>{metricValue(id, column)}</td>)}</tr>)}</tbody></table></div>
      <ul className="mobile-team-list">{sortedPlayerIds(team.playerIds).map(id => <li key={id}>
        {playerIdentity(id, teamIndex, team.playerIds.indexOf(id))}
        <dl className="mobile-player-summary"><div><dt>K / D / A</dt><dd>{loading && !analytics ? <Skeleton className="skeleton-metric"/> : <bdi dir="ltr">{columns.slice(0, 3).map(column => number(valueFor(id, column), 0)).join('/')}</bdi>}</dd></div><div><dt>{group.columns[0]!.label}</dt><dd>{metricValue(id, group.columns[0]!)}</dd></div><div><dt>{t('rating', 'Rating')}</dt><dd className="accent-stat">{metricValue(id, columns.at(-1)!)}</dd></div></dl>
        <Disclosure key={group.id} className="mobile-player-metrics" variant="quiet" level={3} title={group.label}><dl className="detail-stats">{group.columns.map(column => <div key={column.id}><dt>{column.label}</dt><dd>{metricValue(id, column)}</dd></div>)}</dl></Disclosure>
      </li>)}</ul>
    </article>)}
    <Disclosure className="metric-guide" variant="quiet" level={3} title={t('metric-guide', 'What do these metrics mean?')}><p>{t('metric-definitions-rating', 'ADR is average damage per verified round. KAST is the percentage of rounds with a kill, assist, survival or trade. The dimensionless rating is experimental, uncalibrated and not a claim of intentional harm.')}</p>{group.note && <p>{group.note}</p>}</Disclosure>
  </section>;
}

