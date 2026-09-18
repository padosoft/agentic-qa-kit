import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  restoreDrillEvidenceSha256,
  signBackupInventory,
  signProductionEvidence,
} from '@aqa/compliance';
import { runDrInventory, runDrReleaseGate, runDrRestore } from '../dist/commands/dr.js';

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

  it('rejects an unsigned inventory that uses signed-envelope keys', () => {
    const result = runDrInventory({
      inventoryFile: tempFile('inventory-with-envelope-key.json', {
        ...inventory,
        signature: 'unsigned-metadata',
      }),
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /requires --public-key/);
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

  it('verifies the production evidence release gate against the exact drill digest', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyFile = tempFile(
      'public.pem',
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );
    const productionEvidence = signProductionEvidence(
      {
        schema_version: '1',
        evidence_id: 'prod-evidence-2026-q3-eu',
        captured_at: '2026-09-18T10:00:00Z',
        environment: 'prod-eu-1',
        application_image_digest: `sha256:${'b'.repeat(64)}`,
        controls: {
          key_custody: {
            provider: 'vault',
            key_ref: 'transit/aqa-audit',
            rotation_verified: true,
            observed_at: '2026-09-18T09:00:00Z',
          },
          artifact_immutability: {
            provider: 's3-object-lock',
            store_ref: 'aqa-prod-eu-artifacts',
            versioning_enabled: true,
            retention_verified: true,
            observed_at: '2026-09-18T09:05:00Z',
          },
          database_recovery: {
            provider: 'postgresql',
            cluster_ref: 'aqa-prod-eu-db',
            pitr_enabled: true,
            wal_archiving_verified: true,
            restore_drill_ref: restoreEvidence.drill_id,
            restore_drill_sha256: restoreDrillEvidenceSha256(restoreEvidence, inventory),
            observed_at: '2026-09-18T09:10:00Z',
          },
          identity: {
            provider: 'corp-idp',
            oidc_verified: true,
            mtls_verified: true,
            runner_rotation_verified: true,
            observed_at: '2026-09-18T09:15:00Z',
          },
        },
      },
      { key_id: 'production-evidence-key-2026', private_key_pem: privateKeyPem },
    );
    const result = runDrReleaseGate({
      inventoryFile: tempFile('inventory.json', inventory),
      evidenceFile: tempFile('restore.json', restoreEvidence),
      productionEvidenceFile: tempFile('production-evidence.json', productionEvidence),
      publicKeyFile,
      publicKeyId: 'production-evidence-key-2026',
    });
    assert.equal(result.ok, true);
    assert.equal(result.production_signature, 'verified');
    assert.equal(result.restore_drill_sha256?.length, 64);
  });

  it('fails the release gate when production evidence points to another drill', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const productionEvidence = signProductionEvidence(
      {
        schema_version: '1',
        evidence_id: 'prod-evidence-2026-q3-eu',
        captured_at: '2026-09-18T10:00:00Z',
        environment: 'prod-eu-1',
        application_image_digest: `sha256:${'b'.repeat(64)}`,
        controls: {
          key_custody: {
            provider: 'vault',
            key_ref: 'transit/aqa-audit',
            rotation_verified: true,
            observed_at: '2026-09-18T09:00:00Z',
          },
          artifact_immutability: {
            provider: 's3-object-lock',
            store_ref: 'aqa-prod-eu-artifacts',
            versioning_enabled: true,
            retention_verified: true,
            observed_at: '2026-09-18T09:05:00Z',
          },
          database_recovery: {
            provider: 'postgresql',
            cluster_ref: 'aqa-prod-eu-db',
            pitr_enabled: true,
            wal_archiving_verified: true,
            restore_drill_ref: 'different-drill',
            restore_drill_sha256: 'c'.repeat(64),
            observed_at: '2026-09-18T09:10:00Z',
          },
          identity: {
            provider: 'corp-idp',
            oidc_verified: true,
            mtls_verified: true,
            runner_rotation_verified: true,
            observed_at: '2026-09-18T09:15:00Z',
          },
        },
      },
      {
        key_id: 'production-evidence-key-2026',
        private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
    );
    const result = runDrReleaseGate({
      inventoryFile: tempFile('inventory.json', inventory),
      evidenceFile: tempFile('restore.json', restoreEvidence),
      productionEvidenceFile: tempFile('production-evidence.json', productionEvidence),
      publicKeyFile: tempFile(
        'public.pem',
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ),
      publicKeyId: 'production-evidence-key-2026',
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /restore drill reference/);
  });
});
