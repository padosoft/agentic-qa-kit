import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { runFixturesRestore, runFixturesSnapshot } from '../dist/commands/fixtures.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('fixture management', () => {
  it('snapshots JSON with deterministic PII anonymization and restores it', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-fixtures-'));
    roots.push(root);
    const source = join(root, 'source');
    mkdirSync(join(source, 'nested'), { recursive: true });
    writeFileSync(
      join(source, 'users.json'),
      JSON.stringify({ email: 'alice@example.com', name: 'Alice', plan: 'pro' }),
    );
    writeFileSync(
      join(source, 'nested', 'orders.json'),
      JSON.stringify([{ customer_id: 'cus_1' }]),
    );
    const snapshot = runFixturesSnapshot({
      root,
      source: 'source',
      fixtureId: 'staging-sanitized',
      anonymize: true,
    });
    assert.equal(snapshot.ok, true);
    const anonymized = JSON.parse(
      readFileSync(
        join(root, '.aqa', 'fixtures', 'staging-sanitized', 'data', 'users.json'),
        'utf8',
      ),
    ) as Record<string, string>;
    assert.match(anonymized.email, /@example\.invalid$/u);
    assert.notEqual(anonymized.name, 'Alice');
    const restored = runFixturesRestore({
      root,
      fixture: '.aqa/fixtures/staging-sanitized',
      target: 'restored',
    });
    assert.equal(restored.ok, true);
    assert.equal(existsSync(join(root, 'restored', 'nested', 'orders.json')), true);
  });

  it('fails closed on tampered fixture data and refuses accidental overwrite', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-fixtures-tamper-'));
    roots.push(root);
    mkdirSync(join(root, 'source'), { recursive: true });
    writeFileSync(join(root, 'source', 'data.json'), '{"safe":true}\n');
    assert.equal(runFixturesSnapshot({ root, source: 'source', fixtureId: 'safe' }).ok, true);
    const dataPath = join(root, '.aqa', 'fixtures', 'safe', 'data', 'data.json');
    writeFileSync(dataPath, '{"safe":false}\n');
    const tampered = runFixturesRestore({ root, fixture: '.aqa/fixtures/safe', target: 'out' });
    assert.equal(tampered.ok, false);
    assert.match(tampered.error ?? '', /integrity mismatch/iu);
    writeFileSync(dataPath, '{"safe":true}\n');
    assert.equal(
      runFixturesRestore({ root, fixture: '.aqa/fixtures/safe', target: 'out' }).ok,
      true,
    );
    const overwrite = runFixturesRestore({ root, fixture: '.aqa/fixtures/safe', target: 'out' });
    assert.equal(overwrite.ok, false);
    assert.match(overwrite.error ?? '', /target exists/iu);
    const outside = runFixturesRestore({ root, fixture: '.aqa/fixtures/safe', target: '..' });
    assert.equal(outside.ok, false);
    assert.match(outside.error ?? '', /under project root/iu);
  });

  it('rejects unsupported or empty source trees', () => {
    const root = mkdtempSync(join(tmpdir(), 'aqa-fixtures-empty-'));
    roots.push(root);
    mkdirSync(join(root, 'source'), { recursive: true });
    writeFileSync(join(root, 'source', 'notes.txt'), 'not a fixture');
    const result = runFixturesSnapshot({ root, source: 'source' });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /no JSON/iu);
  });
});
