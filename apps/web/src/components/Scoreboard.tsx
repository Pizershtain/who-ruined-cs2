import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics, PlayerMetrics } from '../analytics/types.js';
import { finalScore, focusClass, playerPath, type PlayerFocus } from '../analytics/presentation.js';
import { steamProfileUrl } from '../player.js';
import { Skeleton } from './Skeleton.js';
import { usePresence } from './Disclosure.js';

/** Marks a scroll container that overflows (pinned column gets an opaque fill) and whether more columns hide to the right. */
function watchOverflow(node: HTMLDivElement | null) {
  if (!node) return;
  const update = () => {
    const overflowing = node.scrollWidth > node.clientWidth + 1;
    node.classList.toggle('is-overflowing', overflowing);
    node.classList.toggle('is-scrolled', Math.abs(node.scrollLeft) > 1);
    node.parentElement?.classList.toggle('has-more', overflowing && Math.abs(node.scrollLeft) + node.clientWidth < node.scrollWidth - 1);
  };
  const observer = new ResizeObserver(update);
  observer.observe(node);
  if (node.firstElementChild) observer.observe(node.firstElementChild);
  node.addEventListener('scroll', update, { passive: true });
  update();
  return () => { observer.disconnect(); node.removeEventListener('scroll', update); };
}

/** The scoreboard visual for a stage: both rosters, key columns first, the rest on request. */
export function Scoreboard({ match, analytics, base, loading = false, full = false, focus }: { match: MatchData; analytics?: MatchAnalytics; base: string; loading?: boolean; full?: boolean; focus?: PlayerFocus | undefined }) {
  const { t, i18n } = useTranslation('match');
  const [expanded, setExpanded] = useState(false);
  const extra = usePresence(full || expanded);
  const number = (value: number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const keyColumns: Array<{ key: keyof PlayerMetrics; label: string }> = [{ key: 'adr', label: 'ADR' }, { key: 'kast', label: 'KAST %' }];
  const extraColumns: Array<{ key: keyof PlayerMetrics; label: string }> = [
    { key: 'openingKills', label: t('opening-kills', 'Opening K') }, { key: 'openingDeaths', label: t('opening-deaths', 'Opening D') },
    { key: 'trades', label: t('trades', 'Trades') },
    ...(analytics?.source === 'm2' ? [{ key: 'heDamage' as const, label: t('he-damage', 'HE damage') }, { key: 'fireDamage' as const, label: t('fire-damage', 'Fire damage') }] : [{ key: 'utilityDamage' as const, label: t('utility-damage', 'Utility DMG') }]),
    { key: 'performance', label: t('performance', 'Performance') }, { key: 'impact', label: t('context-contribution', 'Context Contribution') }, { key: 'mistakes', label: t('confirmed-harm', 'Confirmed Harm') },
  ];
  return <div className={`scoreboards ${extra.leaving ? 'is-collapsing' : ''}`}>
    {!full && <div className="stage-tools"><span className="muted">{t('scoreboard-help', 'Select a player to explore their match')}</span><button type="button" className="toggle-chip" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}><span className="switch" aria-hidden="true"/>{t('all-metrics', 'All metrics')}</button></div>}
    {!match.teams.length && <div className="empty-state">{t('no-teams', 'No confirmed rosters are available.')}</div>}
    {match.teams.map((team, teamIndex) => <article className="team-board" key={team.id}>
      <header><div className={`team-marker team-${teamIndex}`}/><h3>{team.label}</h3><span className="side-label">{match.rounds.at(-1)?.sideByTeamId[team.id] ?? '—'}</span><span className="team-score">{number(finalScore(match, team.id))}</span></header>
      <div className="table-frame"><div className="table-scroll" ref={watchOverflow} role="region" tabIndex={0} aria-label={t('team-scoreboard', '{{team}} scoreboard', { team: team.label })}><table><thead><tr><th scope="col">{t('player', 'Player')}</th><th scope="col">K</th><th scope="col">D</th><th scope="col">A</th>{keyColumns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}{extra.mounted && <><th scope="col" className="metric-extra">TK</th>{extraColumns.map((column) => <th scope="col" key={column.key} className="metric-extra">{column.label}</th>)}</>}</tr></thead>
        <tbody>{team.playerIds.map((id, index) => {
          const player = match.players.find((item) => item.id === id);
          const metrics = analytics?.players[id];
          const steam = steamProfileUrl(player?.steamId ?? null);
          const cell = (key: keyof PlayerMetrics) => loading && !analytics && !['performance', 'impact', 'mistakes'].includes(key) ? <Skeleton className="skeleton-metric"/> : number(metrics?.[key]);
          return <tr key={id} className={`focusable stagger-item ${focusClass(focus, id)}`} style={{ '--i': teamIndex * team.playerIds.length + index } as CSSProperties} onClick={(event) => { if (!(event.target instanceof Element && event.target.closest('a'))) focus?.toggle(id); }}><th scope="row"><div className="player-cell"><span className={`player-avatar team-${teamIndex}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="player-identity">{player ? <Link to={playerPath(base, id)}>{player.displayName || t('unnamed-player', 'Unnamed player')}</Link> : <span>{t('unknown-player', 'Unknown player')}</span>}{steam && <a className="steam-link" href={steam} target="_blank" rel="noreferrer" aria-label={t('steam-profile', 'Steam profile: {{name}}', { name: player?.displayName })}>Steam ↗</a>}</span></div></th>
            <td className="stat-strong">{number(player?.scoreboard?.kills)}</td><td>{number(player?.scoreboard?.deaths)}</td><td>{number(player?.scoreboard?.assists)}</td>
            {keyColumns.map((column) => <td key={column.key}>{cell(column.key)}</td>)}
            {extra.mounted && <><td className="metric-extra">{number(player?.scoreboard?.teamKills)}</td>{extraColumns.map((column) => <td key={column.key} className={`metric-extra ${column.key === 'impact' ? 'accent-stat' : ''}`}>{cell(column.key)}</td>)}</>}</tr>;
        })}</tbody></table></div></div>
    </article>)}
  </div>;
}
