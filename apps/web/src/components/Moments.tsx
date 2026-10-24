import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { AnalysisMoment, MatchAnalytics } from '../analytics/types.js';
import { focusClass, playerPath, timeAtTick, type PlayerFocus } from '../analytics/presentation.js';
import { Unavailable } from './States.js';

const INITIAL_MOMENTS = 4;

export function momentDescription(kind: AnalysisMoment['kind'], t: TFunction): string {
  switch (kind) {
    case 'trade': return t('moment-trade', 'Traded a teammate and restored player parity.');
    case 'flash-assist': return t('moment-flash', 'A flash enabled a teammate’s elimination.');
    case 'untraded-entry': return t('moment-entry', 'An entry attempt left the team at a disadvantage without an immediate trade.');
    default: return kind;
  }
}

/** Key moments for a stage: the outcome and its confidence lead, the rest stays quiet. */
export function Moments({ match, analytics, base, playerId, full = false, focus }: { match: MatchData; analytics?: MatchAnalytics; base: string; playerId?: string; full?: boolean; focus?: PlayerFocus | undefined }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<'positive' | 'mistake' | 'all'>('all');
  const [visible, setVisible] = useState(full ? Infinity : INITIAL_MOMENTS);
  const all = analytics?.moments?.filter((moment) => !playerId || moment.playerId === playerId);
  const entries = all?.filter((moment) => filter === 'all' || moment.category === filter);
  const count = new Intl.NumberFormat(i18n.resolvedLanguage);
  const choose = (value: typeof filter) => { setFilter(value); setVisible(INITIAL_MOMENTS); };
  if (!entries) return <Unavailable note={t('moments-unavailable', 'Contextual highlights and mistakes are not calculated yet. Recorded deaths alone are not evidence of a mistake.')}/>;
  return <div className="moments">
    <div className="stage-tools"><div className="segmented" role="group" aria-label={t('action-filter', 'Filter actions')}>
      <button aria-pressed={filter === 'positive'} onClick={() => choose('positive')}>{t('filter-positive', 'Positive contribution')}</button>
      <button aria-pressed={filter === 'mistake'} onClick={() => choose('mistake')}>{t('filter-mistakes', 'Mistakes')}</button>
      <button aria-pressed={filter === 'all'} onClick={() => choose('all')}>{t('filter-all', 'All actions')}</button>
    </div><span className="pill">{count.format(entries.length)}</span></div>
    {!entries.length ? <div className="empty-state">{t('no-moments', 'No actions match this filter.')}</div> :
    <div className="moment-list content-reveal" key={filter}>{entries.slice(0, visible).map((moment) => {
      const player = match.players.find((item) => item.id === moment.playerId);
      const round = match.rounds.find((item) => item.id === moment.roundId);
      const ticks = t('moment-tick', 'Tick {{tick}}', { tick: moment.tick }) + (moment.endTick !== undefined && moment.endTick !== moment.tick ? `–${moment.endTick}` : '');
      return <article className={`moment ${moment.category} ${playerId ? '' : 'focusable'} ${focusClass(focus, moment.playerId)}`} key={moment.id} onClick={(event) => { if (!playerId && !(event.target instanceof Element && event.target.closest('a'))) focus?.toggle(moment.playerId); }}>
        <p className="moment-what">{momentDescription(moment.kind, t)}</p>
        <div className="moment-confidence">{moment.confidence === null ? <span>{t('confidence-unknown', 'Confidence unavailable')}</span> : <><strong className="key-figure">{new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent' }).format(moment.confidence)}</strong><span>{t('confidence-label', 'Confidence')}</span></>}</div>
        <div className="moment-meta">{player && <Link to={playerPath(base, player.id)}>{player.displayName}</Link>}<span>{t('moment-round', 'Round {{round}}', { round: round?.ordinal ?? '—' })}</span><span dir="ltr">{match.tickRate ? timeAtTick(moment.tick, match.tickRate) + ' · ' : ''}{ticks}</span><span>{moment.evidenceStrength ?? (moment.importance === 'high' ? t('importance-high', 'High importance') : t('importance-medium', 'Medium importance'))}</span></div>
        {moment.observedFacts?.length ? <small className="moment-facts">{moment.observedFacts.join(' · ')}</small> : null}
      </article>;
    })}</div>}
    {entries.length > visible && <MoreMoments onClick={() => setVisible((value) => value + 10)}/>}
    <p className="stage-footnote">{t('clips-planned', 'Demo navigation and clips are planned.')}</p>
  </div>;
}

function MoreMoments({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('player');
  return <button className="button primary" onClick={onClick}>{t('more-events', 'Show more events')}</button>;
}
