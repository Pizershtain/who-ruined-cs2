import type { ReplayMapCalibration, ReplayRadarLayer, ReplayRoundArtifact } from '@who-ruined/contracts';

type ReplayFrame = ReplayRoundArtifact['frames'][number];
const AIM_TRANSITION_SECONDS = 0.08;
export type PresentedReplayState = {
  playerIndex: number;
  x: number | null;
  y: number | null;
  z: number | null;
  yaw: number | null;
  pitch: number | null;
  alive: boolean;
};

export function worldToRadar(calibration: Pick<ReplayMapCalibration, 'posX' | 'posY' | 'scale' | 'imageWidth' | 'imageHeight'>, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - calibration.posX) / calibration.scale / calibration.imageWidth,
    y: (calibration.posY - y) / calibration.scale / calibration.imageHeight
  };
}

export function isOnRadarLayer(z: number | null, layer: ReplayRadarLayer, multiLevel: boolean): boolean {
  if (!multiLevel) return true;
  return z !== null && layer.minZ !== null && layer.maxZ !== null && z >= layer.minZ && z < layer.maxZ;
}

function asState(value: ReplayFrame['states'][number]): PresentedReplayState {
  return { playerIndex: value[0], x: value[1], y: value[2], z: value[3], yaw: value[4], pitch: value[5], alive: value[6] };
}

function interpolateAngle(from: number, to: number, amount: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * amount;
}

export function replayStatesAtTick(round: ReplayRoundArtifact, tick: number, interpolate: boolean): PresentedReplayState[] {
  const frames = round.frames;
  if (frames.length === 0) return [];
  let before = frames[0]!;
  let after = frames.at(-1)!;
  let beforeIndex = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    if (frame.tick <= tick) { before = frame; beforeIndex = index; }
    if (frame.tick >= tick) { after = frame; break; }
  }
  const beforeByPlayer = new Map(before.states.map((state) => [state[0], state]));
  const afterByPlayer = new Map(after.states.map((state) => [state[0], state]));
  const previous = frames[beforeIndex - 1];
  const previousByPlayer = new Map(previous?.states.map((state) => [state[0], state]) ?? []);
  const indexes = [...new Set([...beforeByPlayer.keys(), ...afterByPlayer.keys()])].sort((a, b) => a - b);
  const nominalGap = round.tickRate / round.sampleRateHz;
  const canInterpolateFrames = interpolate && after.tick > before.tick && after.tick - before.tick <= nominalGap * 2.5;
  const amount = canInterpolateFrames ? Math.max(0, Math.min(1, (tick - before.tick) / (after.tick - before.tick))) : 0;
  // Aim settles shortly after each recorded update, without anticipating the next sample.
  const canAnimateAim = interpolate && previous && before.tick > previous.tick && before.tick - previous.tick <= nominalGap * 2.5;
  const aimAmount = canAnimateAim ? Math.max(0, Math.min(1, (tick - before.tick) / Math.min(round.tickRate * AIM_TRANSITION_SECONDS, before.tick - previous.tick))) : 1;
  return indexes.flatMap((playerIndex) => {
    const prior = beforeByPlayer.get(playerIndex);
    const next = afterByPlayer.get(playerIndex);
    if (!prior && !next) return [];
    if (!prior) return [asState(next!)];
    const state = asState(prior);
    const previousState = previousByPlayer.get(playerIndex);
    if (aimAmount < 1 && previousState?.[6] && prior[6] && previousState[1] !== null && previousState[2] !== null && prior[1] !== null && prior[2] !== null) {
      if (previousState[4] !== null && prior[4] !== null) state.yaw = interpolateAngle(previousState[4], prior[4], aimAmount);
      if (previousState[5] !== null && prior[5] !== null) state.pitch = previousState[5] + (prior[5] - previousState[5]) * aimAmount;
    }
    if (!next || !canInterpolateFrames || prior[6] !== next[6] || !prior[6] || prior[1] === null || prior[2] === null || next[1] === null || next[2] === null) {
      return [state];
    }
    return [{
      playerIndex,
      x: prior[1] + (next[1] - prior[1]) * amount,
      y: prior[2] + (next[2] - prior[2]) * amount,
      z: prior[3] !== null && next[3] !== null ? prior[3] + (next[3] - prior[3]) * amount : prior[3],
      yaw: state.yaw,
      pitch: state.pitch,
      alive: true
    }];
  });
}

