import { useEffect, useRef, useState } from 'react';
import type { ReplayMetadata, ReplayRoundArtifact } from '@who-ruined/contracts';
import { replayStatesAtTick, worldToRadar } from './geometry.js';

type Point = readonly [number, number];

function strokeRoute(context: CanvasRenderingContext2D, points: readonly Point[], width: number, color: string): void {
  context.beginPath();
  points.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y));
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = width;
  context.strokeStyle = color;
  context.stroke();
}

function drawTacticalDust2(context: CanvasRenderingContext2D, size: number): void {
  context.fillStyle = '#100d0b';
  context.fillRect(0, 0, size, size);
  context.save();
  context.scale(size, size);
  context.strokeStyle = 'rgba(255, 197, 120, .055)';
  context.lineWidth = 1 / size;
  for (let value = .1; value < 1; value += .1) {
    context.beginPath(); context.moveTo(value, 0); context.lineTo(value, 1); context.stroke();
    context.beginPath(); context.moveTo(0, value); context.lineTo(1, value); context.stroke();
  }
  const shadow = '#231d18';
  const route = '#3a3027';
  const edge = '#5b4938';
  const routes: readonly Point[][] = [
    [[.39,.91],[.40,.79],[.49,.69],[.58,.61],[.66,.50],[.72,.38],[.79,.18]],
    [[.39,.91],[.34,.79],[.31,.65],[.26,.51],[.22,.36],[.21,.13]],
    [[.39,.91],[.47,.77],[.48,.62],[.51,.49],[.58,.36],[.62,.21]],
    [[.21,.13],[.34,.14],[.45,.19],[.56,.25],[.62,.21]],
    [[.62,.21],[.72,.19],[.80,.16]],
    [[.51,.49],[.62,.45],[.72,.38]],
    [[.26,.51],[.38,.47],[.51,.49]]
  ];
  for (const points of routes) strokeRoute(context, points, .075, shadow);
  for (const points of routes) strokeRoute(context, points, .052, route);
  for (const points of routes) strokeRoute(context, points, .004, edge);
  const zones = [
    { x:.80, y:.16, radius:.075, label:'A', fill:'rgba(255, 183, 89, .18)' },
    { x:.21, y:.13, radius:.075, label:'B', fill:'rgba(255, 183, 89, .18)' },
    { x:.62, y:.21, radius:.052, label:'CT', fill:'rgba(86, 166, 255, .13)' },
    { x:.39, y:.91, radius:.052, label:'T', fill:'rgba(255, 166, 74, .13)' }
  ];
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '700 .025px Inter, sans-serif';
  for (const zone of zones) {
    context.beginPath(); context.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2); context.fillStyle = zone.fill; context.fill();
    context.strokeStyle = 'rgba(255,255,255,.16)'; context.lineWidth = .002; context.stroke();
    context.fillStyle = 'rgba(255,240,220,.72)'; context.fillText(zone.label, zone.x, zone.y);
  }
  context.restore();
}

export function ReplayCanvas({ metadata, round, tick, selectedPlayerId, interpolate, label }: {
  metadata: ReplayMetadata;
  round: ReplayRoundArtifact;
  tick: number;
  selectedPlayerId: string | null;
  interpolate: boolean;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () => setCanvasSize(Math.max(280, Math.floor(canvas.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    const calibration = metadata.calibration;
    if (!canvas || !calibration) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const draw = () => {
      const cssSize = canvasSize || 280;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixels = Math.floor(cssSize * ratio);
      if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels; }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawTacticalDust2(context, cssSize);
      const states = replayStatesAtTick(round, tick, interpolate);
      const teamIndex = new Map(metadata.teams.map((team, index) => [team.id, index]));
      for (const state of states) {
        if (state.x === null || state.y === null) continue;
        const player = metadata.players[state.playerIndex];
        if (!player) continue;
        const point = worldToRadar(calibration, state.x, state.y);
        if (point.x < -.05 || point.x > 1.05 || point.y < -.05 || point.y > 1.05) continue;
        const x = point.x * cssSize; const y = point.y * cssSize;
        const selected = player.id === selectedPlayerId;
        const color = teamIndex.get(player.teamId) === 0 ? '#ffb55e' : '#65aaff';
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
          const width = context.measureText(player.displayName).width + 12;
          context.fillStyle = 'rgba(10, 8, 7, .86)'; context.fillRect(x - width / 2, y - 31, width, 18);
          context.fillStyle = '#fff4e6'; context.fillText(player.displayName, x, y - 16);
        }
      }
    };
    draw();
  }, [canvasSize, interpolate, metadata, round, selectedPlayerId, tick]);
  return <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label={label}/>;
}
