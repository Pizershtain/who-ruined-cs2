import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { Award, MatchAnalytics } from '../analytics/types.js';
import { playerPath, teamOutcome } from '../analytics/presentation.js';
import { Icon } from './Icon.js';

export function Awards({ match, analytics, base }: { match: MatchData; analytics?: MatchAnalytics; base: string }) {
  const { t, i18n } = useTranslation('match');
  function card(kind: 'mvp' | 'whoRuined', award: Award) {
    const player = award.state === 'available' ? match.players.find((item) => item.id === award.playerId) : undefined;
    const eligible = !!player && match.quality === 'VALID' && (kind === 'mvp' || teamOutcome(match, player.teamId) === 'loss');
    const content = <><div className="award-heading"><span className="award-symbol"><Icon name={kind === 'mvp' ? 'trophy' : 'crosshair'} size={24}/></span><div><p className="eyebrow">{kind === 'mvp' ? t('mvp', 'Match MVP') : t('who-ruined', 'Who Ruined')}</p>{kind === 'mvp' && <small>{t('mvp-caption', 'Outstanding contribution')}</small>}</div>{eligible && <Icon name="arrow"/>}</div>
      {eligible && award.state === 'available' ? <div className="award-result"><strong>{player.displayName}</strong><span>{new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 }).format(award.value)}</span><small>{t('award-margin', 'Margin: {{value}}', { value: new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 }).format(award.margin) })}{award.close || award.tied ? ` · ${t('low-confidence', 'Too close to call')}` : ''}</small>{kind === 'whoRuined' && award.noConfirmedHarm && <small>{t('no-confirmed-harm', 'No confirmed harmful action; selection is based on relative contribution shortfall.')}</small>}</div> :
      <div className="award-unavailable"><strong>{award.state === 'low-confidence' ? t('low-confidence', 'Too close to call') : award.state === 'insufficient-data' || match.quality !== 'VALID' ? t('insufficient-data', 'Not enough evidence') : t('ratings-unavailable', 'Rating not available yet')}</strong><p>{award.state === 'low-confidence' ? t('low-confidence-text', 'The evidence does not support a confident selection.') : t('rating-note', 'A name appears here only when a contextual rating is available.')}</p></div>}
    </>;
    return eligible ? <Link className={`panel award-card ${kind}`} to={playerPath(base, player.id)}>{content}</Link> : <article className={`panel award-card ${kind}`}>{content}</article>;
  }
  return <section className="awards-grid" aria-label={t('awards-label', 'Match results')}>{card('mvp', analytics?.mvp ?? { state: 'unavailable' })}{card('whoRuined', analytics?.whoRuined ?? { state: 'unavailable' })}</section>;
}
