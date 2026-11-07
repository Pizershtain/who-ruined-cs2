import { describe, expect, it } from 'vitest';
import { assertPostgresTestDatabaseUrl } from './postgres-test-database.js';

describe('PostgreSQL integration target guard', () => {
  it('accepts only a local database whose name contains a test segment', () => {
    expect(() => assertPostgresTestDatabaseUrl(
      'postgresql://tester:secret@127.0.0.1:54329/wrc_test?schema=public',
    )).not.toThrow();
    expect(() => assertPostgresTestDatabaseUrl(
      'postgresql://owner:secret@db.example.com/who_ruined_cs2',
    )).toThrow('TEST_DATABASE_URL_MUST_TARGET_LOCAL_TEST_DATABASE');
    expect(() => assertPostgresTestDatabaseUrl(
      'postgresql://owner:secret@localhost/who_ruined_cs2',
    )).toThrow('TEST_DATABASE_URL_MUST_TARGET_LOCAL_TEST_DATABASE');
    expect(() => assertPostgresTestDatabaseUrl('not a URL'))
      .toThrow('TEST_DATABASE_URL_INVALID');
  });
});
