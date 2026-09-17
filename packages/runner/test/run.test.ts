import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventChainWriter } from '../dist/events.js';
import { FindingsWriter } from '../dist/findings.js';
import { makePlaywrightProbeRunner } from '../dist/playwright.js';
import { makePostgresSqlProbeRunner } from '../dist/postgres.js';
import { makeHttpProbeRunner, runScenario } from '../dist/run.js';
import { makeShellProbeRunner } from '../dist/shell.js';
import { makeSqlProbeRunner } from '../dist/sql.js';

const SCENARIO = {
  schema_version: '1' as const,
  id: 'scn-demo',
  title: 'Old token rejected after rotation',
  risk_refs: ['r-token-replay'],
  invariant_refs: [],
  preconditions: [],
  steps: [
    {
      id: 'probe-rotate',
      kind: 'http' as const,
      with: { method: 'POST', url: '/auth/rotate' },
      timeout_ms: 5000,
    },
    {
      id: 'probe-use-old',
      kind: 'http' as const,
      with: { method: 'GET', url: '/me' },
      timeout_ms: 5000,
    },
  ],
  oracles: [{ id: 'o-401', kind: 'http_status' as const, with: { expected: 401 }, weight: 1 }],
  cleanup: [],
  tags: [],
};

describe('runScenario', () => {
  it('emits a finding when the oracle fails (200 instead of 401)', async () => {
    const events = new EventChainWriter('/tmp/_ignore', { persist: false });
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    const result = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-1',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      events,
      findings,
      findingIdSeed: 1,
    });
    assert.equal(result.oracles[0]?.passed, false);
    assert.equal(result.outcome, 'fail');
    assert.ok(result.finding);
    assert.equal(result.finding?.severity, 'high');
    assert.equal(findings.snapshot().length, 1);
    const kinds = events.snapshot().map((e) => e.kind);
    assert.ok(kinds.includes('probe_executed'));
    assert.ok(kinds.includes('oracle_evaluated'));
    assert.ok(kinds.includes('finding_emitted'));
  });

  it('emits no finding when the oracle passes', async () => {
    const result = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-2',
      probeRunner: async (p) => ({ probe_id: p.id, status: 401 }),
    });
    assert.equal(result.oracles[0]?.passed, true);
    assert.equal(result.outcome, 'pass');
    assert.equal(result.finding, null);
  });

  it('derives finding severity from the resolved risk declaration', async () => {
    const result = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-risk-severity',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      risk: {
        id: 'r-auth',
        category: 'auth',
        title: 'Authentication risk',
        severity: 'critical',
        likelihood: 'likely',
        invariants: [],
        owners: [],
        tags: [],
      },
    });
    assert.equal(result.finding?.risk_id, 'r-auth');
    assert.equal(result.finding?.severity, 'critical');
  });

  it('does not turn a missing probe runner into a security finding', async () => {
    const result = await runScenario({
      scenario: {
        ...SCENARIO,
        oracles: [
          { id: 'o-no-error', kind: 'response_not_contains', with: { value: 'PWNED' }, weight: 1 },
        ],
      },
      run_id: 'run-no-driver',
    });
    assert.equal(result.probes[0]?.error, 'no probe runner configured');
    assert.equal(result.execution_status, 'failed');
    assert.equal(result.outcome, 'error');
    assert.equal(result.oracles[0]?.passed, false);
    assert.equal(result.finding, null);
  });

  it('preflights unsupported probe kinds before executing steps or cleanup', async () => {
    const calls: string[] = [];
    const result = await runScenario({
      scenario: {
        ...SCENARIO,
        steps: SCENARIO.steps.map((probe) => ({ ...probe, kind: 'playwright' as const })),
        cleanup: [{ ...SCENARIO.steps[0], id: 'cleanup-reset', kind: 'shell' }],
      },
      run_id: 'run-capability-gap',
      probeRunner: async (probe) => {
        calls.push(probe.id);
        return { probe_id: probe.id, status: 200 };
      },
      supportedProbeKinds: new Set(['http']),
    });
    assert.deepEqual(calls, []);
    assert.equal(result.execution_status, 'failed');
    assert.equal(result.outcome, 'blocked');
    assert.match(result.execution_error ?? '', /playwright.*not supported/i);
    assert.equal(result.cleanup.length, 1, 'unsupported cleanup is recorded but never executed');
    assert.equal(result.finding, null);
  });

  it('runs every cleanup probe after a failed step and records cleanup failures', async () => {
    const calls: string[] = [];
    const result = await runScenario({
      scenario: {
        ...SCENARIO,
        cleanup: [
          {
            id: 'cleanup-one',
            kind: 'http',
            with: { method: 'DELETE', url: '/fixture/one' },
            timeout_ms: 1000,
          },
          {
            id: 'cleanup-two',
            kind: 'http',
            with: { method: 'DELETE', url: '/fixture/two' },
            timeout_ms: 1000,
          },
        ],
      },
      run_id: 'run-cleanup',
      probeRunner: async (probe) => {
        calls.push(probe.id);
        if (probe.id === 'cleanup-two') throw new Error('cleanup service unavailable');
        return { probe_id: probe.id, status: 200 };
      },
    });
    assert.deepEqual(calls, ['probe-rotate', 'probe-use-old', 'cleanup-one', 'cleanup-two']);
    assert.equal(result.cleanup.length, 2);
    assert.match(result.cleanup[1]?.error ?? '', /cleanup service unavailable/);
  });

  it('dedups identical findings within the same run', async () => {
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    await runScenario({
      scenario: SCENARIO,
      run_id: 'run-3',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    await runScenario({
      scenario: SCENARIO,
      run_id: 'run-3',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 2,
    });
    // Same run_id + scenario_id + risk_id + severity → second finding dedup'd.
    assert.equal(findings.snapshot().length, 1);
  });

  it('generates distinct finding IDs across runs even with the same scenario seed', async () => {
    const findings = new FindingsWriter('/tmp/_ignore', { persist: false });
    const first = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-id-first',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    const second = await runScenario({
      scenario: SCENARIO,
      run_id: 'run-id-second',
      probeRunner: async (p) => ({ probe_id: p.id, status: 200 }),
      findings,
      findingIdSeed: 1,
    });
    assert.ok(first.finding);
    assert.ok(second.finding);
    assert.notEqual(first.finding?.id, second.finding?.id);
    assert.equal(findings.snapshot().length, 2);
  });

  it('makeHttpProbeRunner executes relative HTTP probes against baseUrl', async () => {
    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    globalThis.fetch = (async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const runner = makeHttpProbeRunner({ baseUrl: 'http://localhost:3000' });
      const result = await runner({
        id: 'probe-http',
        kind: 'http',
        with: { method: 'post', url: '/health', body: { hello: 'world' } },
        timeout_ms: 1000,
      });
      assert.equal(seenUrl, 'http://localhost:3000/health');
      assert.equal(result.status, 201);
      assert.deepEqual(result.body, { ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('makeShellProbeRunner executes an allowlisted argv without a shell and redacts output', async () => {
    const runner = makeShellProbeRunner({
      allowShell: true,
      cwd: process.cwd(),
      allowedCommands: [process.execPath],
    });
    const result = await runner({
      id: 'probe-shell',
      kind: 'shell',
      with: { command: process.execPath, args: ['-e', 'console.log("Bearer secret")'] },
      timeout_ms: 2_000,
    });
    assert.equal(result.status, 0);
    assert.equal((result.body as { stdout: string }).stdout, 'Bearer [REDACTED]\n');
  });

  it('makeShellProbeRunner fails closed for missing opt-in and non-allowlisted commands', async () => {
    assert.throws(
      () =>
        makeShellProbeRunner({ allowShell: false, cwd: process.cwd(), allowedCommands: ['node'] }),
      /allowShell=true/,
    );
    const runner = makeShellProbeRunner({
      allowShell: true,
      cwd: process.cwd(),
      allowedCommands: ['definitely-not-node'],
    });
    const result = await runner({
      id: 'probe-shell-denied',
      kind: 'shell',
      with: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      timeout_ms: 2_000,
    });
    assert.match(result.error ?? '', /not allowlisted/);
  });

  it('makeShellProbeRunner aborts a running process cooperatively', async () => {
    const runner = makeShellProbeRunner({
      allowShell: true,
      cwd: process.cwd(),
      allowedCommands: [process.execPath],
    });
    const controller = new AbortController();
    const pending = runner(
      {
        id: 'cancelled-shell',
        kind: 'shell',
        with: { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 5000)'] },
        timeout_ms: 5_000,
      },
      controller.signal,
    );
    controller.abort();
    const result = await pending;
    assert.match(result.error ?? '', /cancel/i);
  });

  it('makeSqlProbeRunner enforces read-only bounded queries and redacts rows', async () => {
    const seen: { sql: string; params: readonly unknown[] }[] = [];
    const runner = makeSqlProbeRunner({
      maxRows: 2,
      query: async (sql, params) => {
        seen.push({ sql, params });
        return [{ email: 'customer@example.test', token: 'secret-token', total: 12 }];
      },
    });
    const result = await runner({
      id: 'probe-sql',
      kind: 'sql',
      with: { query: 'SELECT email, token FROM orders WHERE id = $1', params: ['o-1'] },
      timeout_ms: 1_000,
    });
    assert.deepEqual(seen, [
      { sql: 'SELECT email, token FROM orders WHERE id = $1', params: ['o-1'] },
    ]);
    assert.deepEqual(result.body, [{ email: '[REDACTED-EMAIL]', token: '[REDACTED]', total: 12 }]);
  });

  it('makeSqlProbeRunner rejects mutations, multi-statements and excessive rows', async () => {
    let calls = 0;
    const runner = makeSqlProbeRunner({
      maxRows: 1,
      query: async () => {
        calls += 1;
        return [{ id: 1 }, { id: 2 }];
      },
    });
    const mutation = await runner({
      id: 'probe-sql-write',
      kind: 'sql',
      with: { query: 'DELETE FROM orders' },
      timeout_ms: 1_000,
    });
    const multi = await runner({
      id: 'probe-sql-multi',
      kind: 'sql',
      with: { query: 'SELECT 1; DELETE FROM orders' },
      timeout_ms: 1_000,
    });
    const tooMany = await runner({
      id: 'probe-sql-many',
      kind: 'sql',
      with: { query: 'SELECT id FROM orders' },
      timeout_ms: 1_000,
    });
    assert.match(mutation.error ?? '', /read-only/);
    assert.match(multi.error ?? '', /read-only/);
    assert.match(tooMany.error ?? '', /exceeds 1 rows/);
    assert.equal(calls, 1);
  });

  it('makeSqlProbeRunner propagates cooperative cancellation to the adapter', async () => {
    let received: AbortSignal | undefined;
    const runner = makeSqlProbeRunner({
      query: async (_sql, _params, signal) => {
        received = signal;
        return new Promise<readonly Record<string, unknown>[]>((resolve) => {
          signal?.addEventListener('abort', () => resolve([]), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const pending = runner(
      { id: 'cancelled-sql', kind: 'sql', with: { query: 'SELECT 1' }, timeout_ms: 5_000 },
      controller.signal,
    );
    controller.abort();
    const result = await pending;
    assert.equal(received, controller.signal);
    assert.match(result.error ?? '', /cancel/i);
  });

  it('makePlaywrightProbeRunner applies structured actions and origin policy', async () => {
    const calls: string[] = [];
    const page = {
      async goto(url: string) {
        calls.push(`goto:${url}`);
      },
      async click(selector: string) {
        calls.push(`click:${selector}`);
      },
      async fill(selector: string, value: string) {
        calls.push(`fill:${selector}:${value}`);
      },
      async press(selector: string, key: string) {
        calls.push(`press:${selector}:${key}`);
      },
      locator: (selector: string) => ({
        waitFor: async () => {
          calls.push(`wait:${selector}`);
        },
      }),
      async title() {
        return 'Checkout';
      },
      url: () => 'http://shop.test/checkout',
      async innerText() {
        return 'Order confirmation customer@example.test';
      },
    };
    let networkHandler:
      | ((route: {
          request(): { url(): string };
          abort(): Promise<void>;
          continue(): Promise<void>;
        }) => Promise<void>)
      | undefined;
    const fakeBrowser = {
      async newContext() {
        return {
          route: async (
            _pattern: string,
            handler: (route: {
              request(): { url(): string };
              abort(): Promise<void>;
              continue(): Promise<void>;
            }) => Promise<void>,
          ) => {
            networkHandler = handler;
          },
          newPage: async () => page,
          close: async () => calls.push('context-close'),
        };
      },
      async close() {
        calls.push('browser-close');
      },
    };
    const runner = makePlaywrightProbeRunner({
      baseUrl: 'http://shop.test',
      browserFactory: { launch: async () => fakeBrowser as never },
    });
    let aborted = false;
    // The route is installed lazily with the browser context; trigger the
    // probe below first so the injected test factory has registered it.
    const result = await runner({
      id: 'probe-browser',
      kind: 'playwright',
      with: {
        url: '/checkout',
        actions: [
          { type: 'fill', selector: '#email', value: 'customer@example.test' },
          { type: 'click', selector: '#pay' },
          { type: 'wait_for', selector: '#confirmation' },
        ],
      },
      timeout_ms: 1_000,
    });
    assert.ok(networkHandler);
    await networkHandler({
      request: () => ({ url: 'https://evil.test/redirected-resource' }),
      abort: async () => {
        aborted = true;
      },
      continue: async () => undefined,
    });
    assert.equal(aborted, true);
    assert.equal((result.body as { title: string }).title, 'Checkout');
    assert.match((result.body as { text: string }).text, /\[REDACTED-EMAIL\]/);
    assert.deepEqual(calls.slice(0, 4), [
      'goto:http://shop.test/checkout',
      'fill:#email:customer@example.test',
      'click:#pay',
      'wait:#confirmation',
    ]);
    await runner.close();
    assert.deepEqual(calls.slice(-2), ['context-close', 'browser-close']);
  });

  it('makePlaywrightProbeRunner closes the active page on cooperative cancellation', async () => {
    let closed = false;
    let release: (() => void) | undefined;
    const page = {
      goto: async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      click: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      locator: () => ({ waitFor: async () => undefined }),
      title: async () => 'cancelled',
      url: () => 'http://shop.test',
      innerText: async () => '',
      close: async () => {
        closed = true;
        release?.();
      },
    };
    const runner = makePlaywrightProbeRunner({
      baseUrl: 'http://shop.test',
      browserFactory: {
        launch: async () =>
          ({
            newContext: async () => ({
              route: async () => undefined,
              newPage: async () => page,
              close: async () => undefined,
            }),
            close: async () => undefined,
          }) as never,
      },
    });
    const controller = new AbortController();
    const pending = runner(
      { id: 'cancelled-browser', kind: 'playwright', with: { url: '/' }, timeout_ms: 5_000 },
      controller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const result = await pending;
    assert.equal(closed, true);
    assert.match(result.error ?? '', /cancel/i);
  });

  it('makePostgresSqlProbeRunner requires an explicit DSN and bounds timeout policy', async () => {
    assert.throws(
      () => makePostgresSqlProbeRunner({ connectionString: '' }),
      /connectionString is required/,
    );
    assert.throws(
      () =>
        makePostgresSqlProbeRunner({
          connectionString: 'postgres://localhost/aqa',
          statementTimeoutMs: 0,
        }),
      /statementTimeoutMs/,
    );
    const runner = makePostgresSqlProbeRunner({ connectionString: 'postgres://localhost/aqa' });
    await runner.close();
  });

  it('makeHttpProbeRunner rejects unsupported probe kinds', async () => {
    const runner = makeHttpProbeRunner({ baseUrl: 'http://localhost:3000' });
    const result = await runner({
      id: 'probe-shell',
      kind: 'shell',
      with: {},
      timeout_ms: 1000,
    });
    assert.match(result.error ?? '', /unsupported probe kind/i);
  });

  it('makeHttpProbeRunner blocks non-allowlisted origins and oversized responses', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('0123456789');
    }) as typeof fetch;
    try {
      const runner = makeHttpProbeRunner({
        baseUrl: 'https://shop.example',
        max_response_bytes: 5,
      });
      const external = await runner({
        id: 'external',
        kind: 'http',
        with: { method: 'GET', url: 'https://evil.example/data' },
        timeout_ms: 1000,
      });
      assert.match(external.error ?? '', /not allowlisted/);
      assert.equal(calls, 0);
      const oversized = await runner({
        id: 'large',
        kind: 'http',
        with: { method: 'GET', url: '/large' },
        timeout_ms: 1000,
      });
      assert.match(oversized.error ?? '', /exceeds 5 bytes/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('makeHttpProbeRunner rejects credentialed URLs and unsafe redirects', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
      });
    }) as typeof fetch;
    try {
      const runner = makeHttpProbeRunner({ baseUrl: 'https://shop.example' });
      const credentialed = await runner({
        id: 'credentialed',
        kind: 'http',
        with: { method: 'GET', url: 'https://user:pass@shop.example/private' },
        timeout_ms: 1000,
      });
      assert.match(credentialed.error ?? '', /must not contain credentials/i);
      assert.equal(calls, 0);
      const redirected = await runner({
        id: 'redirected',
        kind: 'http',
        with: { method: 'GET', url: '/login' },
        timeout_ms: 1000,
      });
      assert.match(redirected.error ?? '', /redirect target is not allowlisted/i);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('makeHttpProbeRunner propagates cooperative cancellation to fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by worker')));
      })) as typeof fetch;
    try {
      const controller = new AbortController();
      const runner = makeHttpProbeRunner({ baseUrl: 'https://shop.example' });
      const pending = runner(
        {
          id: 'cancelled-http',
          kind: 'http',
          with: { method: 'GET', url: '/slow' },
          timeout_ms: 5_000,
        },
        controller.signal,
      );
      controller.abort();
      const result = await pending;
      assert.match(result.error ?? '', /aborted|cancel/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
