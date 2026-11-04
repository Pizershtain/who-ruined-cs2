import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../../shared/ui/Skeleton.js';
import type { ReplayMetadata, ReplayRadarCalibration, ReplayRadarLayer, ReplayRoundArtifact } from '@who-ruined/contracts';
import { isOnRadarLayer, replayStatesAtTick, worldToRadar } from './geometry.js';

export function ReplayCanvas({ metadata, calibration, layer, round, tick, selectedPlayerId, interpolate, label }: {
  metadata: ReplayMetadata;
  calibration: ReplayRadarCalibration;
  layer: ReplayRadarLayer;
  round: ReplayRoundArtifact;
  tick: number;
  selectedPlayerId: string | null;
  interpolate: boolean;
  label: string;
}) {
  const { t } = useTranslation('match');
  const [attempt, setAttempt] = useState(0);
  const [asset, setAsset] = useState<{ url: string; image: HTMLImageElement | null; failed: boolean } | null>(null);
  const image = asset?.url === layer.imageUrl ? asset.image : null;
  const failed = asset?.url === layer.imageUrl && asset.failed;
  useEffect(() => {
    let cancelled = false;
    const bitmap = new Image();
    setAsset(null);
    bitmap.onload = () => {
      if (cancelled) return;
      const valid = bitmap.naturalWidth === bitmap.naturalHeight && [1024, 2048].includes(bitmap.naturalWidth);
      setAsset({ url: layer.imageUrl, image: valid ? bitmap : null, failed: !valid });
    };
    bitmap.onerror = () => { if (!cancelled) setAsset({ url: layer.imageUrl, image: null, failed: true }); };
    bitmap.src = layer.imageUrl;
    return () => { cancelled = true; bitmap.onload = null; bitmap.onerror = null; };
  }, [attempt, layer.imageUrl]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState(0);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const points = useMemo(() => replayStatesAtTick(round, tick, interpolate).flatMap(state => {
    if (state.x === null || state.y === null || !isOnRadarLayer(state.z, layer, calibration.layers.length > 1)) return [];
    const player = metadata.players[state.playerIndex];
    if (!player) return [];
    const point = worldToRadar(calibration, state.x, state.y);
    if (point.x < -.05 || point.x > 1.05 || point.y < -.05 || point.y > 1.05) return [];
    return [{ state, player, point }];
  }), [calibration, interpolate, layer, metadata.players, round, tick]);
  const hovered = pointer && image ? points.reduce<(typeof points)[number] | null>((nearest, candidate) => {
    const distance = Math.hypot(candidate.point.x - pointer.x, candidate.point.y - pointer.y);
    if (distance * (canvasSize || 280) > 16) return nearest;
    return !nearest || distance < Math.hypot(nearest.point.x - pointer.x, nearest.point.y - pointer.y) ? candidate : nearest;
  }, null) : null;
  useEffect(() => { setPointer(null); }, [round, layer.id]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => setCanvasSize(Math.max(1, Math.floor(canvas.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  // Paint fractional playback positions before the browser presents this frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const draw = () => {
      const cssSize = canvasSize || 280;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixels = Math.floor(cssSize * ratio);
      if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = '#100d0b';
      context.fillRect(0, 0, cssSize, cssSize);
      context.drawImage(image, 0, 0, cssSize, cssSize);
      const teamIndex = new Map(metadata.teams.map((team, index) => [team.id, index]));
      const theme = getComputedStyle(canvas);
      const teamColors = [theme.getPropertyValue('--team-a').trim(), theme.getPropertyValue('--team-b').trim()];
      for (const { state, player, point } of points) {
        const x = point.x * cssSize; const y = point.y * cssSize;
        const selected = player.id === selectedPlayerId;
        const color = teamColors[teamIndex.get(player.teamId) === 0 ? 0 : 1]!;
        if (state.yaw !== null && state.alive) {
          const angle = -state.yaw * Math.PI / 180;
          context.beginPath(); context.moveTo(x, y); context.lineTo(x + Math.cos(angle) * (selected ? 28 : 21), y + Math.sin(angle) * (selected ? 28 : 21));
          context.strokeStyle = color; context.globalAlpha = .72; context.lineWidth = selected ? 3 : 2; context.stroke(); context.globalAlpha = 1;
        }
        if (selected) {
          context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2); context.strokeStyle = '#fff6df'; context.lineWidth = 3; context.stroke();
        }
        context.beginPath(); context.arc(x, y, selected ? 9 : 7, 0, Math.PI * 2);
        context.fillStyle = state.alive ? color : '#615c57'; context.fill();
        context.strokeStyle = state.alive ? '#17110d' : '#b7aca1'; context.lineWidth = 2; context.stroke();
        if (!state.alive) {
          context.beginPath(); context.moveTo(x - 4, y - 4); context.lineTo(x + 4, y + 4); context.moveTo(x + 4, y - 4); context.lineTo(x - 4, y + 4);
          context.strokeStyle = '#d8cec3'; context.lineWidth = 1.5; context.stroke();
        }
        if (selected) {
          context.font = '600 12px Inter, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'bottom';
          const width = Math.min(cssSize - 8, context.measureText(player.displayName).width + 12);
          const labelX = Math.max(width / 2 + 4, Math.min(cssSize - width / 2 - 4, x));
          const labelY = Math.max(20, y - 16);
          context.fillStyle = 'rgba(10, 8, 7, .86)'; context.fillRect(labelX - width / 2, labelY - 15, width, 18);
          context.fillStyle = '#fff4e6'; context.fillText(player.displayName, labelX, labelY, width - 12);
        }
      }
    };
    draw();
  }, [canvasSize, image, metadata, points, selectedPlayerId]);
  return <div className="replay-map-surface" aria-busy={!image && !failed}>
    <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={label} style={{ visibility: image ? 'visible' : 'hidden' }} onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      setPointer({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
    }} onPointerLeave={() => setPointer(null)} onPointerCancel={() => setPointer(null)}/>
    {hovered && <div className="replay-player-tooltip" role="tooltip" style={{ left: `${Math.max(25, Math.min(75, hovered.point.x * 100))}%`, top: `${Math.max(2, Math.min(85, hovered.point.y * 100 + 4))}%` }}><bdi>{hovered.player.displayName}</bdi></div>}
    {!image && <div className="replay-map-placeholder" role="status">{failed ? <><p>{t('replay-map-load-error', 'Could not load the map image.')}</p><button type="button" className="button secondary" onClick={() => setAttempt(value => value + 1)}>{t('retry', 'Try again')}</button></> : <><Skeleton className="replay-skeleton"/><span>{t('replay-loading', 'Loading 2D reconstruction…')}</span></>}</div>}
  </div>;
}

