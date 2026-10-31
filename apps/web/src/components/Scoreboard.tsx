import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics, PlayerMetrics } from '../analytics/types.js';
import { finalScore, playerPath } from '../analytics/presentation.js';
import { steamProfileUrl } from '../player.js';
import { Skeleton } from './Skeleton.js';

export function Scoreboard({ match, analytics, base, loading = false }: { match: MatchData; analytics?: MatchAnalytics; base: string; loading?: boolean }) {
  const { t, i18n } = useTranslation('match');
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
  const columns: Array<{ key: keyof PlayerMetrics; label: string }> = [
    { key: 'adr', label: 'ADR' }, { key: 'kast', label: 'KAST %' },
    { key: 'openingKills', label: t('opening-kills', 'Opening K') }, { key: 'openingDeaths', label: t('opening-deaths', 'Opening D') },
    { key: 'trades', label: t('trades', 'Trades') },
    { key: 'heDamage', label: t('he-damage', 'HE damage') }, { key: 'fireDamage', label: t('fire-damage', 'Fire damage') },
  ];
  return <section className="scoreboards"><div className="section-heading"><div><p className="eyebrow">{t('rosters', 'The full picture')}</p><h2>{t('scoreboard', 'Player scoreboard')}</h2></div><span className="muted">{t('scoreboard-help', 'Select a player to explore their match')}</span></div>
    <p className="data-note">{t('scoreboard-source-rating', 'Facts and the experimental rating come from the active backend report. A dash means the value is unavailable; it never means zero.')}</p>
    {!match.teams.length && <div className="panel empty-state">{t('no-teams', 'No confirmed rosters are available.')}</div>}
    {match.teams.map((team, teamIndex) => <article className="panel team-board" key={team.id}>
      <header><div className={`team-marker team-${teamIndex}`}/><h3>{team.label}</h3><span className="side-label">{match.rounds.at(-1)?.sideByTeamId[team.id] ?? '—'}</span><span className="team-score">{number(finalScore(match, team.id), 0)}</span></header>
      <div className="table-scroll" role="region" tabIndex={0} aria-label={t('team-scoreboard', '{{team}} scoreboard', { team: team.label })}><table><thead><tr><th scope="col">{t('player', 'Player')}</th><th scope="col">K</th><th scope="col">D</th><th scope="col">A</th>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}<th scope="col">{t('rating', 'Rating')}</th></tr></thead>
        <tbody>{team.playerIds.map((id, index) => {
          const player = match.players.find((item) => item.id === id);
          const metrics = analytics?.players[id];
          const steam = steamProfileUrl(player?.steamId ?? null);
          return <tr key={id}><th scope="row"><div className="player-cell"><span className={`player-avatar team-${teamIndex}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="player-identity">{player ? <Link to={playerPath(base, id)}>{player.displayName || t('unnamed-player', 'Unnamed player')}</Link> : <span>{t('unknown-player', 'Unknown player')}</span>}{steam && <a className="steam-link" href={steam} target="_blank" rel="noreferrer" aria-label={t('steam-profile', 'Steam profile: {{name}}', { name: player?.displayName })}>Steam ↗</a>}</span></div></th>
            <td className="stat-strong">{number(metrics?.kills ?? player?.scoreboard?.kills, 0)}</td><td>{number(metrics?.deaths ?? player?.scoreboard?.deaths, 0)}</td><td>{number(metrics?.assists ?? player?.scoreboard?.assists, 0)}</td>
            {columns.map((column) => <td key={column.key}>{loading && !analytics ? <Skeleton className="skeleton-metric"/> : number(metrics?.[column.key] as number | null | undefined)}</td>)}
            <td className="accent-stat">{loading && !analytics ? <Skeleton className="skeleton-metric"/> : metrics?.rating ? <span title={t('rating-rank-title', 'Overall rank {{rank}}', { rank: metrics.rating.rank })}>{number(metrics.rating.value, 3)} <small>#{number(metrics.rating.rank, 0)}</small></span> : <span title={metrics?.ratingReason ?? ratingStatus(metrics)} aria-label={ratingStatus(metrics)}>—</span>}</td></tr>;
        })}</tbody></table></div>
    </article>)}
    <details className="metric-guide"><summary>{t('metric-guide', 'What do these metrics mean?')}</summary><p>{t('metric-definitions-rating', 'ADR is average damage per verified round. KAST is the percentage of rounds with a kill, assist, survival or trade. The dimensionless rating is experimental, uncalibrated and not a claim of intentional harm.')}</p></details>
  </section>;
}
