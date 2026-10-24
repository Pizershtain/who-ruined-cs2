import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../analytics/types.js';
import { focusClass, timeAtTick, type PlayerFocus } from '../analytics/presentation.js';

/** The round track for a stage: one chip per round, details grow out of the chosen chip. */
export function RoundHistory({ match, analytics, full = false, focus }: { match: MatchData; analytics?: MatchAnalytics; full?: boolean; focus?: PlayerFocus | undefined }) {
  const { t, i18n } = useTranslation('match');
  const [selected, setSelected] = useState<string | null>(null);
  // Horizontal centre of the chosen chip, so its details grow out of that chip.
  const [origin, setOrigin] = useState('50%');
  // Esc closes the round details before anything else on the page (capture runs ahead of other window listeners).
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setSelected(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected]);
  const round = match.rounds.find((item) => item.id === selected);
  const scoredRound = analytics?.roundImpact?.find((item) => item.roundId === selected);
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(value);
  const focusValue = (roundId: string) => focus?.id ? analytics?.roundImpact?.find((item) => item.roundId === roundId)?.players[focus.id] : undefined;
  const roundValue = (playerId: string) => {
    const value = scoredRound?.players[playerId];
    return value === undefined ? '—' : number(value);
  };
  return <div className={`round-panel ${full ? 'full' : ''}`}>
    <div className="stage-tools"><div className="round-legend">{match.teams.map((team, index) => <span key={team.id}><i className={`team-${index}`}/>{team.label}</span>)}</div><span className="muted">{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span></div>
    {match.rounds.length ? <div className="round-track">{match.rounds.map((item) => {
      const winner = match.teams.findIndex((team) => team.id === item.winnerTeamId);
      const impact = focusValue(item.id);
      return <button type="button" style={{ '--i': item.ordinal - 1 } as CSSProperties} className={`round-chip stagger-item team-${winner} ${item.isValid ? '' : 'invalid'} ${selected === item.id ? 'selected' : ''} ${impact === undefined ? '' : impact >= 0 ? 'up' : 'down'}`} key={item.id} onClick={(event) => { const chip = event.currentTarget; setOrigin(chip.offsetLeft - (chip.parentElement?.scrollLeft ?? 0) + chip.offsetWidth / 2 + 'px'); setSelected(selected === item.id ? null : item.id); }} aria-pressed={selected === item.id} aria-label={t('round-button', 'Round {{round}}, winner: {{winner}}', { round: item.ordinal, winner: match.teams[winner]?.label ?? t('unknown', 'Unknown') })}><span>{item.winnerSide ?? '—'}</span><b>{item.ordinal}</b>{impact !== undefined && <small>{number(impact)}</small>}</button>;
    })}</div> : <p className="muted">{t('no-rounds', 'No rounds available.')}</p>}
    <div className="round-selection" aria-live="polite">{round ? <div className="round-detail" key={round.id} style={{ '--origin-x': origin } as CSSProperties}><strong>{t('round-label', 'Round {{round}}', { round: round.ordinal })}</strong><span dir="ltr">{match.teams.map((team) => round.scoreBefore[team.id] ?? '—').join(' : ')} → {match.teams.map((team) => round.scoreAfter[team.id] ?? '—').join(' : ')}</span><span>{t('tick-range', 'Ticks {{start}}–{{end}}', { start: round.startTick, end: round.endTick })}</span>{match.tickRate && <span>{timeAtTick(round.startTick, match.tickRate)}–{timeAtTick(round.endTick, match.tickRate)}</span>}<span>{round.isValid ? t('round-valid', 'Validated') : t('round-invalid', 'Unconfirmed round')}</span>{round.issues.length > 0 && <p>{round.issues.join(' · ')}</p>}{scoredRound && <div><strong>{t('round-impact', 'Impact by round')}</strong><ul>{match.players.map((player) => <li key={player.id} className={`focusable ${focusClass(focus, player.id)}`} onClick={() => focus?.toggle(player.id)}>{player.displayName}: {roundValue(player.id)}</li>)}</ul></div>}</div> : <p className="data-note">{t('round-hint', 'Select a round to inspect its score and demo ticks.')}</p>}</div>
  </div>;
}
