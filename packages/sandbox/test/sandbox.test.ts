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

describe('ContainerSandbox', () => {
  it('fails closed when a command is not supplied', async () => {
    const sb = new ContainerSandbox({ budget: { max_calls: 5, per_call_timeout_ms: 1000 } });
    const r = await sb.invoke({ tool: 'shell', args: {} });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /non-empty.*command/);
  });

  it('builds a hardened container invocation and returns stdout', async () => {
    let seen: { runtime: string; args: string[]; timeout: number } | undefined;
    const sb = new ContainerSandbox({
      budget: { max_calls: 5, per_call_timeout_ms: 1000 },
      runtime: 'podman',
      image: 'registry.example/aqa@sha256:abc',
      executor: async (runtime, args, timeout) => {
        seen = { runtime, args, timeout };
        return { code: 0, stdout: 'ok\n', stderr: '' };
      },
    });
    const r = await sb.invoke({ tool: 'shell', args: { command: 'printf ok' } });
    assert.equal(r.ok, true);
    assert.equal(r.output, 'ok\n');
    assert.equal(seen?.runtime, 'podman');
    assert.ok(seen?.args.includes('--read-only'));
    assert.ok(seen?.args.includes('--network') && seen?.args.includes('none'));
    assert.ok(seen?.args.includes('--cap-drop') && seen?.args.includes('ALL'));
    assert.ok(seen?.args.includes('registry.example/aqa@sha256:abc'));
  });

  it('rejects mutable image tags when pinning is required', () => {
    assert.throws(
      () =>
        new ContainerSandbox({
          budget: { max_calls: 1, per_call_timeout_ms: 1000 },
          image: 'ubuntu:24.04',
          require_pinned_image: true,
        }),
      /pinned by immutable sha256 digest/,
    );
  });

  it('accepts a valid immutable image digest', () => {
    assert.doesNotThrow(
      () =>
        new ContainerSandbox({
          budget: { max_calls: 1, per_call_timeout_ms: 1000 },
          image: `registry.example/aqa@sha256:${'a'.repeat(64)}`,
          require_pinned_image: true,
        }),
    );
  });

  it('reports container failures and timeout results without throwing', async () => {
    const sb = new ContainerSandbox({
      budget: { max_calls: 5, per_call_timeout_ms: 25 },
      executor: async () => ({ code: 17, stdout: '', stderr: 'denied' }),
    });
    const failed = await sb.invoke({ tool: 'shell', args: { command: 'id' } });
    assert.equal(failed.ok, false);
    assert.match(failed.error ?? '', /code 17.*denied/);

    const timedOut = new ContainerSandbox({
      budget: { max_calls: 5, per_call_timeout_ms: 25 },
      executor: async () => ({ code: null, stdout: '', stderr: '', timed_out: true }),
    });
    const timeout = await timedOut.invoke({ tool: 'shell', args: { command: 'sleep 1' } });
    assert.equal(timeout.ok, false);
    assert.match(timeout.error ?? '', /timed out/);
  });

  it('fails closed when the executor reports an output limit breach', async () => {
    const sb = new ContainerSandbox({
      budget: { max_calls: 5, per_call_timeout_ms: 25 },
      max_output_bytes: 12,
      executor: async () => ({
        code: 0,
        stdout: 'truncated',
        stderr: '',
        output_limit_exceeded: true,
      }),
    });
    const result = await sb.invoke({ tool: 'shell', args: { command: 'printf huge' } });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /12 bytes/);
  });

  it(
    'executes a real OCI container when the integration runtime is enabled',
    { timeout: 120_000 },
    async () => {
      const runtime = process.env.AQA_TEST_CONTAINER_RUNTIME;
      if (!runtime) {
        assert.ok(true, 'real container contract requires AQA_TEST_CONTAINER_RUNTIME');
        return;
      }
      const sb = new ContainerSandbox({
        runtime,
        image: process.env.AQA_TEST_CONTAINER_IMAGE ?? 'ubuntu:24.04',
        budget: { max_calls: 2, per_call_timeout_ms: 30_000 },
      });
      const result = await sb.invoke({
        tool: 'shell',
        args: { command: 'id -u; test ! -w /; test -f /etc/os-release' },
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.match(String(result.output), /65532/);
    },
  );
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
