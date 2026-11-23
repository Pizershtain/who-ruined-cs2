import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MatchData } from '@who-ruined/contracts';
import { timeAtTick } from '../../entities/match/presentation.js';
import { MatchReplay } from '../match-replay/index.js';

export function RoundHistory({ match }: { match: MatchData }) {
  const { t } = useTranslation('match');
  const [params, setParams] = useSearchParams();
  const selected = params.get('round');
  const round = match.rounds.find((item) => item.id === selected);
  const eventId = params.get('event');
  const focusedEvent = eventId && round ? match.events.find(event => event.id === eventId && event.roundId === round.id) : undefined;
  return <section className="panel round-panel"><div className="section-heading"><div><p className="eyebrow">{t('momentum', 'Round by round')}</p><h2>{t('round-history', 'How the match unfolded')}</h2></div><span className="muted">{t('round-count', '{{count}} rounds', { count: match.rounds.length, defaultValue_one: '{{count}} round', defaultValue_other: '{{count}} rounds' })}</span></div>
    <div className="round-legend">{match.teams.map((team, index) => <span key={team.id}><i className={`team-${index}`}/>{team.label}</span>)}</div>
    {match.rounds.length ? <div className="round-track">{match.rounds.map((item) => {
      const winner = match.teams.findIndex((team) => team.id === item.winnerTeamId);
      return <button type="button" className={`round-chip team-${winner} ${item.isValid ? '' : 'invalid'} ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setParams(previous => { previous.set('round', item.id); previous.delete('event'); return previous; }, { replace: true, preventScrollReset: true })} aria-pressed={selected === item.id} aria-label={t('round-button', 'Round {{round}}, winner: {{winner}}', { round: item.ordinal, winner: match.teams[winner]?.label ?? t('unknown', 'Unknown') })}><span>{item.winnerSide ?? '—'}</span><b>{item.ordinal}</b>{item.isPistol && <small>{t('metrics-pistol', 'Pistol')}</small>}{item.isOvertime && <small>{t('metrics-overtime', 'Overtime')}</small>}</button>;
    })}</div> : <p className="muted">{t('no-rounds', 'No rounds available.')}</p>}
    <div className="round-selection" aria-live="polite">{round ? <div className="round-detail content-reveal" key={round.id}><strong>{t('round-label', 'Round {{round}}', { round: round.ordinal })}</strong><span dir="ltr">{match.teams.map((team) => round.scoreBefore[team.id] ?? '—').join(' : ')} → {match.teams.map((team) => round.scoreAfter[team.id] ?? '—').join(' : ')}</span>{match.tickRate && <span>{timeAtTick(round.startTick, match.tickRate)}–{timeAtTick(round.endTick, match.tickRate)}</span>}<span>{round.isValid ? t('round-valid', 'Validated') : t('round-invalid', 'Unconfirmed round')}</span><MatchReplay match={match} initialRoundId={round.id} focusTick={focusedEvent?.tick ?? null} compact/></div> : null}</div>
  </section>;
}

