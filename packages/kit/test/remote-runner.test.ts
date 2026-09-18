import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RunnerJwtAuthorizer } from '@aqa/auth';
import { HttpRunnerQueue, RunnerQueue, RunnerWorker } from '@aqa/server';
import { runAdmin } from '../dist/commands/admin.js';

function fakeAdminDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aqa-remote-runner-admin-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>admin</body></html>');
  return dir;
}

function jwt(privateKey: object, subject: string, scopes: string[]): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const claims = encode({
    iss: 'https://issuer.aqa.test',
    aud: 'aqa-runner',
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 300,
    scopes,
  });
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${claims}`, 'ascii'),
    privateKey,
  ).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

describe('remote runner identity journey', () => {
  it('dequeues, renews and ACKs over HTTP while enforcing scope and rotating JWT', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
    const authorizer = new RunnerJwtAuthorizer({
      public_key_pem: publicPem.toString(),
      issuer: 'https://issuer.aqa.test',
      audience: 'aqa-runner',
    });
    const controlQueue = new RunnerQueue({ lease_ms: 5_000 });
    controlQueue.enqueue({
      id: 'remote-allowed',
      enqueued_at: new Date().toISOString(),
      payload: { org: 'shop', project: 'checkout' },
    });
    controlQueue.enqueue({
      id: 'remote-forbidden',
      enqueued_at: new Date().toISOString(),
      payload: { org: 'other', project: 'checkout' },
    });
    const boot = await runAdmin({
      root: mkdtempSync(join(tmpdir(), 'aqa-remote-runner-root-')),
      port: 0,
      host: '127.0.0.1',
      adminDistDir: fakeAdminDist(),
      queue: controlQueue,
      runnerAuthorize: (headers) => authorizer.authorize(headers),
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;

    let token = jwt(privateKey, 'runner-a', ['shop/checkout']);
    const remote = new HttpRunnerQueue(boot.url, () => token);
    try {
      const lease = await remote.dequeue();
      assert.equal(lease?.id, 'remote-allowed');
      assert.equal(await remote.get('remote-forbidden'), null);
      assert.equal(await remote.renew(lease?.id ?? '', lease?.lease_token), true);

      // A projected secret/JWT can change while the process remains alive.
      token = jwt(privateKey, 'runner-b', ['shop/checkout']);
      assert.equal(await remote.ack(lease?.id ?? '', lease?.lease_token), true);

      const wrongScope = new HttpRunnerQueue(boot.url, () =>
        jwt(privateKey, 'runner-other', ['other/checkout']),
      );
      assert.equal((await wrongScope.dequeue())?.id, 'remote-forbidden');
      assert.equal(controlQueue.get('remote-allowed')?.status, 'done');
    } finally {
      await boot.close();
    }
  });
});
