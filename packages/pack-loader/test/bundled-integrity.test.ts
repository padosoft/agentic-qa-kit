import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RiskMap, Scenario } from '@aqa/schemas';
import { parse } from 'yaml';
import { loadPacks } from '../dist/loader.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('bundled pack resource integrity', () => {
  it('parses every referenced scenario and risk map before packaging', () => {
    const packsRoot = join(repoRoot, 'packs');
    assert.ok(existsSync(packsRoot), 'repository packs directory must exist');
    for (const pack of loadPacks(packsRoot)) {
      for (const relative of pack.manifest.scenarios) {
        const path = join(pack.root, relative);
        assert.ok(
          existsSync(path),
          `${pack.manifest.name} references missing scenario ${relative}`,
        );
        assert.doesNotThrow(
          () => Scenario.Scenario.parse(parse(readFileSync(path, 'utf8'))),
          `${pack.manifest.name} has an invalid scenario ${relative}`,
        );
      }
      for (const relative of pack.manifest.risks) {
        const path = join(pack.root, relative);
        assert.ok(
          existsSync(path),
          `${pack.manifest.name} references missing risk map ${relative}`,
        );
        assert.doesNotThrow(
          () => RiskMap.RiskMap.parse(parse(readFileSync(path, 'utf8'))),
          `${pack.manifest.name} has an invalid risk map ${relative}`,
        );
      }
      for (const directory of ['scenarios', 'risks']) {
        const root = join(pack.root, directory);
        if (!existsSync(root)) continue;
        assert.ok(
          readdirSync(root).length > 0,
          `${pack.manifest.name}/${directory} must not be empty`,
        );
      }
    }
  });
});
