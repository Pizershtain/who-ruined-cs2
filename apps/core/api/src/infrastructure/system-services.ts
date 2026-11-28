import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ApiSettingsPort,
  AuditLogPort,
  ClockPort,
  IdGeneratorPort,
} from '../application/ports.js';
import { resolveApiRuntimeConfig } from '../runtime-config.js';

@Injectable()
export class RuntimeApiSettings implements ApiSettingsPort {
  maxQueuedJobs(): number {
    return resolveApiRuntimeConfig().maxQueuedJobs;
  }

  participationRatingEnabled(): boolean {
    return (process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING ?? '1') === '1';
  }

}

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }

  nowMilliseconds(): number {
    return Date.now();
  }
}

@Injectable()
export class CryptoIdGenerator implements IdGeneratorPort {
  create(): string {
    return randomUUID();
  }
}

@Injectable()
export class ConsoleAuditLog implements AuditLogPort {
  uploadIngested(bytes: number, durationMs: number, duplicate: boolean): void {
    console.info(JSON.stringify({ level: 'info', event: 'upload_ingested', bytes, durationMs, duplicate }));
  }
}
