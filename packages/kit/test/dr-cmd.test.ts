import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { signBackupInventory } from '@aqa/compliance';
import { runDrInventory, runDrRestore } from '../dist/commands/dr.js';

const inventory = {
  schema_version: '1' as const,
  backup_id: 'backup-2026-09-18',
  created_at: '2026-09-18T10:00:00Z',
  database: {
    pitr_target: '2026-09-18T09:55:00Z',
    lsn: '0/16B6C50',
    schema_version: '2026.09.18',
  },
  artifacts: {
    snapshot_id: 'snapshot-2026-09-18',
    manifest_sha256: 'a'.repeat(64),
    object_count: 42,
  },
  application: {
    image_digest: `sha256:${'b'.repeat(64)}`,
    schema_version: '2026.09.18',
  },
  operator_run_id: 'drill-2026-09-18',
  objectives: { rpo_minutes: 15, rto_minutes: 60 },
};

const restoreEvidence = {
  schema_version: '1' as const,
  drill_id: 'drill-2026-09-18',
  source_backup_id: inventory.backup_id,
  source_manifest_sha256: inventory.artifacts.manifest_sha256,
  restored_manifest_sha256: inventory.artifacts.manifest_sha256,
  target_environment: 'recovery-cluster',
  started_at: '2026-09-18T10:00:00Z',
  completed_at: '2026-09-18T10:20:00Z',
  observed_rpo_minutes: 5,
  observed_rto_minutes: 20,
  checks: {
    tenant_isolation: true,
    audit_chain: true,
    queue_fencing: true,
    secret_redaction: true,
  },
};

function tempFile(name: string, value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'aqa-dr-cmd-'));
  const path = join(root, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return path;
}

describe('aqa dr command boundary', () => {
  it('validates and hashes an unsigned backup inventory', () => {
    const result = runDrInventory({ inventoryFile: tempFile('inventory.json', inventory) });
    assert.equal(result.ok, true);
    assert.equal(result.backup_id, inventory.backup_id);
    assert.equal(result.inventory_sha256?.length, 64);
    assert.equal(result.signature, 'not_present');
  });

  it('verifies a signed backup inventory only with a trusted public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signBackupInventory(inventory, {
      key_id: 'dr-key-2026',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const inventoryFile = tempFile('signed-inventory.json', signed);
    const publicKeyFile = tempFile(
      'public.pem',
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );
    assert.equal(runDrInventory({ inventoryFile }).ok, false);
    const result = runDrInventory({ inventoryFile, publicKeyFile });
    assert.equal(result.ok, true);
    assert.equal(result.signature, 'verified');
  });

  it('validates restore drill evidence against the backup objectives', () => {
    const result = runDrRestore({
      inventoryFile: tempFile('inventory.json', inventory),
      evidenceFile: tempFile('restore.json', restoreEvidence),
    });
    assert.equal(result.ok, true);
    assert.equal(result.drill_id, restoreEvidence.drill_id);
    assert.equal(result.observed_rto_minutes, 20);
  });

  it('rejects restore drill evidence that violates recovery objectives', () => {
    const result = runDrRestore({
      inventoryFile: tempFile('inventory.json', inventory),
      evidenceFile: tempFile('restore.json', {
        ...restoreEvidence,
        completed_at: '2026-09-18T11:01:00Z',
        observed_rto_minutes: 61,
      }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /RTO/);
  });

  it('rejects restore drill evidence whose declared RTO disagrees with timestamps', () => {
    const result = runDrRestore({
      inventoryFile: tempFile('inventory.json', inventory),
      evidenceFile: tempFile('restore.json', {
        ...restoreEvidence,
        completed_at: '2026-09-18T11:00:00Z',
        observed_rto_minutes: 20,
      }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /observed RTO/);
  });
});
