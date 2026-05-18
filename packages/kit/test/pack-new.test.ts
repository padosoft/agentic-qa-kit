/**
 * v1.7 — `aqa pack new <slug>` scaffolding command.
 *
 * TDD-style: this suite was written before `runPackNew` existed. It asserts
 * the scaffolded pack is real-world usable end-to-end: schema-valid manifest,
 * runnable scenario whose stub-probe oracle passes, and a layout that
 * `aqa run` picks up via filesystem discovery.
 */

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
import { runPackNew } from '../dist/commands/pack-new.js';
import { runRun } from '../dist/commands/run.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'aqa-pack-new-'));
}

describe('aqa pack new', () => {
  it('scaffolds a schema-valid pack at <cwd>/packs/<slug>/', async () => {
    const root = makeTempDir();
    const result = runPackNew({ root, slug: 'pack-myapp', sutType: 'api' });
    assert.equal(result.ok, true, `pack new must succeed, got: ${JSON.stringify(result)}`);
    assert.equal(result.packDir, join(root, 'packs', 'pack-myapp'));

    const manifestPath = join(root, 'packs', 'pack-myapp', 'pack.yaml');
    assert.ok(existsSync(manifestPath), 'pack.yaml must exist');
    const manifest = yamlParse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      schema_version: string;
      scenarios: string[];
      risks: string[];
      applies_when: { sut_type: string[] };
    };
    assert.equal(manifest.schema_version, '1');
    assert.equal(manifest.name, 'pack-myapp');
    assert.deepEqual(manifest.applies_when.sut_type, ['api']);
    assert.ok(manifest.scenarios.length >= 1, 'must scaffold at least one scenario');
    assert.ok(manifest.risks.length >= 1, 'must scaffold at least one risk');

    // Every file referenced from the manifest exists on disk.
    for (const rel of manifest.scenarios) {
      assert.ok(existsSync(join(root, 'packs', 'pack-myapp', rel)), `scenario ${rel} must exist`);
    }
    for (const rel of manifest.risks) {
      assert.ok(existsSync(join(root, 'packs', 'pack-myapp', rel)), `risk ${rel} must exist`);
    }
  });

  it('rejects an existing target without --force', async () => {
    const root = makeTempDir();
    const first = runPackNew({ root, slug: 'pack-dup', sutType: 'api' });
    assert.equal(first.ok, true);
    const second = runPackNew({ root, slug: 'pack-dup', sutType: 'api' });
    assert.equal(second.ok, false, 'second run must refuse to overwrite');
    assert.match(second.error ?? '', /already exists/i);
  });

  it('rejects a slug that does not match the Slug pattern', async () => {
    const root = makeTempDir();
    const result = runPackNew({ root, slug: 'Bad Name!', sutType: 'api' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /slug|name/i);
  });

  it('rejects a slug that would generate over-length scenario/risk IDs', () => {
    const root = makeTempDir();
    // The Slug schema caps at 64 chars inclusive. Derived IDs are
    // `inv-<slug>-starter` (overhead 12 chars), so a 52-char slug fits
    // exactly (64) and a 53-char slug pushes the derived ID to 65 — invalid.
    // runPackNew's MAX_SLUG_LEN guard rejects anything over 52 to keep both
    // the manifest *and* every derived id schema-valid.
    const longSlug = `a${'b'.repeat(52)}`; // 53 chars
    const result = runPackNew({ root, slug: longSlug, sutType: 'api' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /slug|chars|max/i);
  });

  it('refuses to scaffold over a symlinked pack directory (even with --force)', async (t) => {
    const root = makeTempDir();
    // Make the target path a symlink to a directory outside the project.
    const externalDir = makeTempDir();
    mkdirSync(join(root, 'packs'), { recursive: true });
    const link = join(root, 'packs', 'pack-evil');
    try {
      symlinkSync(externalDir, link, 'dir');
    } catch {
      t.skip('symlink creation not supported on this platform/permission level');
      return;
    }
    const result = runPackNew({ root, slug: 'pack-evil', sutType: 'api', force: true });
    assert.equal(result.ok, false, 'must refuse even with --force');
    assert.match(result.error ?? '', /symlink/i);
  });

  it('rejects an unsupported sut-type', async () => {
    const root = makeTempDir();
    const result = runPackNew({
      root,
      slug: 'pack-x',
      sutType: 'not-a-real-sut',
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /sut/i);
  });

  it('scaffolds different starter content per SUT type', async () => {
    const root = makeTempDir();
    const apiR = runPackNew({ root, slug: 'pack-a', sutType: 'api' });
    const webR = runPackNew({ root, slug: 'pack-w', sutType: 'web' });
    assert.equal(apiR.ok, true);
    assert.equal(webR.ok, true);
    const apiManifest = yamlParse(
      readFileSync(join(root, 'packs', 'pack-a', 'pack.yaml'), 'utf8'),
    ) as {
      applies_when: { sut_type: string[] };
    };
    const webManifest = yamlParse(
      readFileSync(join(root, 'packs', 'pack-w', 'pack.yaml'), 'utf8'),
    ) as {
      applies_when: { sut_type: string[] };
    };
    assert.deepEqual(apiManifest.applies_when.sut_type, ['api']);
    assert.deepEqual(webManifest.applies_when.sut_type, ['web']);
  });
});

describe('aqa pack new — integration with aqa run', () => {
  /**
   * The strongest sanity check: a freshly-scaffolded pack must actually run
   * end-to-end against the no-network probe stub. If the starter scenario's
   * oracle doesn't pass against the stub, every new pack would emit
   * synthetic findings out of the box, exactly the failure mode iter-17
   * surfaced for the bundled packs.
   */
  it('produces a pack whose starter scenario runs cleanly under aqa run', async () => {
    // Build a fixture project that aqa init would produce.
    const root = makeTempDir();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { hono: '^4.0.0' } }),
      'utf8',
    );
    writeFileSync(join(root, 'bun.lock'), '', 'utf8');
    // src/server.ts → api sut_type so the new pack's applies_when matches.
    const fs = await import('node:fs');
    fs.mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'server.ts'), 'export {};\n', 'utf8');

    const init = await import('../dist/commands/init.js');
    init.runInit({ root, projectName: 'demo' });

    // Scaffold a pack at <root>/packs/pack-demo/ (the discovery-friendly path).
    const pack = runPackNew({ root, slug: 'pack-demo', sutType: 'api' });
    assert.equal(pack.ok, true);

    // Wire the smoke profile to the new pack.
    const profilesPath = join(root, '.aqa', 'profiles.yaml');
    const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
      profiles: Record<string, { packs: string[]; tags: string[] }>;
    };
    if (profiles.profiles.smoke) {
      profiles.profiles.smoke.packs = ['pack-demo'];
      // Empty tags = match every scenario tag.
      profiles.profiles.smoke.tags = [];
    }
    writeFileSync(profilesPath, (await import('yaml')).stringify(profiles), 'utf8');

    if (!pack.packDir) throw new Error('pack.packDir must be set on success');
    // Intentionally NO `packsRoot` — this is the integration's whole point:
    // a freshly-scaffolded pack must be discoverable by `runRun`'s default
    // discovery (which scans `<root>/packs/*`) without any caller hint.
    const result = await runRun({ root, profile: 'smoke' });
    assert.equal(result.ok, true, `new pack must run cleanly, got: ${JSON.stringify(result)}`);
    assert.ok(result.scenariosRun >= 1, 'starter scenario must execute');
    assert.equal(result.findingsCount, 0, 'starter scenario must pass against the stub probe');
  });
});
