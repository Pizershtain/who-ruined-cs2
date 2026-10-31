import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchData, ReplayEventKind } from '@who-ruined/contracts';
import { useReplayMetadata, useReplayRound } from '../hooks/useReplay.js';
import { errorMessage } from '../shared/messages.js';
import { ReplayCanvas } from '../replay/ReplayCanvas.js';
import { Icon } from './Icon.js';
import { Skeleton } from './Skeleton.js';

const speeds = [0.5, 1, 2, 4] as const;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

function eventTitle(kind: ReplayEventKind, t: ReturnType<typeof useTranslation>['t']): string {
  if (kind === 'BOMB_PLANTED') return t('recorded-plant', { ns: 'translation', defaultValue: 'Bomb planted' });
  if (kind === 'BOMB_DEFUSED') return t('recorded-defuse', { ns: 'translation', defaultValue: 'Bomb defused' });
  return t('recorded-kill', { ns: 'translation', defaultValue: 'Recorded elimination' });
}

export function MatchReplay({ match, initialRoundId = null, focusTick = null, highlightedPlayerId = null, compact = false }: {
  match: MatchData;
  initialRoundId?: string | null;
  focusTick?: number | null;
  highlightedPlayerId?: string | null;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation('match');
  const reducedMotion = useReducedMotion();
  const metadataQuery = useReplayMetadata(match);
  const metadata = metadataQuery.data;
  const firstAvailableRound = metadata?.rounds.find((round) => round.sampleCount > 0)?.id ?? null;
  const [roundId, setRoundId] = useState<string | null>(initialRoundId);
  const effectiveRoundId = roundId ?? firstAvailableRound;
  const roundQuery = useReplayRound(match, metadata?.availability === 'AVAILABLE' ? effectiveRoundId : null);
  const round = roundQuery.data;
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(highlightedPlayerId);

  useEffect(() => { if (initialRoundId) setRoundId(initialRoundId); }, [initialRoundId]);
  useEffect(() => { setSelectedPlayerId(highlightedPlayerId); }, [highlightedPlayerId]);
  useEffect(() => {
    if (!round) return;
    const preRoll = focusTick === null ? round.round.startTick : focusTick - round.tickRate * 5;
    setTick(Math.max(round.round.startTick, Math.min(round.round.endTick, preRoll)));
    setPlaying(false);
  }, [focusTick, round]);

  useEffect(() => {
    if (!playing || !round) return;
    let frame = 0;
    let previous = performance.now();
    const advance = (now: number) => {
      const elapsed = Math.min(250, now - previous);
      previous = now;
      let reachedEnd = false;
      setTick((current) => {
        const next = current + elapsed / 1000 * round.tickRate * speed;
        if (next >= round.round.endTick) { reachedEnd = true; return round.round.endTick; }
        return next;
      });
      if (reachedEnd) setPlaying(false); else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, round, speed]);

  const playerNames = useMemo(() => new Map(metadata?.players.map((player) => [player.id, player.displayName]) ?? []), [metadata]);
  const time = (value: number) => {
    if (!round) return '—';
    const seconds = Math.max(0, (value - round.round.startTick) / round.tickRate);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${new Intl.NumberFormat(i18n.resolvedLanguage, { minimumIntegerDigits: 2 }).format(minutes)}:${new Intl.NumberFormat(i18n.resolvedLanguage, { minimumIntegerDigits: 2, maximumFractionDigits: 1 }).format(rest)}`;
  };

  if (metadataQuery.isPending) return <div className="panel replay-shell replay-loading" role="status"><Skeleton className="replay-skeleton"/><span>{t('replay-loading', 'Loading 2D reconstruction…')}</span></div>;
  if (metadataQuery.error) return <div className="inline-alert" role="status"><Icon name="warning"/><p>{errorMessage(metadataQuery.error, t)}</p><button className="button secondary" onClick={() => void metadataQuery.refetch()}>{t('retry', 'Try again')}</button></div>;
  if (!metadata || metadata.availability === 'REPLAY_UNAVAILABLE') return <div className="panel empty-state replay-empty"><Icon name="info"/><h3>{t('replay-unavailable', '2D reconstruction is unavailable')}</h3><p>{t('replay-unavailable-note', 'This match was processed before coordinate snapshots were stored. Movement is not inferred from statistics.')}</p></div>;
  if (metadata.availability === 'UNSUPPORTED_MAP' || !metadata.calibration) return <div className="panel empty-state replay-empty"><Icon name="info"/><h3>{t('replay-map-unsupported', 'This map is not supported yet')}</h3><p>{t('replay-map-unsupported-note', 'Stored coordinates are not shown without a verified map calibration.')}</p></div>;
  if (metadata.rounds.length === 0) return <div className="panel empty-state replay-empty"><Icon name="info"/><h3>{t('replay-title', '2D reconstruction')}</h3><p>{t('no-rounds', 'No rounds available.')}</p></div>;

  return <section className={`panel replay-shell ${compact ? 'compact' : ''}`} aria-live="off">
    <div className="replay-heading"><div><p className="eyebrow">{t('replay-eyebrow', 'Recorded coordinates')}</p><h2>{t('replay-title', '2D reconstruction')}</h2></div><span className="pill">{t('replay-sampling', '{{rate}} snapshots/s', { rate: metadata.sampleRateHz })}</span></div>
    <p className="data-note">{t('replay-accuracy-note', 'Positions are sampled from the demo and smoothly connected only between adjacent verified snapshots. This is not frame-accurate video.')}</p>
    <div className="replay-toolbar">
      <label className="select-label"><span>{t('replay-round', 'Round')}</span><select value={effectiveRoundId ?? ''} onChange={(event) => setRoundId(event.target.value)}>{metadata.rounds.map((item) => <option key={item.id} value={item.id}>{t('round-label', 'Round {{round}}', { round: item.ordinal })}</option>)}</select></label>
      <label className="select-label"><span>{t('replay-player', 'Highlight player')}</span><select value={selectedPlayerId ?? ''} onChange={(event) => setSelectedPlayerId(event.target.value || null)}><option value="">{t('replay-all-players', 'All players')}</option>{metadata.players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label>
    </div>
    {roundQuery.error ? <div className="inline-alert" role="status"><Icon name="warning"/><p>{errorMessage(roundQuery.error, t)}</p><button className="button secondary" onClick={() => void roundQuery.refetch()}>{t('retry', 'Try again')}</button></div> : roundQuery.isPending || !round ? <div className="replay-stage replay-loading" role="status"><Skeleton className="replay-skeleton"/><span>{t('replay-round-loading', 'Loading round coordinates…')}</span></div> : <>
      {round.coverage === 'PARTIAL' && <div className="inline-alert" role="status"><Icon name="warning"/><p>{t('replay-partial', 'Some coordinate snapshots are missing. Gaps are not interpolated.')}</p></div>}
      <div className="replay-layout">
        <div className="replay-stage"><ReplayCanvas metadata={metadata} round={round} tick={tick} selectedPlayerId={selectedPlayerId} interpolate={!reducedMotion} label={t('replay-canvas-label', 'Top-down reconstruction of player positions for the selected round')}/></div>
        <aside className="replay-rosters">{metadata.teams.map((team, index) => <div key={team.id}><strong><i className={`team-${index}`}/>{team.label}</strong>{metadata.players.filter((player) => player.teamId === team.id).map((player) => <button type="button" className={selectedPlayerId === player.id ? 'selected' : ''} key={player.id} onClick={() => setSelectedPlayerId(player.id)}>{player.displayName}</button>)}</div>)}</aside>
      </div>
      <div className="replay-controls">
        <button type="button" className="button primary replay-play" onClick={() => { if (tick >= round.round.endTick) setTick(round.round.startTick); setPlaying((value) => !value); }}>{playing ? t('replay-pause', 'Pause') : t('replay-play', 'Play')}</button>
        <output aria-live="off" dir="ltr">{time(tick)}</output>
        <div className="replay-speeds" aria-label={t('replay-speed', 'Playback speed')}>{speeds.map((value) => <button type="button" key={value} className={speed === value ? 'selected' : ''} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div>
      </div>
      <div className="replay-timeline">
        <input type="range" min={round.round.startTick} max={round.round.endTick} step="1" value={Math.round(tick)} aria-label={t('replay-seek', 'Replay timeline')} onChange={(event) => { setPlaying(false); setTick(Number(event.target.value)); }}/>
        <div className="replay-event-marks">{round.events.map((event) => <button type="button" key={event.id} className={`replay-mark ${event.kind.toLowerCase()}`} style={{ insetInlineStart: `${100 * (event.tick - round.round.startTick) / Math.max(1, round.round.endTick - round.round.startTick)}%` }} aria-label={eventTitle(event.kind, t)} onClick={() => { setPlaying(false); setTick(Math.max(round.round.startTick, event.tick - round.tickRate * 5)); }}/>)}</div>
      </div>
      <div className="replay-events">{round.events.map((event) => <button type="button" key={event.id} onClick={() => { setPlaying(false); setTick(Math.max(round.round.startTick, event.tick - round.tickRate * 5)); }}><span>{eventTitle(event.kind, t)}{event.actorId && event.targetId ? <small>{playerNames.get(event.actorId)} → {playerNames.get(event.targetId)}</small> : null}</span><time dir="ltr">{time(event.tick)}</time></button>)}</div>
    </>}
  </section>;
}
