import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROUTES } from '../src/router.ts';

describe('admin router scaffold', () => {
  it('has at least 12 routes (the scaffolded set)', () => {
    assert.ok(ROUTES.length >= 12);
  });

  it('every route has a unique key', () => {
    const keys = ROUTES.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('every route has a unique path', () => {
    const paths = ROUTES.map((r) => r.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  it('every route has a non-empty label', () => {
    for (const r of ROUTES) assert.ok(r.label.length > 0, `route ${r.key} has empty label`);
  });
});
