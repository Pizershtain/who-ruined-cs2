import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics, PlayerMetrics } from '../analytics/types.js';
import { finalScore, playerPath } from '../analytics/presentation.js';
import { steamProfileUrl } from '../player.js';
import { Skeleton } from './Skeleton.js';

export function Scoreboard({ match, analytics, base, loading = false }: { match: MatchData; analytics?: MatchAnalytics; base: string; loading?: boolean }) {
  const { t, i18n } = useTranslation('match');
  const number = (value: number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const columns: Array<{ key: keyof PlayerMetrics; label: string }> = [
    { key: 'adr', label: 'ADR' }, { key: 'kast', label: 'KAST %' },
    { key: 'openingKills', label: t('opening-kills', 'Opening K') }, { key: 'openingDeaths', label: t('opening-deaths', 'Opening D') },
    { key: 'trades', label: t('trades', 'Trades') },
    ...(analytics?.source === 'm2' ? [{ key: 'heDamage' as const, label: t('he-damage', 'HE damage') }, { key: 'fireDamage' as const, label: t('fire-damage', 'Fire damage') }] : [{ key: 'utilityDamage' as const, label: t('utility-damage', 'Utility DMG') }]),
    { key: 'performance', label: t('performance', 'Performance') }, { key: 'impact', label: t('context-contribution', 'Context Contribution') }, { key: 'mistakes', label: t('confirmed-harm', 'Confirmed Harm') },
  ];
  return <section className="scoreboards"><div className="section-heading"><div><p className="eyebrow">{t('rosters', 'The full picture')}</p><h2>{t('scoreboard', 'Player scoreboard')}</h2></div><span className="muted">{t('scoreboard-help', 'Select a player to explore their match')}</span></div>
    <p className="data-note">{t('scoreboard-source', 'K/D/A comes from the parsed scoreboard. A dash means the metric is unavailable. Side labels refer to the final recorded round.')}</p>
    {!match.teams.length && <div className="panel empty-state">{t('no-teams', 'No confirmed rosters are available.')}</div>}
    {match.teams.map((team, teamIndex) => <article className="panel team-board" key={team.id}>
      <header><div className={`team-marker team-${teamIndex}`}/><h3>{team.label}</h3><span className="side-label">{match.rounds.at(-1)?.sideByTeamId[team.id] ?? '—'}</span><span className="team-score">{number(finalScore(match, team.id))}</span></header>
      <div className="table-scroll" role="region" tabIndex={0} aria-label={t('team-scoreboard', '{{team}} scoreboard', { team: team.label })}><table><thead><tr><th scope="col">{t('player', 'Player')}</th><th scope="col">K</th><th scope="col">D</th><th scope="col">A</th><th scope="col">TK</th>{columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{team.playerIds.map((id, index) => {
          const player = match.players.find((item) => item.id === id);
          const metrics = analytics?.players[id];
          const steam = steamProfileUrl(player?.steamId ?? null);
          return <tr key={id}><th scope="row"><div className="player-cell"><span className={`player-avatar team-${teamIndex}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="player-identity">{player ? <Link to={playerPath(base, id)}>{player.displayName || t('unnamed-player', 'Unnamed player')}</Link> : <span>{t('unknown-player', 'Unknown player')}</span>}{steam && <a className="steam-link" href={steam} target="_blank" rel="noreferrer" aria-label={t('steam-profile', 'Steam profile: {{name}}', { name: player?.displayName })}>Steam ↗</a>}</span></div></th>
            <td className="stat-strong">{number(player?.scoreboard?.kills)}</td><td>{number(player?.scoreboard?.deaths)}</td><td>{number(player?.scoreboard?.assists)}</td><td>{number(player?.scoreboard?.teamKills)}</td>
            {columns.map((column) => <td key={column.key} className={column.key === 'impact' ? 'accent-stat' : ''}>{loading && !analytics && !['performance', 'impact', 'mistakes'].includes(column.key) ? <Skeleton className="skeleton-metric"/> : number(metrics?.[column.key])}</td>)}</tr>;
        })}</tbody></table></div>
    </article>)}
    <details className="metric-guide"><summary>{t('metric-guide', 'What do these metrics mean?')}</summary><p>{t('metric-definitions', 'ADR: average damage per round. KAST: rounds with a kill, assist, survival or trade. Opening K/D: the first elimination in a round. TK: team kills. Performance, Impact and Mistakes require contextual calculations from the analysis service.')}</p></details>
  </section>;
}
