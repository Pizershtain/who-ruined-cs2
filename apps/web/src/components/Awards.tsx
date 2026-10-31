import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { Award, MatchAnalytics } from '../analytics/types.js';
import { playerPath } from '../analytics/presentation.js';
import { Icon } from './Icon.js';

export function Awards({ match, analytics, base }: { match: MatchData; analytics?: MatchAnalytics; base: string }) {
  const { t, i18n } = useTranslation('match');
  function card(kind: 'mvp' | 'whoRuined', award: Award) {
    const player = award.state === 'available' ? match.players.find((item) => item.id === award.playerId) : undefined;
    const available = !!player && award.state === 'available';
    const drawScope = award.scope === 'DRAW_ALL_ELIGIBLE';
    const content = <><div className="award-heading"><span className="award-symbol"><Icon name={kind === 'mvp' ? 'trophy' : 'crosshair'} size={24}/></span><div><p className="eyebrow">{kind === 'mvp' ? t('mvp', 'Match MVP') : t('who-ruined', 'Who Ruined')}</p><small>{kind === 'mvp' ? t('mvp-caption-rating', 'Best calculated rating in the match') : drawScope ? t('who-ruined-draw-caption', 'Lowest calculated rating in the drawn-match pool') : t('who-ruined-caption', 'Lowest calculated rating in the losing roster')}</small></div>{available && <Icon name="arrow"/>}</div>
      {available && award.state === 'available' ? <div className="award-result"><strong>{player.displayName}</strong><span>{new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 }).format(award.value)}</span><small><span>{t('award-pool', 'Backend pool: {{count}} players', { count: award.poolSize })}</span>{(award.close || award.tied) && <span> · {t('award-tied', 'Close or tied result')}</span>}</small></div> :
      <div className="award-unavailable"><strong>{t('insufficient-data', 'Not enough evidence')}</strong><p>{'reason' in award && award.reason ? t('award-unavailable-reason', 'The backend did not select a player. Diagnostic reason: {{reason}}', { reason: award.reason }) : t('award-unavailable-pool', 'No player was selected from the available calculated pool.')}</p>{award.poolSize !== undefined && <p>{t('award-pool-size', 'Pool: {{count}}.', { count: award.poolSize })}</p>}</div>}
    </>;
    return available ? <Link className={`panel award-card ${kind}`} to={playerPath(base, player.id)}>{content}</Link> : <article className={`panel award-card ${kind}`}>{content}</article>;
  }
  return <section className="awards-grid" aria-label={t('awards-label', 'Match results')}>{card('mvp', analytics?.mvp ?? { state: 'unavailable' })}{card('whoRuined', analytics?.whoRuined ?? { state: 'unavailable' })}</section>;
}
