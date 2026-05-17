import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContainerSandbox, ProcessSandbox, selectSandbox } from '../dist/index.js';

describe('ProcessSandbox', () => {
  it('invokes registered handlers and counts calls', async () => {
    const sb = new ProcessSandbox({
      handlers: { echo: async (c) => c.args },
      budget: { max_calls: 5, per_call_timeout_ms: 1000 },
    });
    const r = await sb.invoke({ tool: 'echo', args: { v: 1 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.output, { v: 1 });
    assert.equal(sb.callCount(), 1);
  });

  it('rejects calls past the max_calls budget', async () => {
    const sb = new ProcessSandbox({
      handlers: { echo: async () => 'x' },
      budget: { max_calls: 1, per_call_timeout_ms: 1000 },
    });
    await sb.invoke({ tool: 'echo', args: {} });
    const r = await sb.invoke({ tool: 'echo', args: {} });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /budget exhausted/);
  });

  it('rejects calls to unregistered tools with a clear error', async () => {
    const sb = new ProcessSandbox({
      handlers: {},
      budget: { max_calls: 5, per_call_timeout_ms: 1000 },
    });
    const r = await sb.invoke({ tool: 'no-such', args: {} });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /no handler registered/);
  });

  it('enforces per-call timeout', async () => {
    const sb = new ProcessSandbox({
      handlers: {
        slow: async () => new Promise((resolve) => setTimeout(() => resolve('done'), 200)),
      },
      budget: { max_calls: 5, per_call_timeout_ms: 50 },
    });
    const r = await sb.invoke({ tool: 'slow', args: {} });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /timeout/);
  });
});

describe('ContainerSandbox (v0.2 scaffold)', () => {
  it('explicitly refuses with a "not implemented" message', async () => {
    const sb = new ContainerSandbox({ budget: { max_calls: 5, per_call_timeout_ms: 1000 } });
    const r = await sb.invoke({ tool: 'x', args: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /scaffold/);
  });
});

describe('selectSandbox', () => {
  it('returns ProcessSandbox for smoke / exploratory', () => {
    const sb = selectSandbox({ profile: 'smoke', handlers: {} });
    assert.equal(sb.kind, 'process');
  });
  it('returns ContainerSandbox for security / release-gate', () => {
    assert.equal(selectSandbox({ profile: 'security', handlers: {} }).kind, 'container');
    assert.equal(selectSandbox({ profile: 'release-gate', handlers: {} }).kind, 'container');
  });
});
