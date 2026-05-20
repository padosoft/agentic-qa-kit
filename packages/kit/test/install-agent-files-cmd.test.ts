/**
 * v1.9 — `aqa install-agent-files` CLI verb.
 *
 * Wraps `@aqa/adapters renderForTargets()` and writes the rendered files via
 * `writeFileSafe`. These tests assert the behaviour a junior expects from the
 * README quick-start:
 *  - `--targets` parsing (csv, dedup, unknown rejection, empty rejection)
 *  - default + override of the project name (Slug-conforming)
 *  - existing files preserved unless `--force`
 *  - `--dry-run` never touches disk
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runInstallAgentFiles } from '../dist/commands/install-agent-files.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'aqa-install-agent-files-'));
}

describe('aqa install-agent-files — happy path', () => {
  it('writes CLAUDE.md + at least one claude skill for --targets claude', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: 'claude' });
    assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    if (!result.ok) return;

    assert.deepEqual(result.targets, ['claude']);
    assert.ok(existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md must be written');
    const claudeFiles = result.files.filter((f) => f.target === 'claude');
    assert.ok(
      claudeFiles.some((f) => f.path.startsWith('.claude/skills/')),
      'at least one .claude/skills/ file expected',
    );
    for (const f of claudeFiles) {
      assert.equal(f.result, 'created', `${f.path} should be 'created' on a fresh dir`);
    }
  });

  it('writes files for every requested target when given --targets claude,codex,gemini,copilot', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({
      root,
      targets: 'claude,codex,gemini,copilot',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual([...result.targets].sort(), ['claude', 'codex', 'copilot', 'gemini']);
    assert.ok(existsSync(join(root, 'CLAUDE.md')));
    assert.ok(existsSync(join(root, 'AGENTS.md')));
    assert.ok(existsSync(join(root, 'GEMINI.md')));
    assert.ok(existsSync(join(root, '.github', 'copilot-instructions.md')));
  });

  it('accepts an array form of targets identical to the csv form', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: ['claude', 'codex'] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.targets, ['claude', 'codex']);
  });

  it('embeds the slugified project name in the instruction file (default = dir name)', () => {
    // Prefix has internal spaces but NO trailing space — Windows rejects
    // path components ending in a space, which would crash mkdtempSync before
    // the test even reached its assertions.
    const root = mkdtempSync(join(tmpdir(), 'My Junior Project-'));
    const result = runInstallAgentFiles({ root, targets: 'claude' });
    assert.equal(result.ok, true);
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    // Slugified: lowercase, '-' separators, no spaces. Just assert the file
    // contains a slug-looking token referring to "my-junior-project" prefix
    // (mkdtemp adds a trailing random suffix that the slugifier keeps).
    assert.match(claudeMd, /my-junior-project/, 'project name must be slugified into CLAUDE.md');
  });

  it('honors --project-name override over the directory-derived default', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({
      root,
      targets: 'claude',
      projectName: 'My Override',
    });
    assert.equal(result.ok, true);
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /my-override/, 'project-name override must be slugified into CLAUDE.md');
  });
});

describe('aqa install-agent-files — targets validation', () => {
  it('returns error when --targets is empty string', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: '' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /must list at least one target/);
  });

  it('returns error when --targets is an empty array', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: [] });
    assert.equal(result.ok, false);
  });

  it('rejects an unknown target and writes nothing', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: 'claude,mistral' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /unknown target "mistral"/);
    assert.ok(
      !existsSync(join(root, 'CLAUDE.md')),
      'no file should be written on validation error',
    );
    assert.ok(!existsSync(join(root, 'AGENTS.md')));
  });

  it('de-duplicates duplicate targets without erroring', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: 'claude,claude,codex' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.targets, ['claude', 'codex']);
  });

  it('normalizes target casing (CLAUDE → claude)', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: 'CLAUDE,Codex' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.targets, ['claude', 'codex']);
  });

  it('trims whitespace and drops empties in the array form (Copilot iter 1)', () => {
    // Regression: previously the array form was used as-is, so a token like
    // 'claude ' would be classified as an unknown target. Both CSV and array
    // inputs must produce identical normalized results.
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: ['claude ', '', '  codex'] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.targets, ['claude', 'codex']);
  });
});

describe('aqa install-agent-files — overwrite semantics', () => {
  it('skips existing files by default (skipped-exists)', () => {
    const root = makeTempDir();
    // First pass creates CLAUDE.md.
    const first = runInstallAgentFiles({ root, targets: 'claude' });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const originalContents = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    // Tamper to make sure overwrite=false really preserves user edits.
    writeFileSync(join(root, 'CLAUDE.md'), '# my custom edits\n', 'utf8');

    const second = runInstallAgentFiles({ root, targets: 'claude' });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const claudeMd = second.files.find((f) => f.path === 'CLAUDE.md');
    assert.equal(claudeMd?.result, 'skipped-exists');
    assert.equal(
      readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
      '# my custom edits\n',
      'user edits must be preserved without --force',
    );
    // Sanity: the rendered template differs from user edits — guards against
    // the writer accidentally overwriting them with a byte-identical payload.
    assert.notEqual(originalContents, '# my custom edits\n');
  });

  it('overwrites existing files when overwrite=true', () => {
    const root = makeTempDir();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# my custom edits\n', 'utf8');

    const result = runInstallAgentFiles({ root, targets: 'claude', overwrite: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const claudeMd = result.files.find((f) => f.path === 'CLAUDE.md');
    assert.equal(claudeMd?.result, 'overwritten');
    assert.notEqual(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), '# my custom edits\n');
  });

  it('dry-run never writes to disk', () => {
    const root = makeTempDir();
    const result = runInstallAgentFiles({ root, targets: 'claude,codex', dryRun: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const f of result.files) {
      assert.equal(f.result, 'dry-run');
    }
    assert.ok(!existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md must not exist after dry-run');
    assert.ok(!existsSync(join(root, 'AGENTS.md')), 'AGENTS.md must not exist after dry-run');
  });
});
