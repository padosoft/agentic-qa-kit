import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { runVerify } from '../dist/commands/verify.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('aqa verify', () => {
  it('replays a persisted finding and writes deterministic evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-verify-'));
    roots.push(root);
    const pack = join(root, 'packs', 'local');
    const runDir = join(root, '.aqa', 'runs', 'run-verify-1');
    mkdirSync(join(pack, 'scenarios'), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(pack, 'pack.yaml'),
      `schema_version: "1"\nname: pack-local-verify\nversion: 0.1.0\ndescription: verify fixture\nauthor: test\nlicense: MIT\napplies_when: {}\ntemplates: []\nscenarios:\n  - scenarios/verify.yaml\nrisks: []\noracles: []\nprobes: []\n`,
    );
    writeFileSync(
      join(pack, 'scenarios', 'verify.yaml'),
      `schema_version: "1"\nid: scn-verify\ntitle: Verify scenario\nrisk_refs: [r-verify]\ninvariant_refs: []\npreconditions: []\nsteps:\n  - id: probe\n    kind: http\n    with: { url: /healthz }\noracles:\n  - id: status\n    kind: http_status\n    with: { expected: 200 }\ncleanup: []\ntags: []\n`,
    );
    writeFileSync(
      join(runDir, 'findings.jsonl'),
      `${JSON.stringify({
        schema_version: '1',
        id: 'AQA-2026-12345678901234567890',
        run_id: 'run-verify-1',
        scenario_id: 'scn-verify',
        risk_id: 'r-verify',
        title: 'Verification finding',
        summary: 'A persisted finding used for replay verification.',
        severity: 'high',
        status: 'draft',
        execution_mode: 'orchestrator',
        discovered_at: '2026-09-17T12:00:00.000Z',
        confidence: 1,
        confidence_components: {},
        reproducibility: {},
        verification_floor: 'scenario_level',
        evidence: [],
        tags: [],
      })}\n`,
    );
    const result = await runVerify({
      root,
      findingId: 'AQA-2026-12345678901234567890',
      attempts: 2,
      probeRunner: async (probe) => ({ probe_id: probe.id, status: 500 }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.deterministic, true);
    assert.equal(result.successes, 2);
    assert.ok(result.verificationPath);
    assert.equal(existsSync(join(root, result.verificationPath ?? '')), true);
  });

  it('refuses verification without a real or injected probe runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-verify-empty-'));
    roots.push(root);
    const result = await runVerify({ root, findingId: 'missing' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /finding not found/i);
  });
});
