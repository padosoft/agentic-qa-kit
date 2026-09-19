import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMethodologyArtifactEnvelope,
  parseMethodologyArtifactEnvelope,
  serializeMethodologyArtifactEnvelope,
} from '../dist/index.js';

const tree = {
  id: 'attack-checkout',
  kind: 'node' as const,
  operator: 'any' as const,
  children: [
    { id: 'checkout-payment', kind: 'leaf' as const, statement: 'Payment is captured twice' },
  ],
};

describe('methodology artifact envelope', () => {
  it('round-trips a validated attack tree with a stable content digest', () => {
    const envelope = createMethodologyArtifactEnvelope({
      artifact_kind: 'attack_tree',
      artifact_id: 'checkout-tree',
      revision: 3,
      created_at: '2026-09-19T13:00:00.000Z',
      payload: tree,
    });
    const restored = parseMethodologyArtifactEnvelope(
      serializeMethodologyArtifactEnvelope(envelope),
    );
    assert.deepEqual(restored.payload, tree);
    assert.equal(restored.artifact_sha256, envelope.artifact_sha256);
  });

  it('rejects payload tampering and unsupported schema versions', () => {
    const envelope = createMethodologyArtifactEnvelope({
      artifact_kind: 'attack_tree',
      artifact_id: 'checkout-tree',
      revision: 1,
      created_at: '2026-09-19T13:00:00.000Z',
      payload: tree,
    });
    assert.throws(
      () =>
        parseMethodologyArtifactEnvelope(
          JSON.stringify({ ...envelope, payload: { ...tree, id: 'tampered' } }),
        ),
      /digest mismatch/,
    );
    assert.throws(
      () => parseMethodologyArtifactEnvelope(JSON.stringify({ ...envelope, schema_version: '2' })),
      /schema version/,
    );
  });

  it('rejects malformed attack-tree payloads before persistence', () => {
    assert.throws(
      () =>
        createMethodologyArtifactEnvelope({
          artifact_kind: 'attack_tree',
          artifact_id: 'checkout-tree',
          revision: 1,
          created_at: '2026-09-19T13:00:00.000Z',
          payload: { ...tree, children: [] },
        }),
      /1..16 children/,
    );
  });

  it('rejects payloads that shared DLP would redact', () => {
    assert.throws(
      () =>
        createMethodologyArtifactEnvelope({
          artifact_kind: 'attack_tree',
          artifact_id: 'checkout-tree',
          revision: 1,
          created_at: '2026-09-19T13:00:00.000Z',
          payload: {
            ...tree,
            children: [
              {
                id: 'checkout-payment',
                kind: 'leaf',
                statement: 'token=super-secret-value-123',
              },
            ],
          },
        }),
      /contains sensitive data/,
    );
  });
});
