import { replayRadarCalibrationSchema, type ReplayMapCalibration, type ReplayRadarCalibration } from '@who-ruined/contracts';
import { replayMapCatalog } from './replay-map-catalog.generated.js';

/** Presentation metadata only: existing replay indexes and coordinate payloads stay immutable. */
export function resolveReplayRadar(map: string | null, stored: ReplayMapCalibration | null): ReplayRadarCalibration | null {
  if (!map || !Object.hasOwn(replayMapCatalog, map)) return null;
  const radar = replayMapCatalog[map]!;
  // Never attach a new image to a conflicting historical coordinate transform.
  if (stored && (stored.map !== map || stored.posX !== radar.posX || stored.posY !== radar.posY ||
    stored.scale !== radar.scale || stored.imageWidth !== radar.imageWidth || stored.imageHeight !== radar.imageHeight || stored.rotate !== radar.rotate)) return null;
  return replayRadarCalibrationSchema.parse(radar);
}
