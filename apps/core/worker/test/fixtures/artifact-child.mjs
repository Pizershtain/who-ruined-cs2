import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const zip = promisify(gzip);
const request = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8'));
const outputPath = path.join(
  path.resolve(process.env.DATA_DIR),
  ...String(request.outputRelative).split('/'),
);
await mkdir(path.dirname(outputPath), { recursive: true });

if (request.outputRelative.includes('optional-equipment-unavailable')) {
  process.exit(65);
}

if (request.outputRelative.includes('partial-temp')) {
  await writeFile(`${outputPath}.tmp`, 'partial');
  setInterval(() => undefined, 1000);
  await new Promise(() => undefined);
}

const validEnvelope = {
  schemaVersion: 'parser-match-snapshot@1',
  snapshot: {
    header: { map_name: 'de_synthetic' },
    players: [],
    eventNames: ['player_disconnect', 'player_spawn', 'player_team', 'hostage_hurt'],
    events: [],
    ticks: [],
  },
  participation: {
    schemaVersion: 'parser-participation-supplement@1',
    evidence: {
      lifecycleEventNames: ['player_disconnect', 'player_spawn', 'player_team'],
      lifecycleRows: [
        { event_name: 'player_spawn', tick: 100, user_steamid: 'a' },
        { event_name: 'player_disconnect', tick: 100, user_steamid: 'b' },
      ],
    },
    prepared: {
      lifecycleRows: [
        { event_name: 'player_team', tick: 100, user_steamid: 'b' },
        { event_name: 'player_spawn', tick: 100, user_steamid: 'a' },
      ],
      hostageRows: [
        { event_name: 'hostage_hurt', tick: 100, user_steamid: 'a', hostage: 1 },
      ],
    },
  },
};

let bytes;
if (request.outputRelative.includes('oversized-compressed')) {
  bytes = Buffer.alloc(request.maxArtifactBytes + 1, 1);
} else if (request.outputRelative.includes('oversized-output')) {
  bytes = await zip(JSON.stringify({ value: 'x'.repeat(request.maxArtifactOutputBytes * 2) }));
} else if (request.outputRelative.includes('malformed-gzip')) {
  bytes = Buffer.from('not-gzip');
} else if (request.outputRelative.includes('truncated-gzip')) {
  const complete = await zip(JSON.stringify(validEnvelope));
  bytes = complete.subarray(0, Math.max(1, complete.length - 8));
} else if (request.outputRelative.includes('corrupt-json')) {
  bytes = await zip('{not-json');
} else if (request.outputRelative.includes('missing-supplement')) {
  bytes = await zip(JSON.stringify(validEnvelope.snapshot));
} else if (request.outputRelative.includes('invalid-supplement')) {
  bytes = await zip(JSON.stringify({
    ...validEnvelope,
    participation: { schemaVersion: 'parser-participation-supplement@1' },
  }));
} else if (request.outputRelative.includes('empty-supplement')) {
  bytes = await zip(JSON.stringify({
    ...validEnvelope,
    snapshot: { ...validEnvelope.snapshot, eventNames: [] },
    participation: {
      schemaVersion: 'parser-participation-supplement@1',
      evidence: { lifecycleEventNames: [], lifecycleRows: [] },
      prepared: { lifecycleRows: [], hostageRows: [] },
    },
  }));
} else if (request.outputRelative.includes('valid-replay')) {
  bytes = await zip(JSON.stringify({
    schemaVersion: 'parser-replay-snapshot@1',
    tickRate: 64,
    sampleRateHz: 4,
    rounds: [{ id: 'round-1', ordinal: 1, startTick: 100, freezeEndTick: 110, endTick: 140 }],
    rows: [{ tick: 100, steamid: 'a', X: 1, Y: 2, Z: 3, is_alive: true }],
  }));
} else {
  bytes = await zip(JSON.stringify(validEnvelope));
}

await writeFile(outputPath, bytes);
if (request.outputRelative.includes('partial')) process.exitCode = 1;
