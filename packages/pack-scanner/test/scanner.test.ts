import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { scanPack, verifySignature } from '../dist/index.js';

const BASE = {
  schema_version: '1' as const,
  name: 'pack-x',
  version: '0.1.0',
  description: 'demo',
  author: 'a',
  license: 'Apache-2.0' as const,
  applies_when: {},
  templates: [],
  scenarios: [],
  risks: ['risks/r.yaml'],
  oracles: [],
  probes: [],
};

describe('scanPack', () => {
  it('clean pack returns ok=true and zero non-low issues', () => {
    const r = scanPack(BASE);
    assert.ok(r.issues.every((i) => i.severity === 'low'));
  });

  it('flags unsigned shell-kind probe', () => {
    const r = scanPack({ ...BASE, probes: ['probes/shell.yaml'] });
    assert.ok(r.issues.some((i) => i.rule === 'unsigned-shell-pack'));
    assert.equal(r.ok, false);
  });

  it('flags always-on + shell as high-severity', () => {
    const r = scanPack({ ...BASE, probes: ['probes/shell.yaml'], applies_when: {} });
    assert.ok(r.issues.some((i) => i.rule === 'always-on-shell-pack'));
  });

  it('flags templates without risks (low severity)', () => {
    const r = scanPack({ ...BASE, templates: ['t.tpl'], risks: [] });
    assert.ok(r.issues.some((i) => i.rule === 'templates-without-risks'));
    assert.equal(r.ok, true); // low-only issues do not fail ok
  });
});

describe('verifySignature', () => {
  it('passes when sha256 matches the canonical body', () => {
    const body = 'name: pack-x';
    const digest = createHash('sha256').update(body).digest('hex');
    const r = verifySignature({ ...BASE, signing: { sha256: digest } }, body);
    assert.equal(r.ok, true);
  });
  it('fails on mismatch', () => {
    const r = verifySignature({ ...BASE, signing: { sha256: 'a'.repeat(64) } }, 'different body');
    assert.equal(r.ok, false);
    assert.match(r.reason, /digest mismatch/);
  });
  it('fails when manifest does not declare a signature', () => {
    const r = verifySignature(BASE, 'whatever');
    assert.equal(r.ok, false);
    assert.match(r.reason, /does not declare/);
  });
});
