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
});
