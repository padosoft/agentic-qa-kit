import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  approveMethodologyProposal,
  assertMethodologyApproval,
  createMethodologyProposal,
  methodologyArtifactSha256,
  parseMethodologyApproval,
  parseMethodologyProposal,
  rejectMethodologyProposal,
} from '../dist/index.js';

const artifact = { risks: [{ id: 'r-1', severity: 'high' }], version: 1 };

function proposal() {
  return createMethodologyProposal({
    proposal_id: 'proposal-1',
    artifact_kind: 'risk_map',
    artifact_id: 'risk-map-shop',
    artifact,
    revision: 2,
    proposed_by: 'agent-a',
    proposed_at: '2026-09-19T10:00:00.000Z',
    source: 'agent',
  });
}

function approval(p = proposal()) {
  return {
    schema_version: '1' as const,
    approval_id: 'approval-1',
    proposal_id: p.proposal_id,
    artifact_sha256: p.artifact_sha256,
    revision: p.revision,
    approved_by: 'operator-a',
    approved_at: '2026-09-19T10:01:00.000Z',
    expires_at: '2026-09-20T10:01:00.000Z',
  };
}

describe('methodology governance', () => {
  it('binds proposals to a deterministic artifact digest independent of key order', () => {
    assert.equal(
      methodologyArtifactSha256({ b: 2, a: 1 }),
      methodologyArtifactSha256({ a: 1, b: 2 }),
    );
    assert.match(proposal().artifact_sha256, /^[a-f0-9]{64}$/u);
  });

  it('requires an independent human approval for an agent proposal', () => {
    const p = proposal();
    const result = approveMethodologyProposal(p, approval(p), new Date('2026-09-19T12:00:00.000Z'));
    assert.equal(result.proposal.status, 'approved');
    assert.doesNotThrow(() =>
      assertMethodologyApproval(
        result.proposal,
        result.approval,
        new Date('2026-09-19T12:00:00.000Z'),
      ),
    );
    assert.throws(
      () => approveMethodologyProposal(p, { ...approval(p), approved_by: 'agent-a' }),
      /independent reviewer/,
    );
  });

  it('fails closed on stale, mismatched or expired approvals', () => {
    const p = proposal();
    assert.throws(
      () => approveMethodologyProposal(p, { ...approval(p), revision: 1 }),
      /revision mismatch/,
    );
    assert.throws(
      () => approveMethodologyProposal(p, { ...approval(p), artifact_sha256: '0'.repeat(64) }),
      /digest mismatch/,
    );
    const approved = approveMethodologyProposal(
      p,
      approval(p),
      new Date('2026-09-19T12:00:00.000Z'),
    );
    assert.throws(
      () =>
        assertMethodologyApproval(
          approved.proposal,
          approved.approval,
          new Date('2026-09-21T00:00:00.000Z'),
        ),
      /expired/,
    );
  });

  it('bounds untrusted artifacts before hashing', () => {
    assert.throws(() => methodologyArtifactSha256({ value: Number.NaN }), /non-finite/);
  });

  it('rejects runtime-invalid enums and non-canonical timestamps', () => {
    assert.throws(
      () =>
        createMethodologyProposal({
          proposal_id: 'proposal-1',
          artifact_kind: 'unknown' as never,
          artifact_id: 'risk-map-shop',
          artifact,
          revision: 1,
          proposed_by: 'agent-a',
          proposed_at: '2026-09-19T10:00:00Z',
          source: 'agent',
        }),
      /artifact kind is invalid/,
    );
    assert.throws(
      () => createMethodologyProposal({ ...proposalInput(), proposed_at: '2026-09-19' }),
      /canonical UTC timestamp/,
    );
  });

  it('rejects an approval whose expiry has passed at issuance time', () => {
    const p = proposal();
    assert.throws(
      () =>
        approveMethodologyProposal(
          p,
          { ...approval(p), expires_at: '2026-09-19T11:00:00.000Z' },
          new Date('2026-09-19T12:00:00.000Z'),
        ),
      /already expired/,
    );
  });

  it('rejects malformed or extended governance records at the JSON boundary', () => {
    const p = proposal();
    assert.deepEqual(parseMethodologyProposal(p), p);
    assert.deepEqual(parseMethodologyApproval(approval(p)), approval(p));
    assert.throws(() => parseMethodologyProposal({ ...p, proposal_id: null }), /must be a string/);
    assert.throws(
      () => parseMethodologyApproval({ ...approval(p), expires_at: null }),
      /expires_at must be a string/,
    );
    assert.throws(() => parseMethodologyProposal({ ...p, untrusted: 'secret' }), /unknown field/);
  });

  it('requires a reasoned independent rejection and preserves the decision binding', () => {
    const p = proposal();
    const rejection = {
      schema_version: '1' as const,
      rejection_id: 'rejection-1',
      proposal_id: p.proposal_id,
      rejected_by: 'operator-a',
      rejected_at: '2026-09-19T10:02:00.000Z',
      reason: 'The generated risk map omits the payment provider callback invariant.',
    };
    const result = rejectMethodologyProposal(p, rejection, new Date('2026-09-19T12:00:00.000Z'));
    assert.equal(result.proposal.status, 'rejected');
    assert.deepEqual(result.rejection, rejection);
    assert.throws(
      () => rejectMethodologyProposal(p, { ...rejection, reason: ' ' }),
      /reason is invalid/,
    );
    assert.throws(
      () => rejectMethodologyProposal(p, { ...rejection, rejected_by: p.proposed_by }),
      /independent reviewer/,
    );
  });
});

function proposalInput() {
  return {
    proposal_id: 'proposal-1',
    artifact_kind: 'risk_map' as const,
    artifact_id: 'risk-map-shop',
    artifact,
    revision: 2,
    proposed_by: 'agent-a',
    proposed_at: '2026-09-19T10:00:00.000Z',
    source: 'agent' as const,
  };
}
