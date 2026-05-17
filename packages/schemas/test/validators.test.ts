import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  Event,
  Finding,
  PackManifest,
  Profile,
  Project,
  RiskMap,
  Run,
  SCHEMA_VERSION,
  Scenario,
} from '../src/index.js';

const fixturesDir = join(import.meta.dir, '..', 'fixtures');

const validators = {
  project: Project.Project,
  profile: Profile.Profile,
  'risk-map': RiskMap.RiskMap,
  scenario: Scenario.Scenario,
  finding: Finding.Finding,
  event: Event.Event,
  run: Run.Run,
  'pack-manifest': PackManifest.PackManifest,
} as const;

describe('schema version', () => {
  test('SCHEMA_VERSION is "1"', () => {
    expect(SCHEMA_VERSION).toBe('1');
  });
});

describe('valid fixtures', () => {
  const validDir = join(fixturesDir, 'valid');
  const files = readdirSync(validDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const name = file.replace(/\.json$/, '') as keyof typeof validators;
    test(`${file} parses as ${name}`, () => {
      const data = JSON.parse(readFileSync(join(validDir, file), 'utf8'));
      const validator = validators[name];
      expect(validator).toBeDefined();
      const result = validator.safeParse(data);
      if (!result.success) {
        throw new Error(
          `expected ${file} to be valid, got: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
      const roundTrip = JSON.parse(JSON.stringify(result.data));
      const second = validator.safeParse(roundTrip);
      expect(second.success).toBe(true);
    });
  }
});

describe('invalid fixtures', () => {
  const invalidDir = join(fixturesDir, 'invalid');
  const files = readdirSync(invalidDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const name = file.replace(/^[^.]+\./, '').replace(/\.json$/, '') as keyof typeof validators;
    test(`${file} rejects on ${name}`, () => {
      const data = JSON.parse(readFileSync(join(invalidDir, file), 'utf8'));
      const validator = validators[name];
      expect(validator).toBeDefined();
      const result = validator.safeParse(data);
      expect(result.success).toBe(false);
    });
  }
});

describe('Finding.status=verified gating', () => {
  const baseValid = {
    schema_version: '1' as const,
    id: 'AQA-2026-0001',
    run_id: 'run-1',
    scenario_id: 's-1',
    risk_id: 'r-1',
    title: 'sample',
    summary: 'sample summary text',
    severity: 'high' as const,
    execution_mode: 'orchestrator' as const,
    discovered_at: '2026-05-17T10:00:00Z',
    confidence: 0.9,
    verification_floor: 'bug_level' as const,
  };

  test('rejects status=verified without deterministic floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'verified',
      reproducibility: { bug_level: { deterministic: false, attempts: 3, successes: 0 } },
    });
    expect(f.success).toBe(false);
  });

  test('accepts status=verified with deterministic floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'verified',
      reproducibility: { bug_level: { deterministic: true, attempts: 3, successes: 3 } },
    });
    expect(f.success).toBe(true);
  });

  test('accepts status=draft regardless of floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'draft',
      reproducibility: {},
    });
    expect(f.success).toBe(true);
  });
});
