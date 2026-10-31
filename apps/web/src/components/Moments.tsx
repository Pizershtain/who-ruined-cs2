import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, ParticipationExplanationReport } from '@who-ruined/contracts';
import { playerPath, timeAtTick } from '../analytics/presentation.js';
import { Icon } from './Icon.js';
import { Skeleton } from './Skeleton.js';
import { ApiClientError } from '../api.js';
import { errorMessage } from '../shared/messages.js';
import { MatchReplay } from './MatchReplay.js';

export function Moments({ match, report, base, playerId, loading = false, error, retry }: {
  match: MatchData;
  report?: ParticipationExplanationReport;
  base: string;
  playerId?: string;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
}) {
  const { t, i18n } = useTranslation('player');
  const [expandedMomentId, setExpandedMomentId] = useState<string | null>(null);
  const multiKillTitles: Partial<Record<number, string>> = {
    2: t('important-double-kill', { ns: 'player', defaultValue: 'Double kill' }),
    3: t('important-triple-kill', { ns: 'player', defaultValue: 'Triple kill' }),
    4: t('important-four-kill', { ns: 'player', defaultValue: 'Four kills' }),
    5: t('important-ace', { ns: 'player', defaultValue: 'Ace' })
  };
  const entries = playerId
    ? report?.players.find((player) => player.playerId === playerId)?.importantMoments
    : report?.importantMoments;
  const count = new Intl.NumberFormat(i18n.resolvedLanguage);
  const seconds = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 });
  return <section className="moments-section"><div className="section-heading"><div><p className="eyebrow">{t('facts', 'Recorded facts')}</p><h2>{t('important-moments', 'Important moments')}</h2></div></div>
    {!entries && loading ? <div className="panel analytics-notice" role="status"><Skeleton className="skeleton-metric"/><span>{t('loading', 'Loading…')}</span></div> :
      !entries && error instanceof ApiClientError && error.code === 'REPORT_NOT_READY' ? <div className="panel analytics-notice" role="status"><Skeleton className="skeleton-metric"/><span>{t('error-incomplete', 'The match analysis is not complete yet.')}</span></div> :
      !entries && error ? <div className="inline-alert" role="status"><Icon name="warning"/><p>{errorMessage(error, t)}</p>{retry && <button className="button secondary" onClick={retry}>{t('retry', 'Try again')}</button>}</div> :
      !entries ? <div className="panel empty-state"><p>{t('no-important-moments', 'No verified multi-kills or trades were found for this player.')}</p></div> :
      <div className="moments"><div className="stage-tools"><span className="pill">{count.format(entries.length)}</span></div>
        {!entries.length ? <div className="empty-state"><p>{t('no-important-moments', 'No verified multi-kills or trades were found for this player.')}</p></div> :
          <div className="moment-list content-reveal">{entries.map((moment) => {
            const player = match.players.find((item) => item.id === moment.playerId);
            const time = match.tickRate ? timeAtTick(moment.startTick, match.tickRate) : null;
            const expanded = expandedMomentId === moment.id;
            return <article className={`moment positive ${expanded ? 'with-replay' : ''}`} key={moment.id}>
              <p className="moment-what">{moment.type === 'FAST_TRADE'
                ? t('important-fast-trade', { ns: 'player', defaultValue: 'Fast trade' })
                : moment.type === 'TRADE'
                  ? t('important-trade', { ns: 'player', defaultValue: 'Confirmed trade' })
                  : multiKillTitles[moment.killCount] ?? t('important-double-kill', { ns: 'player', defaultValue: 'Double kill' })}</p>
              <div className="moment-confidence"><strong>{moment.killCount > 1 ? `×${count.format(moment.killCount)}` : <Icon name="check" size={24}/>}</strong></div>
              <div className="moment-meta">
                {!playerId && player && <Link to={playerPath(base, player.id)}>{player.displayName}</Link>}
                <Link to={`${base}#rounds`}>{t('moment-round', 'Round {{round}}', { round: moment.roundOrdinal })}</Link>
                {time && <span dir="ltr">{time}</span>}
              </div>
              <small className="moment-facts">{moment.type === 'MULTI_KILL'
                ? t('important-multikill-summary', 'Enemies eliminated in this round: {{value}}.', { value: count.format(moment.killCount) })
                : moment.type === 'FAST_TRADE' && moment.tradeDelaySeconds !== null
                  ? t('important-fast-trade-summary', 'Eliminated the opponent {{seconds}} seconds after a teammate died.', { seconds: seconds.format(moment.tradeDelaySeconds) })
                  : t('important-trade-summary', 'Eliminated the opponent who killed a teammate.')}
                {moment.type === 'MULTI_KILL' && moment.tradeCount > 0 ? ` ${t('important-trade', { ns: 'player', defaultValue: 'Confirmed trade' })}.` : ''}</small>
              <button type="button" className="button secondary moment-replay-toggle" aria-expanded={expanded} onClick={() => setExpandedMomentId(expanded ? null : moment.id)}><Icon name={expanded ? 'close' : 'expand'} size={17}/>{expanded ? t('replay-close', 'Close reconstruction') : t('replay-open', 'View in 2D reconstruction')}</button>
              {expanded && <div className="moment-replay"><MatchReplay match={match} initialRoundId={moment.roundId} focusTick={moment.startTick} highlightedPlayerId={moment.playerId} compact/></div>}
            </article>;
          })}</div>}
        <p className="stage-footnote">{t('important-moments-note', 'Only verified multi-kills and trades are shown. Ordinary kills, damage and unconfirmed mistakes are excluded.')}</p>
      </div>}
  </section>;
}
