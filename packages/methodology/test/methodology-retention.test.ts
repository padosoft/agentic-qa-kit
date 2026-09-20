import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  archiveMethodologyArtifactLifecycle,
  createMethodologyArtifactLifecycle,
  isMethodologyArtifactExpired,
  parseMethodologyArtifactLifecycle,
  setMethodologyArtifactLegalHold,
} from '../dist/index.js';

const input = {
  artifact_kind: 'risk_map' as const,
  artifact_id: 'checkout-map',
  revision: 2,
  now: '2026-09-19T10:00:00.000Z',
  updated_by: 'reviewer-1',
  retention_days: 30,
  archive_after_days: 7,
};

describe('methodology retention lifecycle', () => {
  it('creates a bounded lifecycle and expires only after retention', () => {
    const lifecycle = createMethodologyArtifactLifecycle(input);
    assert.equal(lifecycle.state, 'active');
    assert.equal(lifecycle.archive_after, '2026-09-26T10:00:00.000Z');
    assert.equal(lifecycle.retained_until, '2026-10-19T10:00:00.000Z');
    assert.equal(isMethodologyArtifactExpired(lifecycle, '2026-10-18T23:59:59.999Z'), false);
    assert.equal(isMethodologyArtifactExpired(lifecycle, '2026-10-19T10:00:00.000Z'), true);
  });

  it('archives with an operator reason and blocks archive under legal hold', () => {
    const lifecycle = createMethodologyArtifactLifecycle(input);
    const held = setMethodologyArtifactLegalHold(lifecycle, {
      now: '2026-09-20T10:00:00.000Z',
      updated_by: 'legal-1',
      enabled: true,
      reason: 'Customer litigation hold',
    });
    assert.throws(
      () =>
        archiveMethodologyArtifactLifecycle(held, {
          now: '2026-09-21T10:00:00.000Z',
          updated_by: 'reviewer-1',
          reason: 'Cleanup',
        }),
      /legal hold/,
    );
    const released = setMethodologyArtifactLegalHold(held, {
      now: '2026-09-22T10:00:00.000Z',
      updated_by: 'legal-1',
      enabled: false,
      reason: 'Hold released',
    });
    assert.equal(
      archiveMethodologyArtifactLifecycle(released, {
        now: '2026-09-23T10:00:00.000Z',
        updated_by: 'reviewer-1',
        reason: 'Superseded by revision 3',
      }).state,
      'archived',
    );
  });

  it('rejects invalid retention and unknown persisted fields', () => {
    assert.throws(() => createMethodologyArtifactLifecycle({ ...input, archive_after_days: 31 }));
    assert.throws(
      () =>
        parseMethodologyArtifactLifecycle({
          ...createMethodologyArtifactLifecycle(input),
          extra: true,
        }),
      /unknown field/,
    );
    assert.throws(
      () =>
        setMethodologyArtifactLegalHold(createMethodologyArtifactLifecycle(input), {
          now: input.now,
          updated_by: input.updated_by,
          enabled: true,
          reason: 'authorization=secret',
        }),
      /sensitive data/,
    );
  });
});
