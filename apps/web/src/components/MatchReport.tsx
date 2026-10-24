import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { ReactNode } from 'react';
import type { MatchAnalytics } from '../analytics/types.js';
import { finalScore } from '../analytics/presentation.js';
import { Awards, awardWinner } from './Awards.js';
import { playerPath, type PlayerFocus } from '../analytics/presentation.js';
import { useEffect, useState } from 'react';
import { Scoreboard } from './Scoreboard.js';
import { RoundHistory } from './RoundHistory.js';
import { Charts } from './Charts.js';
import { Moments } from './Moments.js';
import { Icon } from './Icon.js';
import { ReportNav } from './ReportNav.js';
import { Disclosure } from './Disclosure.js';
import { Story } from './Story.js';
import { Decode } from './Decode.js';

/** The match report as a sequence of stories: one thought and one stage per screen. */
export function MatchReport({ match, analytics, base, analyticsLoading = false, notices }: { match: MatchData; analytics?: MatchAnalytics; base: string; analyticsLoading?: boolean; notices?: ReactNode }) {
  const { t, i18n } = useTranslation('match');
  const count = new Intl.NumberFormat(i18n.resolvedLanguage);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus: PlayerFocus = { id: focusId, toggle: (playerId) => setFocusId((current) => current === playerId ? null : playerId) };
  useEffect(() => {
    if (!focusId) return;
    // Skips Esc that closed a sheet or round details first.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) setFocusId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId]);
  const focused = match.players.find((player) => player.id === focusId);
  const mvp = awardWinner(match, analytics?.mvp, 'mvp');
  const ruined = awardWinner(match, analytics?.whoRuined, 'whoRuined');
  const figure = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const quality = <span className={`pill ${match.quality === 'VALID' ? 'success' : 'warning'}`}>{match.quality === 'VALID' ? t('validated-data', 'Validated data') : match.quality === 'PARTIAL' ? t('partial', 'Partial data') : t('unsupported', 'Unsupported data')}</span>;
  return <>
    <div className="breadcrumb"><Link to="/analyze">{t('home', 'Workspace')}</Link><span>/</span><span>{t('report', 'Match report')}</span></div>
    <Story id="overview" hero label={t('report', 'Match report')} title={match.map ?? t('unknown-map', 'Unknown map')}
      aside={<div className="story-aside"><span><Icon name="rounds" size={16}/>{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span><span><Icon name="crosshair" size={16}/>{t('player-count', '{{count}} players', { count: match.players.length, defaultValue_one: '{{count}} player', defaultValue_other: '{{count}} players' })}</span>{quality}</div>}
      lead={match.quality !== 'VALID' ? t('partial-warning', 'Some match data could not be confirmed. Ratings are unavailable; review the quality notes below.') : undefined}>
      <div className="score-stage"><div className="score key-figure">{match.teams.map((team, index) => <span key={team.id} className={`team-text-${index}`}><Decode text={String(finalScore(match, team.id) ?? '—')}/>{index < match.teams.length - 1 && <i>:</i>}</span>)}</div><div className="teams">{match.teams.length ? match.teams.map((team, index) => <span key={team.id}><i className={`team-marker team-${index}`}/>{team.label}</span>) : <span>{t('no-rosters', 'Rosters unavailable')}</span>}</div>{(mvp || ruined) && <div className="verdicts">{mvp && <Link className="verdict mvp" to={playerPath(base, mvp.player.id)}><span>{t('mvp', 'Match MVP')}</span><strong><Decode text={mvp.player.displayName}/></strong><b><Decode text={figure(mvp.value)}/></b></Link>}{ruined && <Link className="verdict whoRuined" to={playerPath(base, ruined.player.id)}><span>{t('who-ruined', 'Who Ruined')}</span><strong><Decode text={ruined.player.displayName}/></strong><b><Decode text={figure(ruined.value)}/></b></Link>}</div>}</div>
    </Story>
    <ReportNav focus={focused ? { name: focused.displayName, clear: () => setFocusId(null) } : undefined} score={{ map: match.map ?? t('unknown-map', 'Unknown map'), parts: match.teams.map((team, index) => ({ value: String(finalScore(match, team.id) ?? '—'), team: index })) }}/>
    {notices}
    <Story alt label={t('awards-label', 'Match results')} title={t('awards-title', 'Who shaped the result')} lead={t('evidence-disclaimer', 'Match facts are evidence, not proof of tactical blame or intent.', { ns: 'translation' })}>
      <Awards match={match} {...(analytics ? { analytics } : {})} base={base}/>
    </Story>
    <Story id="scoreboard" band label={t('rosters', 'The full picture')} title={t('scoreboard', 'Player scoreboard')} lead={t('scoreboard-source', 'K/D/A comes from the parsed scoreboard. A dash means the metric is unavailable. Side labels refer to the final recorded round.')}
      aside={<Disclosure variant="quiet" className="metric-guide" level={3} title={t('metric-guide', 'What do these metrics mean?')}><p>{t('metric-definitions', 'ADR: average damage per round. KAST: rounds with a kill, assist, survival or trade. Opening K/D: the first elimination in a round. TK: team kills. Performance, Impact and Mistakes require contextual calculations from the analysis service.')}</p></Disclosure>}
      expand={<Scoreboard full match={match} focus={focus} loading={analyticsLoading} {...(analytics ? { analytics } : {})} base={base}/>}>
      <Scoreboard match={match} focus={focus} loading={analyticsLoading} {...(analytics ? { analytics } : {})} base={base}/>
    </Story>
    <Story id="rounds" alt label={t('momentum', 'Round by round')} title={t('round-history', 'How the match unfolded')} lead={t('round-hint', 'Select a round to inspect its score and demo ticks.')} expand={<RoundHistory full match={match} focus={focus} {...(analytics ? { analytics } : {})}/>}>
      <RoundHistory match={match} focus={focus} {...(analytics ? { analytics } : {})}/>
    </Story>
    <Story id="statistics" label={t('statistics', 'Statistics')} title={t('comparison', 'Player comparison')} lead={t('comparison-note', 'Compare the same metric across players. Missing values are excluded.')} expand={<Charts full match={match} focus={focus} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>}>
      <Charts match={match} focus={focus} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/>
    </Story>
    <Story id="moments" alt band label={t('moments-eyebrow', 'The turning points', { ns: 'translation' })} title={t('match-moments', 'Highlights & mistakes', { ns: 'translation' })} lead={t('moments-lead', 'Positive contributions and mistakes the analysis could confirm, each with the confidence it assigned.', { ns: 'translation' })} expand={<Moments full match={match} focus={focus} {...(analytics ? { analytics } : {})} base={base}/>}>
      <Moments match={match} focus={focus} {...(analytics ? { analytics } : {})} base={base}/>
    </Story>
    {match.qualityIssues.length > 0 && <Disclosure variant="quiet" className="quality-notes" icon="info" title={t('quality-notes', 'Data quality notes')} caption={t('diagnostics-note', 'Original diagnostic messages from the analysis service.')} summary={<span className="pill warning">{count.format(match.qualityIssues.length)}</span>}><ul>{match.qualityIssues.map((issue, index) => <li key={index}><code>{issue.code}</code><span>{issue.message}</span>{issue.roundOrdinal && <small>{t('round-label', 'Round {{round}}', { round: issue.roundOrdinal })}</small>}</li>)}</ul></Disclosure>}
  </>;
}
