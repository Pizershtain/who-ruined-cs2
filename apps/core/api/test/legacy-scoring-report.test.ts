import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Controller,
  Get,
  Module,
  Param,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  matchArtifactSchema,
  type ScoringReport,
} from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import {
  scoreMatch,
  SUCCESSOR_75_25_CONFIG,
} from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

let dataRoot = '';
vi.mock('../src/storage.js', () => ({
  get dataRoot() {
    return dataRoot;
  },
}));

const { StoredArtifactReader } = await import(
  '../src/infrastructure/stored-artifact-reader.js'
);
const { SafeExceptionFilter } = await import('../src/safe-exception.filter.js');
const reader = new StoredArtifactReader();

@Controller('legacy-report')
class LegacyReportTestController {
  @Get(':name')
  read(@Param('name') name: string) {
    return reader.readScoringReport(`reports/${name}.json.gz`);
  }
}

@Module({ controllers: [LegacyReportTestController] })
class LegacyReportTestModule {}

let app: NestExpressApplication;
const previous = {
  compressed: process.env.MAX_RESULT_COMPRESSED_BYTES,
  json: process.env.MAX_RESULT_JSON_BYTES,
  depth: process.env.MAX_RESULT_JSON_DEPTH,
};

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(
    LegacyReportTestModule,
    { logger: false },
  );
  app.useGlobalFilters(new SafeExceptionFilter());
  await app.init();
});

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-legacy-report-'));
  await mkdir(path.join(dataRoot, 'reports'), { recursive: true });
  process.env.MAX_RESULT_COMPRESSED_BYTES = '1048576';
  process.env.MAX_RESULT_JSON_BYTES = '8388608';
  process.env.MAX_RESULT_JSON_DEPTH = '128';
});

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await app.close();
  if (previous.compressed === undefined) {
    delete process.env.MAX_RESULT_COMPRESSED_BYTES;
  } else {
    process.env.MAX_RESULT_COMPRESSED_BYTES = previous.compressed;
  }
  if (previous.json === undefined) {
    delete process.env.MAX_RESULT_JSON_BYTES;
  } else {
    process.env.MAX_RESULT_JSON_BYTES = previous.json;
  }
  if (previous.depth === undefined) {
    delete process.env.MAX_RESULT_JSON_DEPTH;
  } else {
    process.env.MAX_RESULT_JSON_DEPTH = previous.depth;
  }
});

function validReport(): ScoringReport {
  const match = syntheticValidMatch();
  const artifact = matchArtifactSchema.parse({
    schemaVersion: 'm2-artifact-1',
    match,
    analytics: computeMatchAnalytics(match),
  });
  return scoreMatch(artifact, SUCCESSOR_75_25_CONFIG);
}

async function writeReport(name: string, value: unknown): Promise<void> {
  await writeFile(
    path.join(dataRoot, 'reports', `${name}.json.gz`),
    gzipSync(Buffer.from(JSON.stringify(value))),
  );
}

async function expectCorrupt(name: string): Promise<void> {
  const response = await request(app.getHttpServer())
    .get(`/legacy-report/${name}`)
    .expect(409);
  expect(response.body.error).toEqual({
    code: 'REPORT_CORRUPT',
    message: expect.any(String),
  });
  expect(JSON.stringify(response.body)).not.toMatch(
    /ZodError|issues|node_modules|stack|schemaVersion.*expected/i,
  );
}

describe('legacy scoring report boundary', () => {
  it('returns a valid report without changing it', async () => {
    const report = validReport();
    await writeReport('valid', report);
    const response = await request(app.getHttpServer())
      .get('/legacy-report/valid')
      .expect(200);
    expect(response.body).toEqual(report);
  });

  it('maps invalid gzip and invalid JSON to REPORT_CORRUPT over HTTP', async () => {
    await writeFile(
      path.join(dataRoot, 'reports', 'gzip.json.gz'),
      Buffer.from('not-gzip'),
    );
    await writeFile(
      path.join(dataRoot, 'reports', 'json.json.gz'),
      gzipSync(Buffer.from('{')),
    );
    await expectCorrupt('gzip');
    await expectCorrupt('json');
  });

  it('maps shape and schema-version failures to REPORT_CORRUPT over HTTP', async () => {
    await writeReport('shape', { schemaVersion: 'm3-score-1', players: [] });
    await writeReport('version', {
      ...validReport(),
      schemaVersion: 'unsupported-score-version',
    });
    await expectCorrupt('shape');
    await expectCorrupt('version');
  });

  it('maps a missing legacy report to REPORT_CORRUPT over HTTP', async () => {
    await expectCorrupt('missing');
  });
});
