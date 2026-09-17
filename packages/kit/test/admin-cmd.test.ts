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
import { MemoryStore } from '@aqa/store';
import { runAdmin } from '../dist/commands/admin.js';

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
    } finally {
      await boot.close();
    }
  });
});
