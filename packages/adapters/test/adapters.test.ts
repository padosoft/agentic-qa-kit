import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type RenderContext,
  adapterByTarget,
  adapters,
  claudeAdapter,
  codexAdapter,
  copilotAdapter,
  geminiAdapter,
  renderForTargets,
} from '../dist/index.js';

const ctx: RenderContext = { projectName: 'demo', root: '/tmp/demo' };

describe('adapter registry', () => {
  it('contains all four targets', () => {
    const targets = adapters.map((a) => a.target).sort();
    assert.deepEqual(targets, ['claude', 'codex', 'copilot', 'gemini']);
  });

  it('adapterByTarget returns the right adapter', () => {
    assert.equal(adapterByTarget('claude'), claudeAdapter);
    assert.equal(adapterByTarget('codex'), codexAdapter);
    assert.equal(adapterByTarget('gemini'), geminiAdapter);
    assert.equal(adapterByTarget('copilot'), copilotAdapter);
  });

  // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard for invalid input
  it('adapterByTarget throws for unknown', () => {
    assert.throws(() => adapterByTarget('mistral' as any), /unknown target/);
  });
});

describe('per-adapter render', () => {
  it('claude renders CLAUDE.md + at least one skill', () => {
    const files = claudeAdapter.render(ctx);
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('CLAUDE.md'));
    assert.ok(paths.some((p) => p.startsWith('.claude/skills/')));
    const instr = files.find((f) => f.path === 'CLAUDE.md');
    assert.match(instr?.contents ?? '', /Claude/);
    assert.match(instr?.contents ?? '', /demo/);
  });

  it('codex renders AGENTS.md + skill under .agents/', () => {
    const files = codexAdapter.render(ctx);
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('AGENTS.md'));
    assert.ok(paths.some((p) => p.startsWith('.agents/skills/')));
  });

  it('gemini renders GEMINI.md + skill under .gemini/', () => {
    const files = geminiAdapter.render(ctx);
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('GEMINI.md'));
    assert.ok(paths.some((p) => p.startsWith('.gemini/skills/')));
  });

  it('copilot renders .github/copilot-instructions.md', () => {
    const files = copilotAdapter.render(ctx);
    const paths = files.map((f) => f.path).sort();
    assert.ok(paths.includes('.github/copilot-instructions.md'));
    assert.ok(paths.some((p) => p.startsWith('.github/skills/')));
  });

  it('renders are deterministic for the same context', () => {
    const a = claudeAdapter.render(ctx);
    const b = claudeAdapter.render(ctx);
    assert.deepEqual(a, b);
  });
});

describe('renderForTargets', () => {
  it('aggregates files across multiple targets', () => {
    const r = renderForTargets(['claude', 'codex'], ctx);
    assert.equal(Object.keys(r.byTarget).length, 2);
    assert.ok(r.all.length >= 4);
    // both should include their canonical instruction file
    const allPaths = r.all.map((f) => f.path).sort();
    assert.ok(allPaths.includes('CLAUDE.md'));
    assert.ok(allPaths.includes('AGENTS.md'));
  });

  it('every adapter declares a non-empty capabilities object', () => {
    for (const a of adapters) {
      assert.equal(typeof a.capabilities.skills, 'boolean');
      assert.equal(typeof a.capabilities.subagents, 'boolean');
      assert.equal(typeof a.capabilities.hooks, 'boolean');
      assert.ok(a.capabilities.instruction_file.length > 0);
    }
  });
});
