import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ApiToken,
  CostSummary,
  Event,
  Finding,
  Notification,
  PackManifest,
  Profile,
  Project,
  RiskMap,
  Run,
  SCHEMA_VERSION,
  SavedView,
  Scenario,
  SsoConfig,
  Tenancy,
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
  // v1.4 admin surface
  notification: Notification.Notification,
  'saved-view': SavedView.SavedView,
  'api-token': ApiToken.ApiToken,
  'cost-summary': CostSummary.CostSummary,
  org: Tenancy.Org,
  'project-ref': Tenancy.ProjectRef,
  'sso-config': SsoConfig.SsoConfig,
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

// For each invalid fixture, declare the field path that MUST appear among
// the Zod issue paths. This prevents a fixture from silently passing the
// "rejects" test for the wrong reason after a schema regression.
const invalidExpectations: Record<string, string[]> = {
  'event--bad-hash.json': ['hash'],
  'finding--verified-no-determinism.json': ['reproducibility', 'bug_level'],
  'pack-manifest--bad-semver.json': ['version'],
  'profile--bad-execution-mode.json': ['execution_mode'],
  'project--missing-stack.json': ['stack'],
  'risk-map--empty-risks.json': ['risks'],
  'run--bad-state.json': ['state'],
  'scenario--no-oracles.json': ['oracles'],
};

describe('invalid fixtures', () => {
  const invalidDir = join(fixturesDir, 'invalid');
  const files = readdirSync(invalidDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const name = schemaKeyFromFile(file) as keyof typeof validators;
    it(`${file} rejects on ${name} at expected path`, () => {
      const data = JSON.parse(readFileSync(join(invalidDir, file), 'utf8'));
      const validator = validators[name];
      assert.ok(validator, `validator missing for ${name}`);
      const result = validator.safeParse(data);
      assert.equal(result.success, false);
      if (result.success) return;
      const expected = invalidExpectations[file];
      assert.ok(expected, `no error-path expectation declared for ${file}`);
      const expectedKey = expected.join('.');
      const actualPaths = result.error.issues.map((i) => i.path.join('.'));
      assert.ok(
        actualPaths.some((p) => p === expectedKey || p.startsWith(`${expectedKey}.`)),
        `expected error on path "${expectedKey}", got: ${JSON.stringify(actualPaths)}`,
      );
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
