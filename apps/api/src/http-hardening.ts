import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { ApiRuntimeConfig } from './runtime-config.js';

function reject(response: Response, status: number, code: string, message: string): void {
  const requestId = response.locals.requestId as string;
  response.status(status).json({ error: { code, message }, requestId });
}

export function configureApiHttp(app: NestExpressApplication, config: ApiRuntimeConfig): void {
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('cache-control', 'no-store');
    if (Buffer.byteLength(request.originalUrl, 'utf8') > config.maxQueryStringBytes) {
      reject(response, 414, 'REQUEST_URI_TOO_LONG', 'Адрес запроса превышает допустимую длину.');
      return;
    }
    const origin = request.headers.origin;
    if (origin && !config.corsOrigins.has(origin) && !['GET','HEAD','OPTIONS'].includes(request.method)) {
      reject(response, 403, 'ORIGIN_NOT_ALLOWED', 'Источник браузерного запроса не разрешён.');
      return;
    }
    next();
  });
  app.useBodyParser('json', { limit: config.jsonBodyBytes, strict: true });
  app.useBodyParser('urlencoded', { limit: config.jsonBodyBytes, extended: false, parameterLimit: 32 });
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) { callback(null, !origin || config.corsOrigins.has(origin)); },
    methods: ['GET','POST','DELETE','OPTIONS'],
    allowedHeaders: ['content-type','accept'],
    credentials: false,
    maxAge: 600
  });
}

