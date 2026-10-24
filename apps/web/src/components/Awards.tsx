import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { Award, MatchAnalytics } from '../analytics/types.js';
import { playerPath, teamOutcome } from '../analytics/presentation.js';
import { Icon } from './Icon.js';
import { Decode } from './Decode.js';

/** The player an award names, or null when the match quality or the award state rules it out. */
export function awardWinner(match: MatchData, award: Award | undefined, kind: 'mvp' | 'whoRuined') {
  if (!award || award.state !== 'available' || match.quality !== 'VALID') return null;
  const player = match.players.find((item) => item.id === award.playerId);
  if (!player || (kind === 'whoRuined' && teamOutcome(match, player.teamId) !== 'loss')) return null;
  return { player, value: award.value };
}

/** MVP and Who Ruined for a stage: two names, two figures, one button each. */
export function Awards({ match, analytics, base }: { match: MatchData; analytics?: MatchAnalytics; base: string }) {
  const { t, i18n } = useTranslation('match');
  function card(kind: 'mvp' | 'whoRuined', award: Award) {
    const player = award.state === 'available' ? match.players.find((item) => item.id === award.playerId) : undefined;
    const eligible = !!player && match.quality === 'VALID' && (kind === 'mvp' || teamOutcome(match, player.teamId) === 'loss');
    return <article className={`award-card ${kind}`} key={kind}>
      <div className="award-heading"><span className="award-symbol"><Icon name={kind === 'mvp' ? 'trophy' : 'crosshair'} size={22}/></span><div><p className="eyebrow">{kind === 'mvp' ? t('mvp', 'Match MVP') : t('who-ruined', 'Who Ruined')}</p>{kind === 'mvp' && <small>{t('mvp-caption', 'Outstanding contribution')}</small>}</div></div>
      {eligible && award.state === 'available' ? <div className="award-result"><strong><Decode text={player.displayName}/></strong><span className="key-figure"><Decode text={new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 }).format(award.value)}/></span><small>{t('award-margin', 'Margin: {{value}}', { value: new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 }).format(award.margin) })}{award.close || award.tied ? ` · ${t('low-confidence', 'Too close to call')}` : ''}</small>{kind === 'whoRuined' && award.noConfirmedHarm && <small>{t('no-confirmed-harm', 'No confirmed harmful action; selection is based on relative contribution shortfall.')}</small>}<Link className="button primary" to={playerPath(base, player.id)}>{t('open-player', 'Open player analysis')}<Icon name="arrow" size={16}/></Link></div> :
      <div className="award-unavailable"><strong>{award.state === 'low-confidence' ? t('low-confidence', 'Too close to call') : award.state === 'insufficient-data' || match.quality !== 'VALID' ? t('insufficient-data', 'Not enough evidence') : t('ratings-unavailable', 'Rating not available yet')}</strong><p>{award.state === 'low-confidence' ? t('low-confidence-text', 'The evidence does not support a confident selection.') : t('rating-note', 'A name appears here only when a contextual rating is available.')}</p></div>}
    </article>;
  }
  return <div className="awards-grid">{card('mvp', analytics?.mvp ?? { state: 'unavailable' })}{card('whoRuined', analytics?.whoRuined ?? { state: 'unavailable' })}</div>;
}
