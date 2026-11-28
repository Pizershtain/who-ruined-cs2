import { RadarChart, specializationAxis, useRadarLabels } from '../../entities/match/radar.js';
import { EvidenceLinks } from '../../entities/match/EvidenceLinks.js';
import { useFamilyLabels } from '../../entities/match/family-labels.js';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData, StoredParticipationRating } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { useEvpReport, useRadarReport } from './stored-reports.js';
import { errorMessage } from '../../shared/messages.js';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import { RefreshStatus } from '../../shared/ui/States.js';

function ReportStatus({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useTranslation();
  if (!error) return <Skeleton className="skeleton-metric"/>;
  return <div role="status"><p>{errorMessage(error, t)}</p><button type="button" className="button secondary" onClick={retry}>{t('retry', 'Try again')}</button></div>;
}

export function EvpAwards({ match, query }: { match: MatchData; query: ReturnType<typeof useEvpReport> }) {
  const { t } = useTranslation('player');
  const labels = useRadarLabels();
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

export function PlayerRadar({ match, playerId, rating }: { match: MatchData; playerId: string; rating: StoredParticipationRating | undefined }) {
  const query = useRadarReport(match);
  const evpDigest = query.data?.sourceBinding.evpInputDigest;
  const evp = useEvpReport(match, !!evpDigest);
  const boundEvp = !!evpDigest && evpDigest === evp.data?.binding.inputDigest
    && query.data?.sourceBinding.matchResultSchemaVersion === evp.data.binding.matchResultSchemaVersion;
  const { t, i18n } = useTranslation('player');
  const labels = useRadarLabels();
  const player = query.data?.players.find(row => row.playerId === playerId);
  const retry = () => void query.refetch();
  const missingData = t('radar-insufficient-data', 'The demo has too little data to calculate this metric.');
  const partialData = t('radar-confirmed-data', 'Only data that could be verified from the demo is shown.');
  const format = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 3 });
  const title = t('radar-title', 'Player radar');
  const explanation = player && ('ratingExplanation' in player ? player.ratingExplanation : player.h2Explanation);
  const axes = player?.axes.filter(axis => axis.axisId !== 'OBJECTIVES') ?? [];
  const confirmed = query.data && 'confirmedEvidence' in query.data
    ? query.data.confirmedEvidence.players.find(row => row.playerId === playerId)?.axes : undefined;
  const rows = axes.map(axis => {
    const subset = confirmed?.find(value => value.axisId === axis.axisId);
    const evpAttribution = boundEvp ? axis.evpAttribution : null;
    return {
      axis, subset, evpAttribution,
      geometry: axis.geometryValue ?? subset?.geometryValue ?? null,
      value: axis.rawValue ?? subset?.rawValue ?? null,
      award: axis.mvpAttribution ? 'MVP' as const : evpAttribution ? 'EVP' as const : null,
    };
  });
  const captions = { ...labels, ASSISTS: t('radar-assists-caption', 'Assists'), TRADES: t('trades', { ns: 'match', defaultValue: 'Trades' }) };
  const families = useFamilyLabels();
  const base = `/matches/${encodeURIComponent(match.matchId)}`;
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
  };
  return <section className="panel radar-panel"><h2>{title}</h2>
    {!query.data || incompatible ? <ReportStatus error={incompatible ? new ApiClientError('REPORT_POLICY_MISMATCH') : query.error} retry={retry}/> : <>
      <RefreshStatus fetching={query.isFetching} error={query.error} retry={retry}/>
      {!player ? <p>{missingData}</p> : <>
        {explanation?.ratingValue != null && <p>{t('active-rating', 'Active participation rating')} · {format.format(explanation.ratingValue)} {player.awardState === 'MVP' && <b>MVP</b>}{player.awardState === 'EVP' && boundEvp && <b>EVP</b>}</p>}
        {evpDigest && evp.error && <ReportStatus error={evp.error} retry={() => void evp.refetch()}/>}
        {evpDigest && evp.data && !boundEvp && <p role="status">{t('error-report-corrupt', { ns: 'translation', defaultValue: 'The stored rating report could not be verified. Operator action is required.' })}</p>}
        <RadarChart axes={rows.map(({ axis, award, geometry, subset }) => ({ axisId: axis.axisId, caption: captions[axis.axisId], award, geometry, partial: !!subset }))}/>
        <ul className="radar-axes">{rows.map(({ axis, value, subset, award, evpAttribution }) => <li key={axis.axisId}>
          <details><summary><strong>{labels[axis.axisId]}</strong>
            {award && <b className={`report-award ${award.toLowerCase()}`}>{award}</b>}
            {value !== null && <bdi className="radar-value">{format.format(value)}</bdi>}
            {(subset || value === null) && <small className="radar-note">{subset ? partialData : missingData}</small>}
          </summary>
          {value !== null && <small>{axis.unit === 'COUNT_PER_10_VERIFIED_ROUNDS' ? t('radar-per-ten', 'Per 10 verified rounds') : axis.unit === 'SECONDS_PER_VERIFIED_ROUND' ? t('radar-seconds', 'Seconds per verified round') : t('radar-damage', 'Damage per verified round')}</small>}
          {axis.matchAverage !== null && <small>{t('radar-average', 'Match average')} · {format.format(axis.matchAverage)} · {t('award-pool-size', { ns: 'match', defaultValue: 'Pool: {{count}}.', count: axis.comparisonPoolSize })} {axis.comparisonIncompleteCoverage && t('source-partial', { ns: 'match', defaultValue: 'Partial' })}</small>}
          <small>{t('verified-rounds', 'Verified rounds')} · {format.format(axis.verifiedRounds)}</small>
          {axis.scaleExceeded && <small>{format.format(axis.rawValue!)} &gt; {format.format(query.data.axisDefinitions.find(definition => definition.axisId === axis.axisId)!.normalization.maximum)}</small>}
          <dl>{axis.secondaryMetrics.map(metric => <div key={metric.metricId}><dt>{secondary[metric.metricId] ?? metric.metricId}</dt><dd>{metric.value === null ? '—' : format.format(metric.value)}</dd></div>)}</dl>
          {axis.mvpAttribution ? <>
            <dl>{axis.mvpAttribution.families.map(item => <div key={item.family}><dt>{families[item.family]}</dt><dd>+{format.format(item.familyFinalAttribution)}</dd></div>)}</dl>
            <EvidenceLinks match={match} base={base} roundIds={axis.mvpAttribution.evidenceRoundIds} eventIds={axis.mvpAttribution.evidenceEventIds}/>
          </> : evpAttribution ? <>
            <small>EVP · {labels[specializationAxis[evpAttribution.specializationId]]}</small>
            <EvidenceLinks match={match} base={base} roundIds={evpAttribution.evidenceRoundIds} eventIds={evpAttribution.evidenceEventIds}/>
          </> : <EvidenceLinks match={match} base={base} roundIds={subset?.evidenceRoundIds ?? axis.evidenceRoundIds} eventIds={subset?.evidenceEventIds ?? axis.evidenceEventIds}/>}
          </details>
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
