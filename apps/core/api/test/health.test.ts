import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller.js';
import { MatchesController } from '../src/modules/matches/matches.controller.js';
import { ReplayController } from '../src/modules/replay/replay.controller.js';
import { ReportsController } from '../src/modules/reports/reports.controller.js';

describe('health contract', () => {
  it('returns the local API version', () => expect(new HealthController().health()).toEqual({ status: 'ok', version: '0.1.0' }));
  it('keeps the asynchronous upload contract at HTTP 202', () => {
    expect(Reflect.getMetadata('__httpCode__', MatchesController.prototype.upload)).toBe(202);
  });
  it('exposes match and per-player M2 analytics handlers without changing the upload route', () => {
    expect(typeof ReportsController.prototype.analytics).toBe('function');
    expect(typeof ReportsController.prototype.playerAnalytics).toBe('function');
  });
  it('exposes versioned report, player evidence, and asynchronous artifact-only rescore handlers', () => {
    expect(typeof ReportsController.prototype.report).toBe('function');
    expect(typeof ReportsController.prototype.playerReport).toBe('function');
    expect(typeof ReportsController.prototype.rescore).toBe('function');
    expect(typeof ReplayController.prototype.replay).toBe('function');
    expect(Reflect.getMetadata('__httpCode__', ReportsController.prototype.rescore)).toBe(202);
  });
});
