/**
 * @aqa/pack-author smoke — the heavy behaviour coverage stays in
 * `packages/kit/test/pack-new.test.ts`, which exercises `runPackNew`
 * end-to-end through the CLI re-export. This file just guards the
 * package contract: `runPackNew` is the default-export shape and
 * accepts the `PackNewOptions` interface as documented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runPackNew } from '../dist/index.js';

describe('@aqa/pack-author — package boundary', () => {
  it('runPackNew is callable and returns the documented shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-pack-author-'));
    const result = runPackNew({ root, slug: 'pack-demo', sutType: 'api' });
    assert.equal(result.ok, true);
    assert.ok(result.packDir, 'packDir must be set on success');
    assert.ok(
      result.files && result.files.length >= 4,
      'files must list at least the 4 scaffold artifacts',
    );
    const manifest = readFileSync(join(result.packDir as string, 'pack.yaml'), 'utf8');
    assert.match(manifest, /name: pack-demo/);
  });

  it('returns a structured error with `code` on slug validation failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-pack-author-'));
    const result = runPackNew({ root, slug: 'NOT_A_SLUG', sutType: 'api' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EINVAL');
    assert.match(result.error ?? '', /must be lowercase alphanumeric/);
  });
});
