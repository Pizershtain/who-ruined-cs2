import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, StoredParticipationExplanation } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../../entities/match/types.js';
import { finalScore } from '../../entities/match/presentation.js';
import { Awards } from '../participation-rating/index.js';
import { Scoreboard } from './Scoreboard.js';
import { RoundHistory } from './RoundHistory.js';
import { Charts } from './Charts.js';
import { ImportantMoments } from '../important-moments/index.js';
import { Icon } from '../../shared/ui/Icon.js';
import { ReportNav } from './ReportNav.js';
import { Story } from '../../shared/ui/Story.js';

export function MatchReport({ awardsPanel, match, analytics, explanation, base, analyticsLoading = false, momentsLoading = false, momentsError, momentsRetry }: { awardsPanel?: ReactNode; match: MatchData; analytics?: MatchAnalytics; explanation?: StoredParticipationExplanation; base: string; analyticsLoading?: boolean; momentsLoading?: boolean; momentsError?: unknown; momentsRetry?: () => void }) {
  const { t } = useTranslation('match');
  return <>
    <div className="breadcrumb"><Link to="/analyze">{t('home', 'Workspace')}</Link><span>/</span><span>{t('report', 'Match report')}</span></div>
    <Story hero label={t('report', 'Match report')} title={match.map ?? t('unknown-map', 'Unknown map')}>
      <section className="match-hero"><div className="map-art" aria-hidden="true"><div/><i/><b/></div><div className="match-heading"><p className="eyebrow"><span className={`pill ${match.quality === 'VALID' ? 'success' : 'warning'}`}>{match.quality === 'VALID' ? t('validated-data', 'Validated data') : match.quality === 'PARTIAL' ? t('partial', 'Partial data') : t('unsupported', 'Unsupported data')}</span></p><div className="match-meta"><span><Icon name="rounds" size={16}/>{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span><span><Icon name="crosshair" size={16}/>{t('player-count', '{{count}} players', { count: match.players.length, defaultValue_one: '{{count}} player', defaultValue_other: '{{count}} players' })}</span></div></div><div className="match-score"><div>{match.teams.map((team, index) => <span key={team.id} className={`team-text-${index}`}>{finalScore(match, team.id) ?? '—'}{index < match.teams.length - 1 && <i>:</i>}</span>)}</div><small>{match.teams.map((team) => team.label).join(' / ') || t('no-rosters', 'Rosters unavailable')}</small></div></section>
    </Story>
    {match.quality !== 'VALID' && <div className="inline-alert" role="alert"><Icon name="warning"/><p>{t('analytics-partial', 'Some metrics have limited source data')}</p></div>}
    <ReportNav score={{ map: match.map ?? t('unknown-map', 'Unknown map'), parts: match.teams.map((team, index) => ({ value: String(finalScore(match, team.id) ?? '—'), team: index })) }}/>
    <Story alt label={t('awards-label', 'Match results')} title={t('awards-title', 'Who shaped the result')}><Awards match={match} {...(analytics ? { analytics } : {})} base={base}/>{awardsPanel}</Story>
    <Story id="scoreboard" band label={t('rosters', 'The full picture')} title={t('scoreboard', 'Player scoreboard')} lead={t('scoreboard-help', 'Select a player to explore their match')}><Scoreboard match={match} loading={analyticsLoading} {...(analytics ? { analytics } : {})} base={base}/></Story>
    <Story id="rounds" alt label={t('momentum', 'Round by round')} title={t('round-history', 'How the match unfolded')}><RoundHistory match={match}/></Story>
    <Story id="statistics" label={t('statistics', 'Statistics')} title={t('comparison', 'Player comparison')} lead={t('comparison-note', 'Compare the same metric across players. Missing values are excluded.')}><Charts match={match} loading={analyticsLoading} {...(analytics ? { analytics } : {})}/></Story>
    <Story id="moments" alt band label={t('moments-eyebrow', 'The turning points')} title={t('match-moments', 'Highlights and recorded facts')} lead={t('moments-rating-note', 'No episode is presented as a decomposition of the active rating.')}><ImportantMoments match={match} {...(explanation ? { report: explanation } : {})} base={base} loading={momentsLoading} error={momentsError} {...(momentsRetry ? { retry: momentsRetry } : {})}/></Story>
  </>;
}

