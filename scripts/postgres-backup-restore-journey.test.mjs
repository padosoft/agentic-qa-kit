import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestRows, quoteIdentifier } from './postgres-backup-restore-journey.mjs';

test('backup journey quotes only bounded generated identifiers', () => {
  assert.equal(quoteIdentifier('aqa_restore_canary_abc123'), '"aqa_restore_canary_abc123"');
  assert.throws(() => quoteIdentifier('bad-name'), /unsafe/);
  assert.throws(() => quoteIdentifier('"; DROP DATABASE postgres;--'), /unsafe/);
});

test('backup journey digest is deterministic and order-sensitive only after canonical ordering', () => {
  const rows = [
    { id: 1, value: 'tenant-a', digest: 'a' },
    { id: 2, value: 'tenant-b', digest: 'b' },
  ];
  assert.equal(digestRows(rows), digestRows(rows.map((row) => ({ ...row }))));
  assert.notEqual(digestRows(rows), digestRows([{ ...rows[0], value: 'tampered' }, rows[1]]));
});
