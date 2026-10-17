import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import { timeAtTick } from '../analytics/presentation.js';

export function RoundHistory({ match }: { match: MatchData }) {
  const { t } = useTranslation('match');
  const [selected, setSelected] = useState<string | null>(null);
  const round = match.rounds.find((item) => item.id === selected);
  return <section className="panel round-panel"><div className="section-heading"><div><p className="eyebrow">{t('momentum', 'Round by round')}</p><h2>{t('round-history', 'How the match unfolded')}</h2></div><span className="muted">{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span></div>
    <div className="round-legend">{match.teams.map((team, index) => <span key={team.id}><i className={`team-${index}`}/>{team.label}</span>)}</div>
    {match.rounds.length ? <div className="round-track">{match.rounds.map((item) => {
      const winner = match.teams.findIndex((team) => team.id === item.winnerTeamId);
      return <button type="button" className={`round-chip team-${winner} ${item.isValid ? '' : 'invalid'} ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id} aria-label={t('round-button', 'Round {{round}}, winner: {{winner}}', { round: item.ordinal, winner: match.teams[winner]?.label ?? t('unknown', 'Unknown') })}><span>{item.winnerSide ?? '—'}</span><b>{item.ordinal}</b></button>;
    })}</div> : <p className="muted">{t('no-rounds', 'No rounds available.')}</p>}
    <div className="round-selection" aria-live="polite">{round ? <div className="round-detail content-reveal" key={round.id}><strong>{t('round-label', 'Round {{round}}', { round: round.ordinal })}</strong><span dir="ltr">{match.teams.map((team) => round.scoreBefore[team.id] ?? '—').join(' : ')} → {match.teams.map((team) => round.scoreAfter[team.id] ?? '—').join(' : ')}</span><span>{t('tick-range', 'Ticks {{start}}–{{end}}', { start: round.startTick, end: round.endTick })}</span>{match.tickRate && <span>{timeAtTick(round.startTick, match.tickRate)}–{timeAtTick(round.endTick, match.tickRate)}</span>}<span>{round.isValid ? t('round-valid', 'Validated') : t('round-invalid', 'Unconfirmed round')}</span>{round.issues.length > 0 && <p>{round.issues.join(' · ')}</p>}</div> : <p className="data-note">{t('round-hint', 'Select a round to inspect its score and demo ticks.')}</p>}</div>
  </section>;
}
