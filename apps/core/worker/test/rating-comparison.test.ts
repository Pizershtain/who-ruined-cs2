import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NORMALIZER_VERSION, PARSER_LIBRARY_VERSION } from '@who-ruined/parser-adapter';
import { compareBinding, readBaseline, researchBaselinePolicyDigest } from '../src/rating-comparison/cli.js';

const evaluated = {
  relativePath: 'synthetic.dem', sha256: 'a'.repeat(64), status: 'EVALUATED' as const,
  digest: 'b'.repeat(64), reason: null,
};
const unsupported = {
  relativePath: 'synthetic-incomplete.dem', sha256: 'c'.repeat(64), status: 'UNSUPPORTED' as const,
  digest: null, reason: 'UNSUPPORTED_5V5_ROSTER',
};

describe('H2/H3 comparison binding (synthetic)', () => {
  it('reads the frozen baseline and requires exact demo, eligibility and result bindings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wrc-rating-comparison-'));
    try {
      const file = join(directory, 'baseline.json');
      const baseline = {
        schemaVersion: 'h3-real-demo-evaluation@1', policyDigest: researchBaselinePolicyDigest,
        parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION,
        manifest: [evaluated, unsupported],
      };
      await writeFile(file, JSON.stringify(baseline));
      const parsed = await readBaseline(file);
      expect(parsed.size).toBe(2);
      expect(() => compareBinding(evaluated, parsed.get(evaluated.relativePath)!)).not.toThrow();
      expect(() => compareBinding(unsupported, parsed.get(unsupported.relativePath)!)).not.toThrow();
      expect(() => compareBinding({ ...evaluated, sha256: unsupported.sha256 }, evaluated)).toThrow('demo binding mismatch');
      expect(() => compareBinding({ ...evaluated, digest: 'd'.repeat(64) }, evaluated)).toThrow('result digest or applicability mismatch');
      expect(() => compareBinding({ ...unsupported, reason: 'INSUFFICIENT_VERIFIED_ROUNDS_OR_ELIGIBILITY' }, unsupported)).toThrow('result digest or applicability mismatch');

      await writeFile(file, JSON.stringify({ ...baseline, policyDigest: 'e'.repeat(64) }));
      await expect(readBaseline(file)).rejects.toThrow('version or policy binding mismatch');
      await writeFile(file, JSON.stringify({ ...baseline, manifest: [evaluated, evaluated] }));
      await expect(readBaseline(file)).rejects.toThrow('Invalid H3 baseline manifest row');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
