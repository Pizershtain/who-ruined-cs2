import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApiHttp } from '../src/http-hardening.js';
import { resolveApiRuntimeConfig } from '../src/runtime-config.js';
import { SafeExceptionFilter } from '../src/safe-exception.filter.js';

let app: NestExpressApplication;

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new SafeExceptionFilter());
  configureApiHttp(app, resolveApiRuntimeConfig({ MAX_JSON_BODY_BYTES: '128', MAX_QUERY_STRING_BYTES: '256' }));
  await app.init();
});

afterAll(async () => app.close());

describe('strict local HTTP boundary', () => {
  it('allows the documented local origin and withholds CORS from a hostile origin', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'http://localhost:5173').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await request(app.getHttpServer()).get('/api/v1/health').set('Origin', 'https://hostile.invalid').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const stateChange = await request(app.getHttpServer()).post('/api/v1/matches').set('Origin', 'https://hostile.invalid').expect(403);
    expect(stateChange.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it.each(['policy=H1','policy=H2','policy=','policy=H1&policy=H2','policy[]=H1','po%6Cicy=H1','POLICY=H1'])(
    'rejects forbidden participation selector %s',
    async (query) => {
      const response = await request(app.getHttpServer()).get(`/api/v1/matches/synthetic/experimental-participation-rating?${query}`).expect(422);
      expect(response.body.error.code).toBe('INVALID_POLICY_SELECTOR');
    }
  );

  it('rejects unknown, duplicate and malformed query values before data access', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/matches?unknown=x').expect(422)).body.error.code).toBe('INVALID_QUERY');
    expect((await request(app.getHttpServer()).get('/api/v1/matches?cursor=a&cursor=b').expect(422)).body.error.code).toBe('INVALID_QUERY');
    expect((await request(app.getHttpServer()).get('/api/v1/jobs/%2e%2e%5csecret').expect(404)).body.error.code).toBe('JOB_NOT_FOUND');
    expect((await request(app.getHttpServer()).get(`/api/v1/jobs/${'a'.repeat(161)}`).expect(404)).body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('bounds URL and JSON bodies and remains healthy afterwards', async () => {
    expect((await request(app.getHttpServer()).get(`/api/v1/health?x=${'a'.repeat(300)}`).expect(414)).body.error.code).toBe('REQUEST_URI_TOO_LONG');
    const oversized = await request(app.getHttpServer()).post('/api/v1/matches/synthetic/rescore').set('Content-Type', 'application/json').send({ scoringVersion: 'x', padding: 'a'.repeat(300) }).expect(413);
    expect(oversized.body.error.code).toBe('SIZE_LIMIT');
    const malformed = await request(app.getHttpServer()).post('/api/v1/matches/synthetic/rescore').set('Content-Type', 'application/json').send('{').expect(400);
    expect(malformed.body.error.code).toBe('INVALID_REQUEST');
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok', version: '0.1.0' });
  });

  it('emits opaque correlation and basic security headers without stack details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/jobs/invalid%00id').expect(404);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(JSON.stringify(response.body)).not.toMatch(/node_modules|[A-Z]:\\|stack/i);
  });
});

