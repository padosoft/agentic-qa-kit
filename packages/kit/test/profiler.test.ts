import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { profileRepo } from '../dist/profiler.js';

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-profiler-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

describe('profileRepo', () => {
  it('detects Bun runtime + Hono + Postgres from fixture', () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({
        name: 'demo-bun-hono',
        dependencies: { hono: '^4.0.0', pg: '^8.11.0' },
      }),
      'bunfig.toml': '',
      'bun.lock': '',
    });
    const p = profileRepo(root);
    assert.equal(p.runtime, 'bun');
    assert.equal(p.package_manager, 'bun');
    assert.equal(p.framework, 'hono');
    assert.deepEqual(p.db, ['postgres']);
  });

  it('detects Node + Next.js + Prisma', () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({
        name: 'demo-next-prisma',
        dependencies: { next: '15.0.0', '@prisma/client': '5.0.0' },
      }),
      'package-lock.json': '{}',
      'next.config.js': 'module.exports = {};',
    });
    const p = profileRepo(root);
    assert.equal(p.runtime, 'node');
    assert.equal(p.package_manager, 'npm');
    assert.equal(p.framework, 'next.js');
    assert.ok(p.db.includes('prisma'));
    assert.equal(p.sut_type, 'web');
  });

  it('detects LLM SDKs', () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({
        name: 'demo-llm',
        dependencies: { '@anthropic-ai/sdk': '^0.30.0', openai: '^4.0.0' },
      }),
    });
    const p = profileRepo(root);
    assert.ok(p.llm.includes('anthropic'));
    assert.ok(p.llm.includes('openai'));
  });

  it('marks CLI when package.json has bin', () => {
    const root = makeTempProject({
      'package.json': JSON.stringify({ name: 'mycli', bin: { mycli: './bin/mycli.js' } }),
    });
    const p = profileRepo(root);
    assert.equal(p.sut_type, 'cli');
  });

  it('returns has_aqa=false on a fresh repo', () => {
    const root = makeTempProject({ 'package.json': '{}' });
    const p = profileRepo(root);
    assert.equal(p.has_aqa, false);
  });
});
