import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { verifyEventChainBrowser } from '../dist/audit-verify-browser.js';
import {
  CONTROL_MAPPINGS,
  assertRestoreDrillEvidence,
  backupInventorySha256,
  canonicalBackupInventory,
  controlsCoverage,
  createAuditCheckpoint,
  parseBackupInventory,
  parseEventLines,
  productionEvidenceCompleteness,
  productionEvidenceFreshness,
  signBackupInventory,
  signProductionEvidence,
  verifyAuditCheckpoint,
  verifyBackupInventory,
  verifyEventChain,
  verifyProductionEvidence,
} from '../dist/index.js';

const ZERO = '0'.repeat(64);

function canon(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
    .join(',')}}`;
}

function makeEvent(prev: string, body: Record<string, unknown>, index: number) {
  const rest = { ...body };
  const hash = createHash('sha256').update(prev).update(canon(rest)).digest('hex');
  return { prev_hash: index === 0 ? null : prev, ...rest, hash };
}

function makeCheckpointChain() {
  const first = makeEvent(ZERO, { run_id: 'run-checkpoint', seq: 0, kind: 'run.start' }, 0);
  const second = makeEvent(first.hash, { run_id: 'run-checkpoint', seq: 1, kind: 'run.end' }, 1);
  return [first, second];
}

const inventory = {
  schema_version: '1' as const,
  backup_id: 'backup-2026-09-17',
  created_at: '2026-09-17T10:00:00Z',
  database: {
    pitr_target: '2026-09-17T09:59:00Z',
    lsn: '0/16B6C50',
    schema_version: '2026.09.17',
  },
  artifacts: {
    snapshot_id: 'snapshot-2026-09-17',
    manifest_sha256: 'a'.repeat(64),
    object_count: 42,
  },
  application: {
    image_digest: `sha256:${'b'.repeat(64)}`,
    schema_version: '2026.09.17',
  },
  operator_run_id: 'drill-2026-09-17',
  objectives: { rpo_minutes: 15, rto_minutes: 60 },
};

describe('controls catalog', () => {
  it('every mapping has at least one SOC2 OR ISO control', () => {
    for (const m of CONTROL_MAPPINGS) {
      assert.ok(m.soc2.length > 0 || m.iso27001.length > 0, `${m.feature} has no controls`);
    }
  });

  it('covers the high-value SOC2 controls', () => {
    const cov = controlsCoverage();
    for (const c of ['CC6.1', 'CC7.1', 'CC8.1'] as const) {
      assert.ok(cov.soc2_covered.includes(c), `missing ${c}`);
    }
  });

  it('covers logging (A.8.15) and access control (A.5.15)', () => {
    const cov = controlsCoverage();
    assert.ok(cov.iso27001_covered.includes('A.8.15'));
    assert.ok(cov.iso27001_covered.includes('A.5.15'));
  });
});

describe('backup inventory contract', () => {
  it('parses, canonicalizes and hashes a redacted recovery inventory', () => {
    const parsed = parseBackupInventory(inventory);
    assert.deepEqual(parsed, inventory);
    assert.equal(canonicalBackupInventory(inventory).endsWith('\n'), true);
    assert.equal(backupInventorySha256(inventory).length, 64);
    assert.equal(
      backupInventorySha256(inventory),
      backupInventorySha256({ ...inventory, objectives: { ...inventory.objectives } }),
    );
  });

  it('rejects unsafe or unverifiable recovery metadata', () => {
    assert.throws(
      () => parseBackupInventory({ ...inventory, backup_id: '../secrets' }),
      /bounded identifier/,
    );
    assert.throws(
      () =>
        parseBackupInventory({
          ...inventory,
          artifacts: { ...inventory.artifacts, manifest_sha256: 'not-a-digest' },
        }),
      /SHA-256 digest/,
    );
    assert.throws(
      () =>
        parseBackupInventory({
          ...inventory,
          application: { ...inventory.application, image_digest: 'latest' },
        }),
      /image_digest/,
    );
    assert.throws(
      () => parseBackupInventory({ ...inventory, objectives: { rpo_minutes: 0, rto_minutes: 60 } }),
      /positive integer/,
    );
    assert.throws(
      () => parseBackupInventory({ ...inventory, signature: 'unsigned-metadata' }),
      /envelope keys are reserved/,
    );
  });

  it('signs and verifies the canonical inventory with an explicit trust root', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signBackupInventory(inventory, {
      key_id: 'dr-key-2026',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    assert.deepEqual(verifyBackupInventory(signed, publicKeyPem), { ok: true });
    assert.equal(verifyBackupInventory(signed).ok, false);
    assert.equal(
      verifyBackupInventory(
        { ...signed, inventory: { ...signed.inventory, operator_run_id: 'tampered' } },
        publicKeyPem,
      ).ok,
      false,
    );
  });
});

describe('restore drill evidence contract', () => {
  it('proves identity, objectives and security checks against the inventory', () => {
    const evidence = assertRestoreDrillEvidence(
      {
        schema_version: '1',
        drill_id: 'drill-1',
        source_backup_id: inventory.backup_id,
        source_manifest_sha256: inventory.artifacts.manifest_sha256,
        restored_manifest_sha256: inventory.artifacts.manifest_sha256,
        target_environment: 'recovery-cluster',
        started_at: '2026-09-17T10:00:00Z',
        completed_at: '2026-09-17T10:20:00Z',
        observed_rpo_minutes: 5,
        observed_rto_minutes: 20,
        checks: {
          tenant_isolation: true,
          audit_chain: true,
          queue_fencing: true,
          secret_redaction: true,
        },
      },
      inventory,
    );
    assert.equal(evidence.target_environment, 'recovery-cluster');
  });

  it('rejects drift, objective violations and incomplete controls', () => {
    const base = {
      schema_version: '1' as const,
      drill_id: 'drill-1',
      source_backup_id: inventory.backup_id,
      source_manifest_sha256: inventory.artifacts.manifest_sha256,
      restored_manifest_sha256: inventory.artifacts.manifest_sha256,
      target_environment: 'recovery-cluster',
      started_at: '2026-09-17T10:00:00Z',
      completed_at: '2026-09-17T10:20:00Z',
      observed_rpo_minutes: 5,
      observed_rto_minutes: 20,
      checks: {
        tenant_isolation: true,
        audit_chain: true,
        queue_fencing: true,
        secret_redaction: true,
      },
    };
    assert.throws(
      () =>
        assertRestoreDrillEvidence(
          { ...base, restored_manifest_sha256: 'b'.repeat(64) },
          inventory,
        ),
      /manifest changed/,
    );
    assert.throws(
      () =>
        assertRestoreDrillEvidence(
          { ...base, completed_at: '2026-09-17T11:01:00Z', observed_rto_minutes: 61 },
          inventory,
        ),
      /exceeded the approved RTO/,
    );
    assert.throws(
      () =>
        assertRestoreDrillEvidence(
          {
            ...base,
            completed_at: '2026-09-17T10:30:00Z',
            observed_rto_minutes: 20,
          },
          inventory,
        ),
      /observed RTO does not match/,
    );
    assert.throws(
      () =>
        assertRestoreDrillEvidence(
          { ...base, checks: { ...base.checks, queue_fencing: false } },
          inventory,
        ),
      /security checks are incomplete/,
    );
  });
});

describe('production evidence contract', () => {
  const evidence = {
    schema_version: '1' as const,
    evidence_id: 'prod-evidence-1',
    captured_at: '2026-09-18T10:00:00Z',
    environment: 'prod-eu-1',
    application_image_digest: `sha256:${'a'.repeat(64)}`,
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
        restore_drill_ref: 'drill-2026-q3',
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
  };

  it('signs, verifies and reports a complete provider observation set', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signProductionEvidence(evidence, {
      key_id: 'prod-evidence-key-1',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const result = verifyProductionEvidence(signed, publicKeyPem);
    assert.equal(result.ok, true);
    assert.deepEqual(result.completeness, { complete: true, missing: [] });
    assert.deepEqual(productionEvidenceCompleteness(evidence), { complete: true, missing: [] });
  });

  it('keeps incomplete controls explicit and rejects tampering', () => {
    const incomplete = {
      ...evidence,
      controls: {
        ...evidence.controls,
        identity: { ...evidence.controls.identity, mtls_verified: false },
      },
    };
    assert.deepEqual(productionEvidenceCompleteness(incomplete), {
      complete: false,
      missing: ['identity.mtls'],
    });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signProductionEvidence(evidence, {
      key_id: 'prod-evidence-key-1',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const tampered = { ...signed, evidence: { ...signed.evidence, environment: 'prod-us-1' } };
    assert.equal(
      verifyProductionEvidence(
        tampered,
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ).ok,
      false,
    );
  });

  it('enforces a bounded freshness budget without contacting providers', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    assert.equal(productionEvidenceFreshness(evidence, { now, max_age_hours: 4 }).fresh, true);
    const stale = { ...evidence, captured_at: '2026-09-17T12:00:00Z' };
    const staleResult = productionEvidenceFreshness(stale, { now, max_age_hours: 4 });
    assert.equal(staleResult.fresh, false);
    assert.equal(staleResult.reason, 'expired');
    const future = { ...evidence, captured_at: '2026-09-18T13:00:00Z' };
    assert.equal(
      productionEvidenceFreshness(future, { now, max_age_hours: 4 }).reason,
      'future-dated',
    );
    assert.throws(
      () => productionEvidenceFreshness(evidence, { now, max_age_hours: 8761 }),
      /at most 8760/,
    );
  });
});

describe('verifyEventChain', () => {
  it('accepts a well-formed 3-event chain', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    const e3 = makeEvent(e2.hash, { kind: 'run.end', t: 3 }, 2);
    const result = verifyEventChain([e1, e2, e3]);
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
  });

  it('rejects a tampered body', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    // mutate body without recomputing hash
    const tampered = { ...e2, kind: 'scenario-evil' };
    const result = verifyEventChain([e1, tampered]);
    assert.equal(result.ok, false);
    assert.equal(result.bad_index, 1);
  });

  it('rejects a broken prev_hash link', () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent('a'.repeat(64), { kind: 'scenario', t: 2 }, 1);
    const result = verifyEventChain([e1, e2]);
    assert.equal(result.ok, false);
    assert.equal(result.bad_index, 1);
  });
});

describe('parseEventLines', () => {
  it('parses one event per non-empty line', () => {
    const lines = `${JSON.stringify({ prev_hash: null, hash: 'x', a: 1 })}\n\n${JSON.stringify({ prev_hash: 'x', hash: 'y', a: 2 })}\n`;
    const events = parseEventLines(lines);
    assert.equal(events.length, 2);
  });
});

describe('audit checkpoints', () => {
  it('binds the complete event set and rejects truncation or replacement', () => {
    const events = makeCheckpointChain();
    const checkpoint = createAuditCheckpoint(events);
    assert.equal(verifyAuditCheckpoint(events, checkpoint).ok, true);
    assert.equal(verifyAuditCheckpoint(events.slice(0, 1), checkpoint).ok, false);
    assert.equal(verifyAuditCheckpoint([{ ...events[1], seq: 0 }], checkpoint).ok, false);
  });

  it('signs and verifies the checkpoint with an explicit trusted key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const events = makeCheckpointChain();
    const checkpoint = createAuditCheckpoint(events, {
      key_id: 'audit-key-1',
      private_key_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    assert.equal(
      verifyAuditCheckpoint(
        events,
        checkpoint,
        publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ).ok,
      true,
    );
    assert.equal(verifyAuditCheckpoint(events, checkpoint).ok, false);
  });
});

describe('verifyEventChainBrowser', () => {
  it('matches the node verifier and rejects partial or reordered chains', async () => {
    const e1 = makeEvent(ZERO, { kind: 'run.start', t: 1 }, 0);
    const e2 = makeEvent(e1.hash, { kind: 'scenario', t: 2 }, 1);
    const e3 = makeEvent(e2.hash, { kind: 'run.end', t: 3 }, 2);
    assert.equal((await verifyEventChainBrowser([e1, e2, e3])).ok, true);
    assert.equal((await verifyEventChainBrowser([e1, e2, e3], 2)).ok, true);
    assert.equal((await verifyEventChainBrowser([e2, e1])).ok, false);
    assert.equal((await verifyEventChainBrowser([e1, { ...e2, kind: 'altered' }])).bad_index, 1);
  });
});
