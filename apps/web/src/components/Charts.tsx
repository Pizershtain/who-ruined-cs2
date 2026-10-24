import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../analytics/types.js';
import { Unavailable } from './States.js';
import { focusClass, type PlayerFocus } from '../analytics/presentation.js';
import { useEffect } from 'react';
import { ChartSkeleton } from './Skeleton.js';

/** Charts for a stage: one chart at a time, switched by tabs so the stage never scrolls. */
export function Charts({ match, analytics, loading = false, full = false, focus }: { match: MatchData; analytics?: MatchAnalytics; loading?: boolean; full?: boolean; focus?: PlayerFocus | undefined }) {
  const { t, i18n } = useTranslation('match');
  const [tab, setTab] = useState<'compare' | 'detail'>('compare');
  // Content slides toward the tab that was chosen, so the motion says where it came from.
  const slide = tab === 'compare' ? 'slide-from-start' : 'slide-from-end';
  const [metric, setMetric] = useState<'adr' | 'damage' | 'utilityDamage' | 'impact' | 'heDamage' | 'fireDamage'>('adr');
  const [playerId, setPlayerId] = useState(match.players[0]?.id ?? '');
  useEffect(() => { if (focus?.id && match.players.some((player) => player.id === focus.id)) setPlayerId(focus.id); }, [focus?.id, match.players]);
  const factual = analytics?.source === 'm2';
  const metricLabels = { damage: t('damage-distribution', 'Damage distribution'), adr: t('average-damage', 'Average damage'), ...(factual ? { heDamage: t('he-damage', 'HE damage'), fireDamage: t('fire-damage', 'Fire damage') } : { utilityDamage: t('utility-damage', 'Utility DMG'), impact: t('impact', 'Impact') }) };
  const selectedMetric = metric in metricLabels ? metric : 'adr';
  const rows = match.players.map((player) => ({ player, value: analytics?.players[player.id]?.[selectedMetric] ?? null }));
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  const impact = analytics?.roundImpact?.map((row) => ({ round: match.rounds.find((item) => item.id === row.roundId)?.ordinal, value: row.players[playerId] ?? null })) ?? [];
  const grenades = [{ label: t('he-damage', 'HE damage'), value: analytics?.players[playerId]?.heDamage ?? null }, { label: t('fire-damage', 'Fire damage'), value: analytics?.players[playerId]?.fireDamage ?? null }];
  const grenadeMax = Math.max(1, ...grenades.map((item) => item.value ?? 0));
  const impactMax = Math.max(1, ...impact.map((item) => Math.abs(item.value ?? 0)));
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(value);
  const detailTitle = factual ? t('grenade-breakdown', 'Grenade damage') : t('round-impact', 'Impact by round');
  const metricSelect = <label className="select-label"><span className="sr-only">{t('compare-metric', 'Comparison metric')}</span><select value={selectedMetric} onChange={(event) => { const value = event.target.value; if (value === 'damage' || value === 'adr' || value === 'utilityDamage' || value === 'impact' || value === 'heDamage' || value === 'fireDamage') setMetric(value); }}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
  const playerSelect = <label className="select-label"><span className="sr-only">{t('select-player', 'Select player')}</span><select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>{match.players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label>;
  const compareChart = loading && !analytics ? <ChartSkeleton/> : rows.some((row) => row.value !== null) ? <div className="bar-chart content-reveal" key={selectedMetric}>{rows.map(({ player, value }, index) => <div style={{ '--i': index } as CSSProperties} className={`bar-row focusable stagger-item ${focusClass(focus, player.id)}`} key={player.id} onClick={() => focus?.toggle(player.id)}><span title={player.displayName}>{player.displayName}</span><div className="bar-track"><span className={`team-${match.teams.findIndex((team) => team.id === player.teamId)}`} style={{ width: value === null ? '0%' : Math.max(0, value / max * 100) + '%' }}/></div><strong>{value === null ? '—' : number(value)}</strong></div>)}</div> : <Unavailable/>;
  const detailChart = loading && !analytics ? <ChartSkeleton/> : factual ? grenades.some((item) => item.value !== null) ? <div className="grenade-chart content-reveal" key={playerId}>{grenades.map(({ label, value }, index) => <div key={label}><div className="grenade-caption"><span>{label}</span><strong>{value === null ? '—' : number(value)}</strong></div><div className="bar-track"><span className={`team-${index}`} style={{ width: value === null ? '0%' : `${value / grenadeMax * 100}%` }}/></div></div>)}</div> : <Unavailable/> : impact.some((item) => item.value !== null) ? <div className="impact-chart content-reveal" key={playerId} aria-label={t('round-impact', 'Impact by round')}>{impact.map((item, index) => <div className="impact-column" key={index}><span>{item.value === null ? '—' : number(item.value)}</span><div className="impact-column-track"><i style={{ height: item.value === null ? 0 : Math.abs(item.value) / impactMax * 50 + '%' }} className={(item.value ?? 0) < 0 ? 'negative' : ''}/></div><b>{item.round ?? '—'}</b></div>)}</div> : <Unavailable/>;
  const compareNote = t('comparison-note', 'Compare the same metric across players. Missing values are excluded.');
  const detailNote = factual ? t('grenade-note', 'Recorded enemy damage from HE grenades and fire. Missing source values remain unavailable.') : t('impact-note', 'Contextual contribution per round. The analysis service defines the scoring model.');
  const coordination = <p className="stage-footnote coordination"><span>{t('coordination', 'Team Coordination Index')}</span><span className="pill">{t('coordination-future', 'Planned · not calculated')}</span></p>;
  if (full) return <div className="charts charts-full">
    <section><div className="stage-tools"><h3>{t('comparison', 'Player comparison')}</h3>{metricSelect}</div>{compareChart}<p className="stage-footnote">{compareNote}</p></section>
    <section><div className="stage-tools"><h3>{detailTitle}</h3>{playerSelect}</div>{detailChart}<p className="stage-footnote">{detailNote}</p></section>
    {coordination}
  </div>;
  return <div className="charts">
    <div className="stage-tools">
      <div className="segmented" role="tablist" aria-label={t('statistics', 'Statistics')}>
        <button role="tab" aria-selected={tab === 'compare'} aria-pressed={tab === 'compare'} onClick={() => setTab('compare')}>{t('comparison', 'Player comparison')}</button>
        <button role="tab" aria-selected={tab === 'detail'} aria-pressed={tab === 'detail'} onClick={() => setTab('detail')}>{detailTitle}</button>
      </div>
      {tab === 'compare' ? metricSelect : playerSelect}
    </div>
    <div className={slide} key={tab}>{tab === 'compare' ? compareChart : detailChart}<p className="stage-footnote">{tab === 'compare' ? compareNote : detailNote}</p></div>
    {coordination}
  </div>;
}
