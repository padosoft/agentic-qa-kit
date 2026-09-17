import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { FileArtifactStore, redactJson, redactText } from '../dist/index.js';

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
