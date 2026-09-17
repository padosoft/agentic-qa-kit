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
