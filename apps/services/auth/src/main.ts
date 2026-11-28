import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { PrismaClient } from '../generated/client/index.js';
import { AuthController, AuthExceptions, authHttpConfig } from './http.js';
import { loadSigningKeys, readAuthConfig } from './runtime.js';
import { AuthService } from './service.js';

const runtime = readAuthConfig(process.env);
const db = new PrismaClient();
const auth = await AuthService.create(db, runtime, await loadSigningKeys(runtime.keyFile));
let pruning: Promise<void> | undefined;
const clock = setInterval(() => {
  pruning ??= auth.prune().catch(() => { console.warn('AUTH_PRUNE_RETRY'); }).finally(() => { pruning = undefined; });
}, 10_000);
clock.unref();

class Shutdown implements OnApplicationShutdown {
  async onApplicationShutdown() {
    clearInterval(clock);
    await pruning;
    await db.$disconnect();
  }
}

@Module({
  controllers: [AuthController],
  providers: [Shutdown, { provide: authHttpConfig, useValue: runtime },
    { provide: PrismaClient, useValue: db }, { provide: AuthService, useValue: auth }],
})
class AuthModule {}

try {
  await db.$connect();
  const app = await NestFactory.create<NestExpressApplication>(AuthModule, { bodyParser: false, logger: ['warn'] });
  app.setGlobalPrefix('api/v1');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const forwardedId = runtime.trustGateway ? req.get('X-Request-ID') : undefined;
    res.setHeader('X-Request-ID', forwardedId && /^[0-9a-f]{32}$/u.test(forwardedId) ? forwardedId : randomUUID());
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new AuthExceptions());
  app.useBodyParser('json', { limit: 4096, strict: true, inflate: false });
  app.enableShutdownHooks();
  const server = await app.listen(runtime.port, runtime.bindHost);
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.timeout = 12_000;
} catch {
  clearInterval(clock);
  await db.$disconnect();
  console.error('AUTH_STARTUP_FAILED');
  process.exitCode = 1;
}
