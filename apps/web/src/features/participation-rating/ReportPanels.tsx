import { EvidenceLinks } from '../../entities/match/EvidenceLinks.js';
import { useFamilyLabels } from '../../entities/match/family-labels.js';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, PlayerRadarAxisId, EvpSpecializationId, StoredParticipationRating } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { useEvpReport, useRadarReport } from './stored-reports.js';
import { errorMessage } from '../../shared/messages.js';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import { RefreshStatus } from '../../shared/ui/States.js';

function useAxisLabels(): Record<PlayerRadarAxisId, string> {
  const { t } = useTranslation('player');
  return {
    MULTIKILL: t('radar-multikill', 'Multi-kills'), CLUTCH: t('impact-clutch', 'Clutch'),
    ENTRY: t('radar-entry', 'Opening duels'), UTILITY: t('radar-utility', 'Utility'),
    TRADES: t('trades', 'Successful trades'), ASSISTS: t('assists-nonflash', 'Non-flash assists'),
    FLASH: t('source-flashes', { ns: 'match', defaultValue: 'Flashes' }), OBJECTIVES: t('family-objectives', 'Objectives'),
  };
}

const specializationAxis: Record<EvpSpecializationId, PlayerRadarAxisId> = {
  FLASH_SUPPORT: 'FLASH', NON_FLASH_ASSIST_SUPPORT: 'ASSISTS', TRADE_SPECIALIST: 'TRADES', CLUTCH_SPECIALIST: 'CLUTCH',
  MULTIKILL_SPECIALIST: 'MULTIKILL', ENTRY_SPECIALIST: 'ENTRY', UTILITY_DAMAGE_SPECIALIST: 'UTILITY', OBJECTIVE_SPECIALIST: 'OBJECTIVES',
};

function ReportStatus({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  if (!error) return <Skeleton className="skeleton-metric"/>;
  return <div role="status"><p>{errorMessage(error, t)}</p><button type="button" className="button secondary" onClick={retry}>{t('retry', 'Try again')}</button></div>;
}

export function EvpAwards({ match }: { match: MatchData }) {
  const query = useEvpReport(match);
  const { t } = useTranslation('player');
  const labels = useAxisLabels();
  const retry = () => void query.refetch();
  return <section className="panel stored-awards"><h2>EVP</h2>
    {query.data ? <>
      <RefreshStatus fetching={query.isFetching} error={query.error} retry={retry}/>
      {query.data.awards.length ? <ol>{query.data.awards.map(award => <li key={award.playerId}>
        <Link to={`/matches/${encodeURIComponent(match.matchId)}/players/${encodeURIComponent(award.playerId)}`}><bdi>{match.players.find(player => player.id === award.playerId)?.displayName}</bdi></Link>
        <span> · {labels[specializationAxis[award.specializationId]]}</span>
      </li>)}</ol> : <p>{t('evp-empty', 'No EVP awarded')}</p>}
    </> : <ReportStatus error={query.error} retry={retry}/>}
  </section>;
}

function axisPoint(index: number, value: number) {
  const angle = index * Math.PI / 4 - Math.PI / 2;
  return { x: 100 + Math.cos(angle) * value * 82, y: 100 + Math.sin(angle) * value * 82 };
}

export function PlayerRadar({ match, playerId, rating }: { match: MatchData; playerId: string; rating: StoredParticipationRating | undefined }) {
  const query = useRadarReport(match);
  const evpDigest = query.data?.sourceBinding.evpInputDigest;
  const evp = useEvpReport(match, !!evpDigest);
  const boundEvp = !!evpDigest && evpDigest === evp.data?.binding.inputDigest
    && query.data?.sourceBinding.matchResultSchemaVersion === evp.data.binding.matchResultSchemaVersion;
  const { t, i18n } = useTranslation('player');
  const labels = useAxisLabels();
  const player = query.data?.players.find(row => row.playerId === playerId);
  const retry = () => void query.refetch();
  const unavailable = t('source-unavailable', { ns: 'match', defaultValue: 'Unavailable' });
  const format = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 });
  const title = t('radar-title', 'Player radar');
  const explanation = player && ('ratingExplanation' in player ? player.ratingExplanation : player.h2Explanation);
  const axes = player?.axes ?? [];
  const families = useFamilyLabels();
  const binding = query.data?.sourceBinding;
  const incompatible = binding && rating && ('ratingPolicy' in binding
    ? rating.schemaVersion !== 'm4.3-participation-rating@2' || binding.ratingPolicy.digest !== rating.policy.digest
    : binding.h2ReportSchemaVersion !== null && binding.h2ReportSchemaVersion !== rating.schemaVersion);
  const secondary: Record<string, string> = {
    DOUBLE_KILL_ROUNDS: t('important-double-kill', 'Double kill'), TRIPLE_KILL_ROUNDS: t('important-triple-kill', 'Triple kill'),
    QUAD_KILL_ROUNDS: t('important-four-kill', 'Four kills'), ACE_ROUNDS: t('important-ace', 'Ace'),
    NON_FLASH_ASSISTS: labels.ASSISTS, ALL_ASSISTS: t('assists-total', 'Total assists'), FLASH_ASSISTS: t('assists-flash', 'Flash assists'),
    TRADE_KILLS: labels.TRADES, CLUTCH_WINS: labels.CLUTCH, CLUTCH_POINTS: t('clutch-points', 'Clutch points'),
    ENEMY_BLIND_SECONDS: t('metrics-enemy-blind', { ns: 'match', defaultValue: 'Enemy blind time (seconds)' }),
    ENEMIES_FLASHED: t('metrics-enemies-flashed', { ns: 'match', defaultValue: 'Enemies flashed' }),
    OPENING_KILLS: t('opening-kills', { ns: 'match', defaultValue: 'Opening K' }), OPENING_DEATHS: t('opening-deaths', { ns: 'match', defaultValue: 'Opening D' }),
    HE_ENEMY_DAMAGE: t('he-damage', { ns: 'match', defaultValue: 'HE damage' }), INFERNO_ENEMY_DAMAGE: t('fire-damage', { ns: 'match', defaultValue: 'Fire damage' }),
    BOMB_PLANTS: t('metrics-plants', { ns: 'match', defaultValue: 'Bomb plants' }), BOMB_DEFUSES: t('metrics-defuses', { ns: 'match', defaultValue: 'Bomb defuses' }),
  };
  return <section className="panel radar-panel"><h2>{title}</h2>
    {!query.data || incompatible ? <ReportStatus error={incompatible ? new ApiClientError('REPORT_POLICY_MISMATCH') : query.error} retry={retry}/> : <>
      <RefreshStatus fetching={query.isFetching} error={query.error} retry={retry}/>
      {!player ? <p>{unavailable}</p> : <>
        {explanation?.ratingValue != null && <p>{t('active-rating', 'Active participation rating')} · {format.format(explanation.ratingValue)} {player.awardState === 'MVP' && <b>MVP</b>}{player.awardState === 'EVP' && boundEvp && <b>EVP</b>}</p>}
        {evpDigest && evp.error && <ReportStatus error={evp.error} retry={() => void evp.refetch()}/>}
        {evpDigest && evp.data && !boundEvp && <p role="status">{t('error-report-corrupt', { ns: 'translation', defaultValue: 'The stored rating report could not be verified. Operator action is required.' })}</p>}
        <div className="radar-layout"><svg viewBox="0 0 200 200" aria-hidden="true">
          {[0.25, 0.5, 0.75, 1].map(radius => <circle key={radius} cx="100" cy="100" r={radius * 82} className="radar-grid"/>)}
          {axes.map((axis, index) => {
            const end = axisPoint(index, 1);
            const point = axis.geometryValue === null ? null : axisPoint(index, axis.geometryValue);
            const nextValue = axes[(index + 1) % axes.length]?.geometryValue;
            const next = nextValue == null ? null : axisPoint(index + 1, nextValue);
            const caption = axisPoint(index, 1.13);
            return <g key={axis.axisId}><line x1="100" y1="100" x2={end.x} y2={end.y} className="radar-grid"/>
              {point && next && <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} className="radar-edge"/>}
              {point && <circle cx={point.x} cy={point.y} r="3" className={axis.mvpAttribution ? 'radar-mvp' : axis.evpAttribution && boundEvp ? 'radar-evp' : 'radar-point'}><title>{labels[axis.axisId]} · {axis.rawValue === null ? unavailable : format.format(axis.rawValue)} · {t('radar-average', 'Match average')} · {axis.matchAverage === null ? unavailable : format.format(axis.matchAverage)} · {t('award-pool-size', { ns: 'match', defaultValue: 'Pool: {{count}}.', count: axis.comparisonPoolSize })} {axis.comparisonIncompleteCoverage && t('source-partial', { ns: 'match', defaultValue: 'Partial' })}</title></circle>}
              <text x={caption.x} y={caption.y} textAnchor="middle" dominantBaseline="central">{format.format(index + 1)}</text>
            </g>;
          })}
        </svg><ol className="radar-axes">{axes.map(axis => <li key={axis.axisId}>
          <details><summary><strong>{labels[axis.axisId]}</strong> · {axis.rawValue === null ? unavailable : format.format(axis.rawValue)}
          {axis.mvpAttribution && <b> · MVP</b>}{axis.evpAttribution && boundEvp && <b> · EVP</b>}
          </summary><small>{axis.unit === 'COUNT_PER_10_VERIFIED_ROUNDS' ? t('radar-per-ten', 'Per 10 verified rounds') : axis.unit === 'SECONDS_PER_VERIFIED_ROUND' ? t('radar-seconds', 'Seconds per verified round') : axis.unit === 'DAMAGE_PER_VERIFIED_ROUND' ? t('radar-damage', 'Damage per verified round') : ''}</small>
          <small>{t('radar-average', 'Match average')} · {axis.matchAverage === null ? unavailable : format.format(axis.matchAverage)} · {t('award-pool-size', { ns: 'match', defaultValue: 'Pool: {{count}}.', count: axis.comparisonPoolSize })} {axis.comparisonIncompleteCoverage && t('source-partial', { ns: 'match', defaultValue: 'Partial' })}</small>
          <small>{t('verified-rounds', 'Verified rounds')} · {format.format(axis.verifiedRounds)}</small>
          {axis.scaleExceeded && <small>{format.format(axis.rawValue!)} &gt; {format.format(query.data.axisDefinitions.find(definition => definition.axisId === axis.axisId)!.normalization.maximum)}</small>}
          <dl>{axis.secondaryMetrics.map(metric => <div key={metric.metricId}><dt>{secondary[metric.metricId] ?? metric.metricId}</dt><dd>{metric.value === null ? unavailable : format.format(metric.value)}</dd></div>)}</dl>
          <small>{('relatedRatingFamilies' in axis ? axis.relatedRatingFamilies : axis.relatedH2Families).map(id => families[id]).join(', ')}</small>
          <EvidenceLinks match={match} base={`/matches/${encodeURIComponent(match.matchId)}`} roundIds={axis.evidenceRoundIds} eventIds={axis.evidenceEventIds}/>
          </details>
        </li>)}</ol></div>
      </>}
    </>}
  </section>;
}
