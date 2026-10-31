import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../analytics/types.js';
import { Unavailable } from './States.js';
import { ChartSkeleton } from './Skeleton.js';

export function Charts({ match, analytics, loading = false }: { match: MatchData; analytics?: MatchAnalytics; loading?: boolean }) {
  const { t, i18n } = useTranslation('match');
  const [metric, setMetric] = useState<'adr' | 'damage' | 'heDamage' | 'fireDamage'>('adr');
  const [playerId, setPlayerId] = useState(match.players[0]?.id ?? '');
  const metricLabels = { damage: t('damage-distribution', 'Damage distribution'), adr: t('average-damage', 'Average damage'), heDamage: t('he-damage', 'HE damage'), fireDamage: t('fire-damage', 'Fire damage') };
  const selectedMetric = metric in metricLabels ? metric : 'adr';
  const rows = match.players.map((player) => ({ player, value: analytics?.players[player.id]?.[selectedMetric] ?? null }));
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  const grenades = [{ label: t('he-damage', 'HE damage'), value: analytics?.players[playerId]?.heDamage ?? null }, { label: t('fire-damage', 'Fire damage'), value: analytics?.players[playerId]?.fireDamage ?? null }];
  const grenadeMax = Math.max(1, ...grenades.map((item) => item.value ?? 0));
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  return <section className="charts-grid">
    <article className="panel chart-panel"><div className="section-heading"><h2>{t('comparison', 'Player comparison')}</h2><label className="select-label"><span className="sr-only">{t('compare-metric', 'Comparison metric')}</span><select value={selectedMetric} onChange={(event) => { const value = event.target.value; if (value === 'damage' || value === 'adr' || value === 'heDamage' || value === 'fireDamage') setMetric(value); }}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {loading && !analytics ? <ChartSkeleton/> : rows.some((row) => row.value !== null) ? <div className="bar-chart content-reveal" key={selectedMetric}>{rows.map(({ player, value }) => <div className="bar-row" key={player.id}><span title={player.displayName}>{player.displayName}</span><div className="bar-track"><span className={`team-${match.teams.findIndex((team) => team.id === player.teamId)}`} style={{ width: value === null ? '0%' : Math.max(0, value / max * 100) + '%' }}/></div><strong>{value === null ? '—' : number(value)}</strong></div>)}</div> : <Unavailable/>}
      <p className="data-note">{t('comparison-note', 'Compare the same metric across players. Missing values are excluded.')}</p>
    </article>
    <article className="panel chart-panel"><div className="section-heading"><h2>{t('grenade-breakdown', 'Grenade damage')}</h2><label className="select-label"><span className="sr-only">{t('select-player', 'Select player')}</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>{match.players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label></div>
      {loading && !analytics ? <ChartSkeleton/> : grenades.some((item) => item.value !== null) ? <div className="grenade-chart content-reveal" key={playerId}>{grenades.map(({ label, value }, index) => <div key={label}><div className="grenade-caption"><span>{label}</span><strong>{value === null ? '—' : number(value)}</strong></div><div className="bar-track"><span className={`team-${index}`} style={{ width: value === null ? '0%' : `${value / grenadeMax * 100}%` }}/></div></div>)}</div> : <Unavailable/>}
      <p className="data-note">{t('grenade-note', 'Recorded enemy damage from HE grenades and fire. Missing source values remain unavailable.')}</p>
    </article>
    <article className="panel coordination"><div><p className="eyebrow">{t('teamplay', 'The team behind the score')}</p><h3>{t('coordination', 'Team Coordination Index')}</h3></div><span className="pill">{t('coordination-future', 'Planned · not calculated')}</span></article>
  </section>;
}
