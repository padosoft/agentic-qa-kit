import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
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
} from '../dist/index.js';

// Fixture filename convention:
//   valid/<schema>.json                       — e.g. scenario.json
//   valid/<schema>--<variant>.json            — e.g. profile--release-gate.json
//   invalid/<schema>--<reason>.json           — e.g. finding--verified-no-determinism.json
//
// The schema key is everything before the first "--" (or the full stem if no
// "--" is present), with ".json" stripped. This is unambiguous regardless of
// how many dashes or dots the description contains.
function schemaKeyFromFile(filename: string): string {
  const stem = filename.replace(/\.json$/, '');
  const idx = stem.indexOf('--');
  return idx === -1 ? stem : stem.slice(0, idx);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const validators = {
  project: Project.Project,
  profile: Profile.Profile,
  'profiles-file': Profile.ProfilesFile,
  'risk-map': RiskMap.RiskMap,
  scenario: Scenario.Scenario,
  finding: Finding.Finding,
  event: Event.Event,
  run: Run.Run,
  'pack-manifest': PackManifest.PackManifest,
} as const;

describe('schema version', () => {
  it('SCHEMA_VERSION is "1"', () => {
    assert.equal(SCHEMA_VERSION, '1');
  });
});

describe('valid fixtures', () => {
  const validDir = join(fixturesDir, 'valid');
  const files = readdirSync(validDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const name = schemaKeyFromFile(file) as keyof typeof validators;
    it(`${file} parses as ${name}`, () => {
      const data = JSON.parse(readFileSync(join(validDir, file), 'utf8'));
      const validator = validators[name];
      assert.ok(validator, `validator missing for ${name}`);
      const result = validator.safeParse(data);
      assert.ok(
        result.success,
        `expected ${file} to be valid, got: ${JSON.stringify(
          result.success ? null : result.error.issues,
          null,
          2,
        )}`,
      );
      const roundTrip = JSON.parse(JSON.stringify(result.data));
      const second = validator.safeParse(roundTrip);
      assert.equal(second.success, true);
    });
  }
});

describe('invalid fixtures', () => {
  const invalidDir = join(fixturesDir, 'invalid');
  const files = readdirSync(invalidDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const name = schemaKeyFromFile(file) as keyof typeof validators;
    it(`${file} rejects on ${name}`, () => {
      const data = JSON.parse(readFileSync(join(invalidDir, file), 'utf8'));
      const validator = validators[name];
      assert.ok(validator, `validator missing for ${name}`);
      const result = validator.safeParse(data);
      assert.equal(result.success, false);
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

  it('rejects status=verified without deterministic floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'verified',
      reproducibility: { bug_level: { deterministic: false, attempts: 3, successes: 0 } },
    });
    assert.equal(f.success, false);
  });

  it('accepts status=verified with deterministic floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'verified',
      reproducibility: { bug_level: { deterministic: true, attempts: 3, successes: 3 } },
    });
    assert.equal(f.success, true);
  });

  it('accepts status=draft regardless of floor', () => {
    const f = Finding.Finding.safeParse({
      ...baseValid,
      status: 'draft',
      reproducibility: {},
    });
    assert.equal(f.success, true);
  });
});
