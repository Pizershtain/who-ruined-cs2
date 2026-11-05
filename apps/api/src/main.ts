import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { prisma } from '@who-ruined/database';
import { AppModule } from './app.module.js';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import { dataDir } from './storage.js';
import { resolveApiRuntimeConfig } from './runtime-config.js';
import { configureApiHttp } from './http-hardening.js';

const runtime = resolveApiRuntimeConfig();
await Promise.all(['uploads','cache','reports','results'].map((name) => mkdir(new URL(name + '/', dataDir), { recursive: true })));
try {
  await prisma.$connect();
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  console.error(JSON.stringify({
    level: 'error',
    event: 'databaseUnavailable',
    database: 'postgresql',
    code,
    message: 'Unable to connect to the configured PostgreSQL database',
  }));
  throw new Error('DATABASE_UNAVAILABLE');
}
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.enableShutdownHooks();
app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new SafeExceptionFilter());
configureApiHttp(app, runtime);
const config = new DocumentBuilder().setTitle('Who Ruined CS2 local API').setVersion('0.2.0').build();
SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
const server = await app.listen(runtime.port, runtime.bindHost);
server.requestTimeout = runtime.requestTimeoutMs;
server.headersTimeout = runtime.headersTimeoutMs;
server.keepAliveTimeout = runtime.keepAliveTimeoutMs;
server.maxHeadersCount = 100;
