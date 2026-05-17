import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { loadPack, loadPacks } from '../dist/loader.js';

function temp(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-pack-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

const MIN_VALID = `schema_version: "1"
name: pack-x
version: 0.1.0
description: "minimal"
author: tester
`;

describe('loadPack', () => {
  it('loads a valid pack.yaml', () => {
    const root = temp({ 'pack.yaml': MIN_VALID });
    const pack = loadPack(root);
    assert.equal(pack.manifest.name, 'pack-x');
    assert.equal(pack.manifest.version, '0.1.0');
    assert.equal(pack.root, root);
  });

  it('rejects an invalid pack.yaml with a descriptive error', () => {
    const root = temp({
      'pack.yaml': `schema_version: "1"\nname: BAD CASE\nversion: not-semver\ndescription: x\nauthor: a\n`,
    });
    assert.throws(() => loadPack(root), /invalid manifest/);
  });

  it('throws when no manifest is present', () => {
    const root = temp({ 'placeholder.txt': '' });
    assert.throws(() => loadPack(root), /no manifest/);
  });
});

describe('loadPacks', () => {
  it('loads every direct subdirectory that contains a manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-packs-'));
    for (const name of ['core', 'api-core', 'web-ui']) {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'pack.yaml'),
        MIN_VALID.replace('name: pack-x', `name: pack-${name}`),
        'utf8',
      );
    }
    // an empty dir that should be skipped
    mkdirSync(join(root, 'not-a-pack'), { recursive: true });

    const packs = loadPacks(root);
    const names = packs.map((p) => p.manifest.name).sort();
    assert.deepEqual(names, ['pack-api-core', 'pack-core', 'pack-web-ui']);
  });
});
