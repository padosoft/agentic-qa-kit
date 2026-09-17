import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { FileArtifactStore, S3ArtifactStore, redactJson, redactText } from '../dist/index.js';

const roots: string[] = [];
after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'aqa-artifacts-'));
  roots.push(root);
  return { root, artifacts: new FileArtifactStore(root) };
}

describe('FileArtifactStore', () => {
  it('redacts text and JSON before hashing and persistence', async () => {
    const { root, artifacts } = await store();
    const ref = await artifacts.putText(
      'runs/r1/log.txt',
      'Authorization: Bearer secret email a@b.test PAN 4111111111111111',
    );
    const text = (await artifacts.get(ref)).toString();
    assert.match(text, /Bearer \[REDACTED\]/);
    assert.doesNotMatch(text, /secret|a@b\.test|4111111111111111/);
    assert.equal(ref.sha256.length, 64);
    assert.equal((await readFile(join(root, 'runs/r1/log.txt.meta.json'))).length > 0, true);
    const json = redactJson({ password: 'secret', nested: 'u@x.test' });
    assert.deepEqual(json, { password: '[REDACTED]', nested: '[REDACTED-EMAIL]' });
  });

  it('rejects traversal and preserves binary bytes', async () => {
    const { artifacts } = await store();
    await assert.rejects(() => artifacts.putText('../escape.txt', 'x'), /relative|traversal/i);
    const bytes = Uint8Array.from([0, 255, 1]);
    const ref = await artifacts.putBytes('runs/r1/trace.bin', bytes);
    assert.deepEqual(new Uint8Array(await artifacts.get(ref)), bytes);
    await artifacts.delete(ref);
    await assert.rejects(() => artifacts.get(ref));
  });
});

it('redactText covers JWT and AWS key canaries', () => {
  const result = redactText('eyJabc.def.ghi AKIA1234567890ABCDEF');
  assert.match(result, /REDACTED-JWT/);
  assert.match(result, /REDACTED-AWS-KEY/);
});

describe('S3ArtifactStore', () => {
  it('redacts, prefixes, verifies and applies Object Lock options through an injected client', async () => {
    const objects = new Map<string, Buffer>();
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        calls.push({ name: command.constructor.name, input: command.input });
        const input = command.input;
        const key = String(input.Key);
        if (command.constructor.name === 'PutObjectCommand') {
          const body = input.Body;
          objects.set(
            key,
            body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(String(body)),
          );
          return {};
        }
        if (command.constructor.name === 'GetObjectCommand') {
          const body = objects.get(key);
          return { Body: { transformToByteArray: async () => new Uint8Array(body ?? []) } };
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          const metadata = objects.get(key);
          return {
            Metadata: {
              artifact: Buffer.from(metadata?.toString() ?? '', 'utf8').toString('base64'),
            },
          };
        }
        if (command.constructor.name === 'DeleteObjectCommand') {
          objects.delete(key);
          return {};
        }
        throw new Error(`unexpected command: ${command.constructor.name}`);
      },
    };
    const store = new S3ArtifactStore({
      bucket: 'aqa-test',
      prefix: 'tenant/acme',
      retainUntil: new Date('2027-01-01T00:00:00Z'),
      retentionMode: 'COMPLIANCE',
      client,
    });
    const ref = await store.putText('runs/r1/log.txt', 'Bearer secret');
    assert.equal(ref.key, 'runs/r1/log.txt');
    assert.equal(Buffer.from(await store.get(ref)).toString(), 'Bearer [REDACTED]');
    const put = calls.find((call) => call.name === 'PutObjectCommand');
    assert.equal(put?.input.Key, 'tenant/acme/runs/r1/log.txt');
    assert.equal(put?.input.ObjectLockMode, 'COMPLIANCE');
    assert.deepEqual(await store.head(ref), ref);
    await store.delete(ref);
    await assert.rejects(() => store.get(ref), /empty|digest/i);
  });

  it('rejects invalid retention configuration and traversal', () => {
    const client = { send: async () => ({}) };
    assert.throws(
      () =>
        new S3ArtifactStore({
          bucket: 'aqa-test',
          retainUntil: new Date(),
          client,
        }),
      /retentionMode is required/,
    );
    assert.throws(
      () =>
        new S3ArtifactStore({
          bucket: 'aqa-test',
          prefix: '../tenant',
          client,
        }),
      /traversal/i,
    );
  });
});
