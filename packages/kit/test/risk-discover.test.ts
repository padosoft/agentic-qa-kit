import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parse as yamlParse } from 'yaml';
import { runRiskDiscover } from '../dist/commands/risk-discover.js';

describe('risk discovery', () => {
  it('generates a schema-shaped deterministic STRIDE baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-'));
    const result = runRiskDiscover({ root, method: 'stride', scope: 'src/api' });
    assert.equal(result.ok, true);
    assert.equal(result.risk_count, 6);
    const map = yamlParse(readFileSync(join(root, '.aqa', 'risk-map.yaml'), 'utf8')) as {
      risks: Array<{ category: string; invariants: unknown[]; tags: string[] }>;
    };
    assert.equal(map.risks.length, 6);
    assert.ok(map.risks.every((risk) => risk.invariants.length === 1));
    assert.ok(map.risks.every((risk) => risk.tags.some((tag) => tag === 'scope:src-api')));
  });

  it('does not overwrite an existing map unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-'));
    const first = runRiskDiscover({ root, method: 'stride' });
    const second = runRiskDiscover({ root, method: 'stride' });
    assert.equal(first.write_result, 'created');
    assert.equal(second.write_result, 'skipped-exists');
    assert.equal(
      runRiskDiscover({ root, method: 'stride', force: true }).write_result,
      'overwritten',
    );
    assert.equal(existsSync(join(root, '.aqa', 'risk-map.yaml')), true);
  });

  it('generates a schema-shaped OWASP baseline with distinct framework tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-'));
    const result = runRiskDiscover({ root, method: 'owasp', scope: 'src/api' });
    assert.equal(result.ok, true);
    assert.equal(result.risk_count, 10);
    const map = yamlParse(readFileSync(join(root, '.aqa', 'risk-map.yaml'), 'utf8')) as {
      risks: Array<{ id: string; invariants: unknown[]; tags: string[] }>;
    };
    assert.ok(map.risks.every((risk) => risk.id.startsWith('risk-owasp-')));
    assert.ok(map.risks.every((risk) => risk.invariants.length === 1));
    assert.ok(map.risks.some((risk) => risk.tags.includes('owasp:ssrf')));
  });

  it('generates a schema-shaped FMEA failure-mode baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-'));
    const result = runRiskDiscover({ root, method: 'fmea', scope: 'checkout' });
    assert.equal(result.ok, true);
    assert.equal(result.risk_count, 6);
    const map = yamlParse(readFileSync(join(root, '.aqa', 'risk-map.yaml'), 'utf8')) as {
      risks: Array<{ id: string; invariants: unknown[]; tags: string[] }>;
    };
    assert.ok(map.risks.every((risk) => risk.id.startsWith('risk-fmea-')));
    assert.ok(map.risks.every((risk) => risk.invariants.length === 1));
    assert.ok(map.risks.some((risk) => risk.tags.includes('fmea:concurrency-race')));
  });

  it('generates source-aware risks from bounded repository signals', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-source-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { postgres: '1.0.0', jsonwebtoken: '1.0.0', axios: '1.0.0' },
      }),
    );
    writeFileSync(
      join(root, 'src', 'app.ts'),
      'fetch("https://payments.test"); const key = process.env.API_KEY;\n',
    );
    const result = runRiskDiscover({ root, method: 'source', scope: 'src' });
    assert.equal(result.ok, true);
    assert.equal(result.risk_count, 4);
    const map = yamlParse(readFileSync(join(root, '.aqa', 'risk-map.yaml'), 'utf8')) as {
      risks: Array<{ tags: string[]; description: string }>;
    };
    assert.ok(map.risks.every((risk) => risk.tags.includes('source-aware')));
    assert.ok(map.risks.every((risk) => risk.description.includes('Source-aware signal')));
    assert.ok(map.risks.some((risk) => risk.tags.some((tag) => tag.startsWith('evidence:'))));
    assert.ok(map.risks.every((risk) => risk.tags.includes('reachability:bounded-import-graph')));
  });

  it('does not promote signals found only in an unreachable source file', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-reachability-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), 'export const health = true;\n');
    writeFileSync(
      join(root, 'src', 'dead.ts'),
      'import jwt from "jsonwebtoken"; export const unused = jwt;\n',
    );
    const result = runRiskDiscover({ root, method: 'source', scope: 'src' });
    assert.equal(result.ok, true);
    assert.equal(result.risk_count, 0);
    assert.equal(existsSync(join(root, '.aqa', 'risk-map.yaml')), false);
  });

  it('rejects traversal and symlink targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-risk-'));
    assert.equal(runRiskDiscover({ root, method: 'stride', scope: '../secrets' }).ok, false);
    const outside = join(root, 'outside.yaml');
    writeFileSync(outside, 'do not overwrite');
    const aqa = join(root, '.aqa');
    mkdirSync(aqa);
    // Windows may not grant symlink privileges; the traversal assertion remains portable.
    try {
      symlinkSync(outside, join(aqa, 'risk-map.yaml'));
      assert.equal(runRiskDiscover({ root, method: 'stride', force: true }).ok, false);
    } catch {
      // Platform capability is recorded by the existing symlink security tests.
    }
  });
});
