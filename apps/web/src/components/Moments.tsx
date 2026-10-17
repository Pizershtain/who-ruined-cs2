import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { AnalysisMoment, MatchAnalytics } from '../analytics/types.js';
import { playerPath, timeAtTick } from '../analytics/presentation.js';
import { Icon } from './Icon.js';
import { Unavailable } from './States.js';

export function momentDescription(kind: AnalysisMoment['kind'], t: TFunction): string {
  switch (kind) {
    case 'trade': return t('moment-trade', 'Traded a teammate and restored player parity.');
    case 'flash-assist': return t('moment-flash', 'A flash enabled a teammate’s elimination.');
    case 'untraded-entry': return t('moment-entry', 'An entry attempt left the team at a disadvantage without an immediate trade.');
    default: return kind;
  }
}
export function Moments({ match, analytics, base, playerId }: { match: MatchData; analytics?: MatchAnalytics; base: string; playerId?: string }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<'positive' | 'mistake' | 'all'>('all');
  const [visible, setVisible] = useState(30);
  const entries = analytics?.moments?.filter((moment) => (!playerId || moment.playerId === playerId) && (filter === 'all' || moment.category === filter));
  return <section className="moments-section"><div className="section-heading"><div><p className="eyebrow">{t('moments-eyebrow', 'The turning points')}</p><h2>{playerId ? t('player-actions', 'Key actions') : t('match-moments', 'Highlights & mistakes')}</h2></div><div className="segmented" role="group" aria-label={t('action-filter', 'Filter actions')}>
    <button aria-pressed={filter === 'positive'} onClick={() => { setFilter('positive'); setVisible(30); }}>{t('filter-positive', 'Positive contribution')}</button>
    <button aria-pressed={filter === 'mistake'} onClick={() => { setFilter('mistake'); setVisible(30); }}>{t('filter-mistakes', 'Mistakes')}</button>
    <button aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); setVisible(30); }}>{t('filter-all', 'All actions')}</button>
  </div></div>
    {!entries ? <div className="panel"><Unavailable note={t('moments-unavailable', 'Contextual highlights and mistakes are not calculated yet. Recorded deaths alone are not evidence of a mistake.')}/></div> :
      !entries.length ? <div className="panel empty-state">{t('no-moments', 'No actions match this filter.')}</div> :
      <><div className="moments-grid content-reveal" key={filter}>{entries.slice(0, visible).map((moment) => {
        const player = match.players.find((item) => item.id === moment.playerId);
        const round = match.rounds.find((item) => item.id === moment.roundId);
        return <article className={`panel moment-card ${moment.category}`} key={moment.id}><header><span className="pill">{t('moment-round', 'Round {{round}}', { round: round?.ordinal ?? '—' })}</span><span className="muted">{moment.evidenceStrength ?? (moment.importance === 'high' ? t('importance-high', 'High importance') : t('importance-medium', 'Medium importance'))}</span></header><Icon name={moment.category === 'positive' ? 'chart' : 'warning'} size={26}/>{player && <Link className="moment-player" to={playerPath(base, player.id)}>{player.displayName}</Link>}<p>{momentDescription(moment.kind, t)}</p>{moment.observedFacts?.length ? <small>{moment.observedFacts.join(' · ')}</small> : null}<footer><span>{t('moment-tick', 'Tick {{tick}}', { tick: moment.tick })}{moment.endTick !== undefined && moment.endTick !== moment.tick ? `–${moment.endTick}` : ''}{match.tickRate ? ' · ' + timeAtTick(moment.tick, match.tickRate) : ''}</span><span>{moment.confidence === null ? t('confidence-unknown', 'Confidence unavailable') : t('moment-confidence', '{{value}} confidence', { value: new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent' }).format(moment.confidence) })}</span></footer><small className="clip-note">{t('clips-planned', 'Demo navigation and clips are planned.')}</small></article>;
      })}</div>{entries.length > visible && <MoreMoments onClick={() => setVisible((count) => count + 30)}/>}</>}
  </section>;
}

function MoreMoments({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('player');
  return <button className="button secondary" onClick={onClick}>{t('more-events', 'Show more events')}</button>;
}
