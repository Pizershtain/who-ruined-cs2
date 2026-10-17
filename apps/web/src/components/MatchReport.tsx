import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../analytics/types.js';
import { finalScore } from '../analytics/presentation.js';
import { Awards } from './Awards.js';
import { Scoreboard } from './Scoreboard.js';
import { RoundHistory } from './RoundHistory.js';
import { Charts } from './Charts.js';
import { Moments } from './Moments.js';
import { Icon } from './Icon.js';
import { ReportNav } from './ReportNav.js';

export function MatchReport({ match, analytics, base, analyticsLoading = false }: { match: MatchData; analytics?: MatchAnalytics; base: string; analyticsLoading?: boolean }) {
  const { t } = useTranslation('match');
  return <>
    <div className="breadcrumb"><Link to="/">{t('home', 'Workspace')}</Link><span>/</span><span>{t('report', 'Match report')}</span></div>
    <section className="match-hero panel"><div className="map-art" aria-hidden="true"><div/><i/><b/></div><div className="match-heading"><p className="eyebrow">{t('report', 'Match report')} <span className={`pill ${match.quality === 'VALID' ? 'success' : 'warning'}`}>{match.quality === 'VALID' ? t('validated-data', 'Validated data') : match.quality === 'PARTIAL' ? t('partial', 'Partial data') : t('unsupported', 'Unsupported data')}</span></p><h1>{match.map ?? t('unknown-map', 'Unknown map')}</h1><div className="match-meta"><span><Icon name="rounds" size={16}/>{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span><span><Icon name="crosshair" size={16}/>{t('player-count', '{{count}} players', { count: match.players.length, defaultValue_one: '{{count}} player', defaultValue_other: '{{count}} players' })}</span></div></div><div className="match-score"><div>{match.teams.map((team, index) => <span key={team.id} className={`team-text-${index}`}>{finalScore(match, team.id) ?? '—'}{index < match.teams.length - 1 && <i>:</i>}</span>)}</div><small>{match.teams.map((team) => team.label).join(' / ') || t('no-rosters', 'Rosters unavailable')}</small></div></section>
    {match.quality !== 'VALID' && <div className="inline-alert" role="alert"><Icon name="warning"/><p>{t('partial-warning', 'Some match data could not be confirmed. Ratings are unavailable; review the quality notes below.')}</p></div>}
    <Awards match={match} {...(analytics ? { analytics } : {})} base={base}/>
    <ReportNav/>
    <div id="scoreboard"><Scoreboard match={match} loading={analyticsLoading} {...(analytics ? { analytics } : {})} base={base}/></div>
    <div id="rounds"><RoundHistory match={match} {...(analytics ? { analytics } : {})}/></div>
    <div id="statistics"><Charts match={match} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/></div>
    <div id="moments"><Moments match={match} {...(analytics ? { analytics } : {})} base={base}/></div>
    {match.qualityIssues.length > 0 && <section className="panel quality-notes"><h2>{t('quality-notes', 'Data quality notes')}</h2><p className="muted">{t('diagnostics-note', 'Original diagnostic messages from the analysis service.')}</p><ul>{match.qualityIssues.map((issue, index) => <li key={index}><code>{issue.code}</code><span>{issue.message}</span>{issue.roundOrdinal && <small>{t('round-label', 'Round {{round}}', { round: issue.roundOrdinal })}</small>}</li>)}</ul></section>}
  </>;
}
