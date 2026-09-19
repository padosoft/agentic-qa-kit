import { describe, expect, it } from 'bun:test';
import {
  archiveMethodologyArtifactLifecycle,
  createMethodologyArtifactLifecycle,
  isMethodologyArtifactExpired,
  parseMethodologyArtifactLifecycle,
  setMethodologyArtifactLegalHold,
} from '../src/index.js';

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
    expect(lifecycle.state).toBe('active');
    expect(lifecycle.archive_after).toBe('2026-09-26T10:00:00.000Z');
    expect(lifecycle.retained_until).toBe('2026-10-19T10:00:00.000Z');
    expect(isMethodologyArtifactExpired(lifecycle, '2026-10-18T23:59:59.999Z')).toBe(false);
    expect(isMethodologyArtifactExpired(lifecycle, '2026-10-19T10:00:00.000Z')).toBe(true);
  });

  it('archives with an operator reason and blocks archive under legal hold', () => {
    const lifecycle = createMethodologyArtifactLifecycle(input);
    const held = setMethodologyArtifactLegalHold(lifecycle, {
      now: '2026-09-20T10:00:00.000Z',
      updated_by: 'legal-1',
      enabled: true,
      reason: 'Customer litigation hold',
    });
    expect(() =>
      archiveMethodologyArtifactLifecycle(held, {
        now: '2026-09-21T10:00:00.000Z',
        updated_by: 'reviewer-1',
        reason: 'Cleanup',
      }),
    ).toThrow('legal hold');
    const released = setMethodologyArtifactLegalHold(held, {
      now: '2026-09-22T10:00:00.000Z',
      updated_by: 'legal-1',
      enabled: false,
      reason: 'Hold released',
    });
    expect(
      archiveMethodologyArtifactLifecycle(released, {
        now: '2026-09-23T10:00:00.000Z',
        updated_by: 'reviewer-1',
        reason: 'Superseded by revision 3',
      }).state,
    ).toBe('archived');
  });

  it('rejects invalid retention and unknown persisted fields', () => {
    expect(() =>
      createMethodologyArtifactLifecycle({ ...input, archive_after_days: 31 }),
    ).toThrow();
    expect(() =>
      parseMethodologyArtifactLifecycle({
        ...createMethodologyArtifactLifecycle(input),
        extra: true,
      }),
    ).toThrow('unknown field');
  });
});
