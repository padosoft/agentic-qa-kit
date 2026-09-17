import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRiskCoverage } from '../dist/commands/risk-coverage.js';

function fixtureRoot(): string {
  const root = mkdtempSync(join(process.env.TEMP ?? '/tmp', 'aqa-coverage-'));
  mkdirSync(join(root, '.aqa', 'runs', 'run-1'), { recursive: true });
  mkdirSync(join(root, 'packs', 'checkout', 'scenarios'), { recursive: true });
  writeFileSync(
    join(root, '.aqa', 'risk-map.yaml'),
    `schema_version: "1"\nproject: demo\nrisks:\n  - id: risk-checkout\n    category: business_logic\n    title: Checkout total integrity\n    severity: high\n    likelihood: possible\n    invariants:\n      - id: inv-total\n        statement: Checkout total equals the authorized amount.\n    owners: []\n    tags: []\n`,
  );
  writeFileSync(
    join(root, 'packs', 'checkout', 'pack.yaml'),
    'schema_version: "1"\nname: pack-checkout\nversion: 1.0.0\ndescription: Checkout coverage fixture\nauthor: test\nlicense: Apache-2.0\nscenarios: [scenarios/checkout.yaml]\n',
  );
  writeFileSync(
    join(root, 'packs', 'checkout', 'scenarios', 'checkout.yaml'),
    `schema_version: "1"\nid: scn-checkout\ntitle: Checkout total is protected\nrisk_refs: [risk-checkout]\ninvariant_refs: [inv-total]\nsteps:\n  - id: probe\n    kind: http\n    with: { url: /checkout }\n    timeout_ms: 1000\noracles:\n  - id: status\n    kind: http_status\n    with: { expected: 200 }\n    weight: 1\ncleanup: []\ntags: []\n`,
  );
  const event = {
    schema_version: '1',
    seq: 0,
    prev_hash: null,
    hash: '0'.repeat(64),
    ts: '2026-09-17T10:00:00.000Z',
    run_id: 'run-1',
    kind: 'scenario_finished',
    actor: { type: 'orchestrator', id: 'test' },
    scenario_id: 'scn-checkout',
    payload: { outcome: 'pass', deterministic_replay: true },
  };
  writeFileSync(join(root, '.aqa', 'runs', 'run-1', 'events.jsonl'), `${JSON.stringify(event)}\n`);
  return root;
}

describe('risk coverage command', () => {
  it('measures persisted scenario evidence and reports covered risks', () => {
    const root = fixtureRoot();
    const result = runRiskCoverage({
      root,
      packsRoot: [join(root, 'packs', 'checkout')],
      now: new Date('2026-09-17T12:00:00.000Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.gate_ok, true);
    assert.equal(result.reports[0]?.status, 'covered');
  });

  it('reports stale coverage when no run evidence exists', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, '.aqa', 'runs', 'run-1', 'events.jsonl'), '');
    const result = runRiskCoverage({
      root,
      packsRoot: [join(root, 'packs', 'checkout')],
      now: new Date('2026-09-17T12:00:00.000Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.gate_ok, false);
    assert.equal(result.reports[0]?.status, 'stale');
  });
});
