import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { matchDataSchema, type C2S2PreparedSidecar, type MatchData } from '@who-ruined/contracts';
import { assertMatchRelations, normalizeSnapshot } from '@who-ruined/match-domain';
import { parseDemoEquipmentTicks, parseDemoMatchSnapshot, toNormalizationInput, type ParsedMatchSnapshotEnvelope } from '@who-ruined/parser-adapter';
import { projectParticipationRatings, toParticipationRatingPreparedProfiles } from '@who-ruined/scoring';
import { prepareJointEvidence, researchDigest, roundStartEvidenceFromSidecars, type JointEvidence } from '@who-ruined/scoring/h3';

import { prepareParticipationSidecar } from '../participation-sidecar.js';
import { bindEquipmentObservations, equipmentBoundaries } from '../rating-equipment.js';

export type ResearchDemoSource = { relativePath: string; bytes: number; sha256: string; group: string };
type NormalizedDemo = { match: MatchData; envelope: ParsedMatchSnapshotEnvelope };

export async function inventory(root: string): Promise<ResearchDemoSource[]> {
  const rows: ResearchDemoSource[] = [];
  const paths = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of paths.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dem'))) {
    const path = join(entry.parentPath, entry.name);
    const relativePath = relative(root, path).replaceAll('\\', '/');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    rows.push({ relativePath, bytes: (await stat(path)).size, sha256: hash.digest('hex'), group: relativePath.includes('/') ? relativePath.split('/')[0]! : '.' });
  }
  return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function readNormalizedDemo(path: string, source: ResearchDemoSource): NormalizedDemo {
  const envelope = parseDemoMatchSnapshot(path);
  const match = matchDataSchema.parse(normalizeSnapshot(toNormalizationInput({
    matchId: `e7-${source.sha256}`, fileSha256: source.sha256, snapshot: envelope.snapshot,
    normalizedAt: '2000-01-01T00:00:00.000Z',
  })));
  assertMatchRelations(match);
  return { match, envelope };
}

export function prepareDemoEvidence(path: string, { match, envelope }: NormalizedDemo): {
  data: JointEvidence;
  scenario: string;
  roundEvidence: C2S2PreparedSidecar['roundEvidence'];
} {
  const boundaries = equipmentBoundaries(match);
  const rawSnapshots = bindEquipmentObservations(match, boundaries, parseDemoEquipmentTicks(path, [...boundaries.keys()].sort((a, b) => a - b)));
  const { sidecar, base } = prepareParticipationSidecar(envelope.snapshot, match, envelope.participation);
  const starts = roundStartEvidenceFromSidecars(sidecar, base);
  const productionProfiles = toParticipationRatingPreparedProfiles(sidecar.profiles);
  const counted = new Map(sidecar.profiles.map((p) => [p.profileKey, p.countedRoundIds]));
  const profiles = productionProfiles.map((p) => ({ ...p, countedRoundIds: counted.get(p.profileKey)! }));
  const data = prepareJointEvidence(match, profiles, starts, rawSnapshots);
  const direct = projectParticipationRatings(productionProfiles).sort((a, b) => a.profileKey.localeCompare(b.profileKey));
  if (researchDigest(direct) !== researchDigest(data.baseline)) throw new Error('H3_FROZEN_BASELINE_MISMATCH');
  return { data, scenario: sidecar.scenario, roundEvidence: base.roundEvidence };
}
