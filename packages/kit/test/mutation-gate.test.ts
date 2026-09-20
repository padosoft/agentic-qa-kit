import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  runMutationCoverageGate,
  runMutationGate,
  runMutationRegressionGate,
} from '../dist/commands/mutation-gate.js';

function report(statuses: string[]): string {
  return JSON.stringify({
    mutants: statuses.map((status, index) => ({
      id: `m-${index}`,
      file: 'src/cart.ts',
      operator: 'ConditionalExpression',
      status,
    })),
  });
}

test('mutation gate accepts an external report above the minimum', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Killed', 'Survived']));
  const result = runMutationGate({ root, inputFile: 'mutation.json', minScore: 0.5 });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, true);
  assert.equal(result.report?.totals.killed, 1);
  assert.equal(result.threshold?.evaluated_mutants, 2);
});

test('mutation gate returns a non-passing result below the minimum', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Survived', 'NoCoverage']));
  const result = runMutationGate({ root, inputFile: 'mutation.json', minScore: 0.5 });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, false);
});

test('mutation gate fails closed for malformed evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), '{not-json');
  const result = runMutationGate({ root, inputFile: 'mutation.json', minScore: 0.5 });
  assert.equal(result.ok, false);
  assert.equal(result.gate_ok, false);
});

test('mutation coverage gate binds mutants to regression scenarios', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Killed', 'Survived']));
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      schema_version: '1',
      links: [
        { mutation_id: 'm-0', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
        { mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
      ],
    }),
  );
  const result = runMutationCoverageGate({
    root,
    inputFile: 'mutation.json',
    manifestFile: 'manifest.json',
    minMappedRate: 1,
    minKilledRate: 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, true);
});

test('mutation regression gate requires observed scenario outcomes', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Killed', 'Survived']));
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      schema_version: '1',
      links: [
        { mutation_id: 'm-0', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
        { mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
      ],
    }),
  );
  writeFileSync(
    join(root, 'evidence.json'),
    JSON.stringify({
      schema_version: '1',
      source_revision: 'abc123',
      observations: [
        { mutation_id: 'm-0', scenario_id: 'scenario-cart', run_id: 'run-0', outcome: 'killed' },
        { mutation_id: 'm-1', scenario_id: 'scenario-cart', run_id: 'run-1', outcome: 'survived' },
      ],
    }),
  );
  const result = runMutationRegressionGate({
    root,
    inputFile: 'mutation.json',
    manifestFile: 'manifest.json',
    evidenceFile: 'evidence.json',
    minKillRate: 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.gate_ok, true);
  assert.equal(result.regression?.observed_pairs, 2);
});

test('mutation regression gate rejects evidence from another source revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Killed', 'Survived']));
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      schema_version: '1',
      links: [
        { mutation_id: 'm-0', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
        { mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
      ],
    }),
  );
  writeFileSync(
    join(root, 'evidence.json'),
    JSON.stringify({
      schema_version: '1',
      source_revision: 'old-sha',
      observations: [
        { mutation_id: 'm-0', scenario_id: 'scenario-cart', run_id: 'run-0', outcome: 'killed' },
        { mutation_id: 'm-1', scenario_id: 'scenario-cart', run_id: 'run-1', outcome: 'survived' },
      ],
    }),
  );
  const result = runMutationRegressionGate({
    root,
    inputFile: 'mutation.json',
    manifestFile: 'manifest.json',
    evidenceFile: 'evidence.json',
    minKillRate: 0.5,
    expectedSourceRevision: 'new-sha',
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /source revision/);
});

test('mutation regression gate requires and validates a holdout plan for plan-bound evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'aqa-mutation-'));
  writeFileSync(join(root, 'mutation.json'), report(['Killed', 'Survived']));
  const manifest = {
    schema_version: '1',
    links: [
      { mutation_id: 'm-0', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
      { mutation_id: 'm-1', risk_ids: ['risk-cart'], scenario_ids: ['scenario-cart'] },
    ],
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(
    join(root, 'evidence.json'),
    JSON.stringify({
      schema_version: '1',
      source_revision: 'abc123',
      plan_digest: 'a'.repeat(64),
      observations: [
        { mutation_id: 'm-0', scenario_id: 'scenario-cart', run_id: 'run-0', outcome: 'killed' },
      ],
    }),
  );
  const missing = runMutationRegressionGate({
    root,
    inputFile: 'mutation.json',
    manifestFile: 'manifest.json',
    evidenceFile: 'evidence.json',
    minKillRate: 0.5,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? '', /holdout-split/);
});
