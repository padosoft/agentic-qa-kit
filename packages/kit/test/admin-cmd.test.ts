/**
 * v1.9 — `aqa admin` CLI verb.
 *
 * Boots the admin SPA + makeApi() in-process on a random port and
 * exercises both the static SPA path (`/`) and the API surface
 * (`/api/healthz` + a real makeApi() route). Tests use port 0 so they
 * can run in parallel without colliding with the kit's default 5173.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { type OidcAdapter, OidcSessionManager, ScimTokenManager } from '@aqa/auth';
import { MetricsRegistry } from '@aqa/observability';
import { MemoryEventBus } from '@aqa/server';
import { MemoryStore } from '@aqa/store';
import { oidcEnvironmentConfig, runAdmin } from '../dist/commands/admin.js';

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aqa-admin-cmd-'));
}

/** Minimal fake admin dist so the boot path can find index.html. */
function makeFakeAdminDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-admin-dist-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><body><div id="root">fake</div></body></html>',
    'utf8',
  );
  writeFileSync(
    join(dir, 'assets', 'app.js'),
    '/* fake bundle */ console.log("aqa admin smoke");\n',
    'utf8',
  );
  return dir;
}

async function fetchText(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
): Promise<{ status: number; text: string; contentType: string }> {
  const r = await fetch(url, init);
  return {
    status: r.status,
    text: await r.text(),
    contentType: r.headers.get('content-type') ?? '',
  };
}

describe('aqa admin — boot + smoke', () => {
  it('parses OIDC environment configuration fail-closed without exposing the secret', () => {
    assert.deepEqual(oidcEnvironmentConfig({}), {});
    assert.deepEqual(
      oidcEnvironmentConfig({
        AQA_OIDC_ENABLED: 'true',
        AQA_OIDC_ISSUER: 'https://idp.example.test',
        AQA_OIDC_CLIENT_ID: 'aqa-admin',
        AQA_OIDC_REDIRECT_URI: 'https://aqa.example.test/auth/callback',
        AQA_OIDC_CLIENT_SECRET: 'secret-value',
        AQA_OIDC_ALLOWED_ENDPOINT_ORIGINS: 'https://login.example.test, https://keys.example.test',
        AQA_OIDC_SESSION_DSN: 'postgres://user:password@db.example.test/aqa',
      }),
      {
        config: {
          issuer: 'https://idp.example.test',
          clientId: 'aqa-admin',
          redirectUri: 'https://aqa.example.test/auth/callback',
          clientSecretEnv: 'AQA_OIDC_CLIENT_SECRET',
          allowedEndpointOrigins: ['https://login.example.test', 'https://keys.example.test'],
          sessionDsn: 'postgres://user:password@db.example.test/aqa',
        },
      },
    );
    const incomplete = oidcEnvironmentConfig({
      AQA_OIDC_ENABLED: 'true',
      AQA_OIDC_ISSUER: 'https://idp.example.test',
      AQA_OIDC_CLIENT_ID: 'aqa-admin',
      AQA_OIDC_CLIENT_SECRET: 'secret-value',
    });
    assert.match(incomplete.error ?? '', /redirectUri/);
    assert.doesNotMatch(JSON.stringify(incomplete), /secret-value/);
    assert.match(
      oidcEnvironmentConfig({
        AQA_OIDC_ENABLED: 'true',
        AQA_OIDC_ISSUER: 'https://idp.example.test',
        AQA_OIDC_CLIENT_ID: 'aqa-admin',
        AQA_OIDC_REDIRECT_URI: 'https://aqa.example.test/auth/callback',
        AQA_OIDC_CLIENT_SECRET: 'secret-value',
        AQA_OIDC_ALLOWED_ENDPOINT_ORIGINS: 'https://login.example.test,,https://keys.example.test',
      }).error ?? '',
      /empty origin/,
    );
  });

  it('treats environment OIDC as the explicit identity boundary for a non-loopback boot', async () => {
    const keys = [
      'AQA_OIDC_ENABLED',
      'AQA_OIDC_ISSUER',
      'AQA_OIDC_CLIENT_ID',
      'AQA_OIDC_REDIRECT_URI',
      'AQA_OIDC_CLIENT_SECRET',
    ] as const;
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, {
      AQA_OIDC_ENABLED: 'true',
      AQA_OIDC_ISSUER: 'https://idp.example.test',
      AQA_OIDC_CLIENT_ID: 'aqa-admin',
      AQA_OIDC_REDIRECT_URI: 'https://aqa.example.test/auth/callback',
      AQA_OIDC_CLIENT_SECRET: 'test-only-secret',
    });
    const boot = await runAdmin({
      root: makeTempRoot(),
      port: 0,
      host: '0.0.0.0',
      adminDistDir: makeFakeAdminDist(),
    });
    try {
      assert.equal(boot.ok, true, `expected OIDC-configured boot, got ${JSON.stringify(boot)}`);
    } finally {
      if (boot.ok) await boot.close();
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('runs OIDC login, callback, authenticated API request, and logout', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const adapter = {
      authorizeUrl: async (state: string) => `https://idp.test/authorize?state=${state}`,
      exchangeCode: async () => ({
        user: {
          id: 'oidc-u',
          email: 'oidc@example.test',
          display_name: 'OIDC User',
          roles: ['viewer' as const],
        },
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    } as unknown as OidcAdapter;
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      oidc: new OidcSessionManager(adapter),
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const login = await fetch(`${boot.url}/auth/login`, { redirect: 'manual' });
      assert.equal(login.status, 302);
      const location = login.headers.get('location') ?? '';
      const state = new URL(location).searchParams.get('state');
      assert.ok(state);
      const callback = await fetch(`${boot.url}/auth/callback?state=${state}&code=one-time`, {
        redirect: 'manual',
      });
      assert.equal(callback.status, 302);
      const cookie = callback.headers.get('set-cookie');
      assert.match(cookie ?? '', /HttpOnly/);
      assert.doesNotMatch(
        cookie ?? '',
        /Secure/,
        'loopback HTTP must not set an unusable Secure cookie',
      );
      const api = await fetch(`${boot.url}/api/runs`, { headers: { cookie: cookie ?? '' } });
      assert.equal(api.status, 400, 'viewer must authenticate but still needs tenant scope');
      const logout = await fetch(`${boot.url}/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookie ?? '' },
      });
      assert.equal(logout.status, 204);
      const denied = await fetch(`${boot.url}/api/runs`, { headers: { cookie: cookie ?? '' } });
      assert.equal(denied.status, 401);
    } finally {
      await boot.close();
    }
  });

  it('boots, serves index.html on /, and returns 200 on /api/healthz', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir });
    assert.equal(boot.ok, true, `expected ok, got ${JSON.stringify(boot)}`);
    if (!boot.ok) return;
    try {
      assert.ok(boot.port > 0, 'port=0 must resolve to an OS-assigned port');
      assert.ok(boot.url.startsWith('http://127.0.0.1:'));

      const indexRes = await fetchText(`${boot.url}/`);
      assert.equal(indexRes.status, 200);
      assert.match(indexRes.contentType, /text\/html/);
      assert.match(indexRes.text, /<div id="root">fake<\/div>/);

      const assetRes = await fetchText(`${boot.url}/assets/app.js`);
      assert.equal(assetRes.status, 200);
      assert.match(assetRes.contentType, /javascript/);
      assert.match(assetRes.text, /aqa admin smoke/);

      const healthRes = await fetchText(`${boot.url}/api/healthz`);
      assert.equal(healthRes.status, 200);
      const health = JSON.parse(healthRes.text) as { ok: boolean };
      assert.equal(health.ok, true);

      const openApiRes = await fetchText(`${boot.url}/openapi.json`);
      assert.equal(openApiRes.status, 200);
      assert.match(openApiRes.contentType, /application\/vnd\.oai\.openapi\+json/);
      const openApi = JSON.parse(openApiRes.text) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      assert.equal(openApi.openapi, '3.1.0');
      assert.ok(openApi.paths['/api/runs/{id}']);

      const asyncApiRes = await fetchText(`${boot.url}/asyncapi.json`);
      assert.equal(asyncApiRes.status, 200);
      assert.match(asyncApiRes.contentType, /application\/asyncapi\+json/);
      const asyncApi = JSON.parse(asyncApiRes.text) as {
        asyncapi: string;
        operations: Record<string, unknown>;
      };
      assert.equal(asyncApi.asyncapi, '3.0.0');
      assert.ok(asyncApi.operations.receive_run_requested);

      const usersRes = await fetchText(`${boot.url}/api/users`);
      assert.equal(usersRes.status, 200);
      const users = JSON.parse(usersRes.text) as {
        users: Array<{ id: string; email: string; status?: string }>;
      };
      assert.deepEqual(users.users, [
        {
          id: 'usr-local',
          email: 'local@aqa.test',
          display_name: 'Local',
          roles: ['admin'],
          status: 'active',
          last_active_at: users.users[0]?.last_active_at,
        },
      ]);
    } finally {
      await boot.close();
    }
  });

  it('exposes bounded Prometheus metrics and protects non-loopback scrapes', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const metrics = new MetricsRegistry();
    metrics.counter('aqa_test_runs_total', { outcome: 'ok' });
    const local = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir, metrics });
    assert.equal(local.ok, true);
    if (!local.ok) return;
    try {
      const response = await fetchText(`${local.url}/metrics`);
      assert.equal(response.status, 200);
      assert.match(response.contentType, /text\/plain/);
      assert.match(response.text, /aqa_test_runs_total\{outcome="ok"\} 1/);
    } finally {
      await local.close();
    }
    const rejected = await runAdmin({ root, port: 0, host: '0.0.0.0', adminDistDir, metrics });
    assert.deepEqual(rejected, {
      ok: false,
      error: 'admin: metricsAuthorize is required when metrics are exposed off loopback',
    });
  });

  it('serves index.html for unknown non-asset paths (SPA fallback)', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const res = await fetchText(`${boot.url}/runs/some-deep/route`);
      assert.equal(res.status, 200);
      assert.match(res.contentType, /text\/html/);
      assert.match(res.text, /<div id="root">fake<\/div>/);
    } finally {
      await boot.close();
    }
  });

  it('returns 404 for missing /assets/* without falling back to index.html', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const res = await fetchText(`${boot.url}/assets/does-not-exist.js`);
      assert.equal(res.status, 404);
    } finally {
      await boot.close();
    }
  });

  it('serves a real makeApi() route (GET /api/orgs)', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const res = await fetchText(`${boot.url}/api/orgs`);
      // A bare boot has no orgs seeded, but the route exists and the
      // adapter wraps it; status MUST NOT be 404. Status may be 200
      // (empty list) or 401/403 depending on auth wiring — we accept
      // any non-404 here because the goal is "route is reachable".
      assert.notEqual(res.status, 404, `/api/orgs should be reachable, got ${res.status}`);
    } finally {
      await boot.close();
    }
  });

  it('serves a tenant-filtered SSE stream and cleans up on disconnect', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const eventBus = new MemoryEventBus();
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      eventBus,
      authenticate: async () => ({
        id: 'stream-user',
        email: 'stream@example.test',
        display_name: 'Stream User',
        roles: ['admin'],
      }),
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    const controller = new AbortController();
    try {
      await eventBus.publish({
        id: 'evt-replay',
        type: 'run.updated',
        occurred_at: new Date().toISOString(),
        org: 'acme',
        project: 'shop',
        data: { status: 'queued' },
      });
      const stream = await fetch(`${boot.url}/api/events/stream?org=acme&project=shop`, {
        signal: controller.signal,
      });
      assert.equal(stream.status, 200);
      assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
      const reader = stream.body?.getReader();
      assert.ok(reader);
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /retry: 3000/);
      assert.match(new TextDecoder().decode(first.value), /evt-replay/);
      await eventBus.publish({
        id: 'evt-tenant',
        type: 'run.updated',
        occurred_at: new Date().toISOString(),
        org: 'acme',
        project: 'shop',
        data: { status: 'running' },
      });
      await eventBus.publish({
        id: 'evt-other',
        type: 'run.updated',
        occurred_at: new Date().toISOString(),
        org: 'other',
        project: 'shop',
        data: { status: 'running' },
      });
      const next = await reader.read();
      const text = new TextDecoder().decode(next.value);
      assert.match(text, /evt-tenant/);
      assert.doesNotMatch(text, /evt-other/);
      await reader.cancel();
    } finally {
      controller.abort();
      await boot.close();
    }
  });

  it('uses an injected control-plane store instead of silently creating memory state', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const store = new MemoryStore();
    await store.saveOrg({
      schema_version: '1',
      slug: 'persisted-org',
      display_name: 'Persisted Org',
      created_at: new Date().toISOString(),
    });
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir, store });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const response = await fetchText(`${boot.url}/api/orgs`);
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.text), {
        orgs: [
          {
            schema_version: '1',
            slug: 'persisted-org',
            display_name: 'Persisted Org',
            created_at: JSON.parse(response.text).orgs[0].created_at,
          },
        ],
      });
    } finally {
      await boot.close();
    }
  });

  it('enforces the route permission at the HTTP boundary', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      authenticate: async () => null,
    });
    assert.equal(boot.ok, true);
    if (boot.ok) {
      try {
        const res = await fetchText(`${boot.url}/api/orgs`);
        assert.equal(res.status, 401);
      } finally {
        await boot.close();
      }
    }
  });

  it('passes dedicated runner authorization to dequeue and ACK routes', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      runnerAuthorize: async (headers) => headers.authorization === 'Bearer runner-test',
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const denied = await fetchText(`${boot.url}/api/runner/jobs/next`);
      assert.equal(denied.status, 401);
      const allowed = await fetchText(`${boot.url}/api/runner/jobs/next`, {
        headers: { authorization: 'Bearer runner-test' },
      });
      assert.equal(allowed.status, 204);
    } finally {
      await boot.close();
    }
  });

  it('wires the standard SCIM bearer token manager into provisioning routes', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const records = new Map<string, import('@aqa/auth').ScimTokenRecord>();
    const manager = new ScimTokenManager({
      get: async (id) => records.get(id) ?? null,
      put: async (record) => void records.set(record.id, record),
    });
    const issued = await manager.issue('org-scim');
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      scimTokenManager: manager,
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const denied = await fetchText(`${boot.url}/scim/v2/Users`, {
        headers: { 'x-aqa-org': 'org-scim' },
      });
      assert.equal(denied.status, 401);
      const allowed = await fetchText(`${boot.url}/scim/v2/Users`, {
        headers: {
          'x-aqa-org': 'org-scim',
          authorization: `Bearer ${issued.id}.${issued.token}`,
        },
      });
      assert.equal(allowed.status, 200);
      assert.match(allowed.text, /totalResults/);
    } finally {
      await boot.close();
    }
  });

  it('enforces server-side tenant membership after role authorization', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      authenticate: async () => ({
        id: 'u',
        email: 'u@example.test',
        display_name: 'U',
        roles: ['admin'],
      }),
      authorizeScope: async (_user, requested) => requested.org === 'allowed-org',
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const denied = await fetchText(`${boot.url}/api/orgs`, {
        headers: { 'x-aqa-org': 'blocked-org' },
      });
      assert.equal(denied.status, 403);
      const allowed = await fetchText(`${boot.url}/api/orgs`, {
        headers: { 'x-aqa-org': 'allowed-org' },
      });
      assert.notEqual(allowed.status, 403);
    } finally {
      await boot.close();
    }
  });

  it('refuses a non-loopback bind without explicit authentication', async () => {
    const result = await runAdmin({
      root: makeTempRoot(),
      port: 0,
      host: '0.0.0.0',
      adminDistDir: makeFakeAdminDist(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /non-loopback.*authenticate/i);
  });

  it('rejects --port outside 0..65535', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const result = await runAdmin({ root, port: 99999, adminDistDir });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /--port must be an integer/);
  });

  it('errors with a clear message when the bundled SPA is missing', async () => {
    const root = makeTempRoot();
    const adminDistDir = join(makeTempRoot(), 'definitely-does-not-exist');
    const result = await runAdmin({ root, port: 0, adminDistDir });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /bundled SPA not found/);
  });

  it('refuses to serve files outside the SPA dist (path traversal)', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({ root, port: 0, host: '127.0.0.1', adminDistDir });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      // node:http normalises the URL but a literal `..` segment that
      // survives URL parsing must still be refused by the static handler.
      const res = await fetch(`${boot.url}/..%2F..%2Fetc%2Fpasswd`);
      assert.ok(res.status === 403 || res.status === 200, `got ${res.status}`);
      // If it's a 200, it must be the SPA fallback (index.html), not
      // a leaked outside-dist file.
      if (res.status === 200) {
        const text = await res.text();
        assert.match(text, /<div id="root">fake<\/div>/);
      }
    } finally {
      await boot.close();
    }
  });

  it('rejects partial runner JWT environment configuration', async () => {
    const names = [
      'AQA_RUNNER_JWT_PUBLIC_KEY',
      'AQA_RUNNER_JWT_ISSUER',
      'AQA_RUNNER_JWT_AUDIENCE',
    ] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      Reflect.deleteProperty(process.env, 'AQA_RUNNER_JWT_PUBLIC_KEY');
      process.env.AQA_RUNNER_JWT_ISSUER = 'https://issuer.example.test';
      Reflect.deleteProperty(process.env, 'AQA_RUNNER_JWT_AUDIENCE');
      const result = await runAdmin({
        root: makeTempRoot(),
        port: 0,
        adminDistDir: makeFakeAdminDist(),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /must be configured together/);
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
  });

  it('uses an explicit CORS allowlist and blocks cross-origin mutations', async () => {
    const root = makeTempRoot();
    const adminDistDir = makeFakeAdminDist();
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir,
      corsOrigins: ['https://console.example.test/'],
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    try {
      const denied = await fetch(`${boot.url}/api/orgs`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example.test' },
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);

      const preflight = await fetch(`${boot.url}/api/orgs`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://console.example.test' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get('access-control-allow-origin'),
        'https://console.example.test',
      );
      assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
      assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PATCH/);
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /idempotency-key/i);
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /if-match/i);
    } finally {
      await boot.close();
    }
  });
});
