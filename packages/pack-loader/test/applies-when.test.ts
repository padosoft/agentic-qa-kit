import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appliesWhen } from '../dist/applies-when.js';

function mf(applies_when: Record<string, unknown>) {
  return {
    schema_version: '1' as const,
    name: 'pack-test',
    version: '0.1.0',
    description: 'x',
    author: 'a',
    license: 'Apache-2.0',
    applies_when,
    templates: [],
    scenarios: [],
    risks: [],
    oracles: [],
    probes: [],
  };
}

describe('appliesWhen', () => {
  it('empty predicate matches anything', () => {
    assert.equal(appliesWhen(mf({}), {}), true);
    assert.equal(appliesWhen(mf({}), { runtime: 'bun' }), true);
  });

  it('runtime: must match if specified', () => {
    const m = mf({ runtime: ['bun', 'node'] });
    assert.equal(appliesWhen(m, { runtime: 'bun' }), true);
    assert.equal(appliesWhen(m, { runtime: 'deno' }), false);
    assert.equal(appliesWhen(m, {}), false);
  });

  it('framework: must match if specified', () => {
    const m = mf({ framework: ['next.js', 'remix'] });
    assert.equal(appliesWhen(m, { framework: 'next.js' }), true);
    assert.equal(appliesWhen(m, { framework: 'hono' }), false);
  });

  it('db: at least one of the listed dbs must be present', () => {
    const m = mf({ db: ['postgres', 'mysql'] });
    assert.equal(appliesWhen(m, { db: ['postgres', 'redis'] }), true);
    assert.equal(appliesWhen(m, { db: ['sqlite'] }), false);
    assert.equal(appliesWhen(m, { db: [] }), false);
  });

  it('sut_type: must match if specified', () => {
    const m = mf({ sut_type: ['api'] });
    assert.equal(appliesWhen(m, { sut_type: 'api' }), true);
    assert.equal(appliesWhen(m, { sut_type: 'web' }), false);
  });

  it('tags_any: at least one listed tag must be present', () => {
    const m = mf({ tags_any: ['release-gate', 'security'] });
    assert.equal(appliesWhen(m, { tags: ['release-gate'] }), true);
    assert.equal(appliesWhen(m, { tags: ['smoke'] }), false);
  });

  it('tags_all: every listed tag must be present', () => {
    const m = mf({ tags_all: ['ci', 'release'] });
    assert.equal(appliesWhen(m, { tags: ['ci', 'release', 'foo'] }), true);
    assert.equal(appliesWhen(m, { tags: ['ci'] }), false);
  });

  it('AND across clauses', () => {
    const m = mf({ sut_type: ['api'], framework: ['hono'] });
    assert.equal(appliesWhen(m, { sut_type: 'api', framework: 'hono' }), true);
    assert.equal(appliesWhen(m, { sut_type: 'api', framework: 'express' }), false);
  });
});
