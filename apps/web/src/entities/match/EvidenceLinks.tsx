import type { MatchData } from '@who-ruined/contracts';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { timeAtTick } from './presentation.js';

/** Links resolve through the match roster's recorded rounds and events. */
export function EvidenceLinks({ match, base, roundIds, eventIds }: {
  match: MatchData; base: string; roundIds: readonly string[]; eventIds: readonly string[];
}) {
  const { t } = useTranslation('player');
  const ids = new Set(eventIds);
  const events = match.events.filter(event => ids.has(event.id));
  const rounds = new Set([...roundIds, ...events.map(event => event.roundId)]);
  return <div className="evidence-rounds">{match.rounds.filter(round => rounds.has(round.id)).map(round => {
    const path = `${base}?round=${encodeURIComponent(round.id)}`;
    return <span key={round.id}><Link to={path + '#rounds'}>{t('round', 'Round {{round}}', { round: round.ordinal })}</Link>
      {events.filter(event => event.roundId === round.id).map(event => <Link key={event.id}
        to={path + '&event=' + encodeURIComponent(event.id) + '#rounds'}>{timeAtTick(event.tick, match.tickRate) ?? event.tick}</Link>)}
    </span>;
  })}</div>;
}
