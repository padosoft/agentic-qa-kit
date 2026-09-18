import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RunnerJwtAuthorizer } from '@aqa/auth';
import { HttpRunnerQueue, RunnerQueue } from '@aqa/server';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { runAdmin } from '../dist/commands/admin.js';
import { runInit } from '../dist/commands/init.js';
import { makeKitWorker } from '../dist/worker.js';

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

const SMOKE_MANIFEST = `schema_version: "1"
name: pack-remote-smoke
version: 0.1.0
description: remote worker smoke fixture
author: test
license: MIT
applies_when:
  sut_type: [api]
templates: []
scenarios: [scenarios/smoke.yaml]
risks: []
oracles: []
probes: []
`;

const SMOKE_SCENARIO = `schema_version: "1"
id: scn-remote-smoke
title: Remote worker smoke
risk_refs: [r-remote]
invariant_refs: [inv-remote]
preconditions: []
steps:
  - id: probe-health
    kind: http
    with: { method: "GET", url: "/healthz" }
oracles:
  - id: oracle-health
    kind: http_status
    with: { expected: 200 }
tags: [smoke]
`;

function remoteFixture(): { root: string; packDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'aqa-remote-worker-project-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'remote-worker' }));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'server.ts'), 'export {}\n');
  runInit({ root, projectName: 'remote-worker' });
  const riskMapPath = join(root, '.aqa', 'risk-map.yaml');
  const riskMap = yamlParse(readFileSync(riskMapPath, 'utf8')) as {
    risks: Array<Record<string, unknown>>;
  };
  riskMap.risks.push({
    id: 'r-remote',
    category: 'integration',
    title: 'Remote smoke risk',
    severity: 'medium',
    likelihood: 'unlikely',
    invariants: [{ id: 'inv-remote', statement: 'The health endpoint responds.' }],
  });
  writeFileSync(riskMapPath, yamlStringify(riskMap));
  const packDir = join(root, 'remote-pack');
  mkdirSync(join(packDir, 'scenarios'), { recursive: true });
  writeFileSync(join(packDir, 'pack.yaml'), SMOKE_MANIFEST);
  writeFileSync(join(packDir, 'package.json'), JSON.stringify({ name: 'pack-remote-smoke' }));
  writeFileSync(join(packDir, 'scenarios', 'smoke.yaml'), SMOKE_SCENARIO);
  const profilesPath = join(root, '.aqa', 'profiles.yaml');
  const profiles = yamlParse(readFileSync(profilesPath, 'utf8')) as {
    profiles: Record<string, Record<string, unknown>>;
  };
  profiles.profiles.smoke = {
    ...profiles.profiles.smoke,
    packs: ['pack-remote-smoke'],
    tags: ['smoke'],
  };
  writeFileSync(profilesPath, yamlStringify(profiles));
  return { root, packDir };
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

      // A projected secret/JWT can change while the process remains alive,
      // but rotating credentials must preserve the authenticated runner id.
      token = jwt(privateKey, 'runner-b', ['shop/checkout']);
      assert.equal(await remote.ack(lease?.id ?? '', lease?.lease_token), false);
      token = jwt(privateKey, 'runner-a', ['shop/checkout']);
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

  it('runs the real Kit lifecycle over the authenticated remote queue', async () => {
    const { root, packDir } = remoteFixture();
    const target = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    assert.ok(address && typeof address === 'object');
    const projectPath = join(root, '.aqa', 'project.yaml');
    const project = yamlParse(readFileSync(projectPath, 'utf8')) as Record<string, unknown>;
    project.sut = {
      ...(project.sut as Record<string, unknown>),
      base_url: `http://127.0.0.1:${address.port}`,
    };
    writeFileSync(projectPath, yamlStringify(project));

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const authorizer = new RunnerJwtAuthorizer({
      public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      issuer: 'https://issuer.aqa.test',
      audience: 'aqa-runner',
    });
    const controlQueue = new RunnerQueue({ lease_ms: 5_000 });
    const jobId = `remote-kit-${Date.now()}`;
    controlQueue.enqueue({
      id: jobId,
      enqueued_at: new Date().toISOString(),
      payload: { org: 'shop', project: 'checkout', profile: 'smoke' },
    });
    const boot = await runAdmin({
      root,
      port: 0,
      host: '127.0.0.1',
      adminDistDir: fakeAdminDist(),
      queue: controlQueue,
      runnerAuthorize: (headers) => authorizer.authorize(headers),
    });
    assert.equal(boot.ok, true);
    if (!boot.ok) return;
    let tokenCalls = 0;
    const remoteQueue = new HttpRunnerQueue(boot.url, () => {
      tokenCalls += 1;
      return jwt(privateKey, 'runner-a', ['shop/checkout']);
    });
    const worker = makeKitWorker({
      queue: remoteQueue,
      root,
      packsRoot: [packDir],
      poll_ms: 10,
    });
    try {
      const result = await worker.runOnce();
      assert.deepEqual(
        result,
        { status: 'completed', job_id: jobId },
        JSON.stringify(controlQueue.get(jobId)),
      );
      assert.equal(controlQueue.get(jobId)?.status, 'done');
      assert.ok(tokenCalls >= 2, 'the worker must resolve a fresh token after dequeue');
      const runDirs = readdirSync(join(root, '.aqa', 'runs'));
      assert.ok(runDirs.length > 0);
      const runDir = join(root, '.aqa', 'runs', runDirs[0] as string);
      assert.ok(existsSync(join(runDir, 'events.jsonl')));
      assert.ok(existsSync(join(runDir, 'findings.jsonl')));
      assert.ok(readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().length > 0);
    } finally {
      await boot.close();
      await new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
