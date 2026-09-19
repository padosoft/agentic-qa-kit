# ADR-281: Authenticated methodology publication API

## Status

Accepted — tenant-scoped read, durable proposal/approval and approval-bound
publication routes are shipped; admin review UI remains a follow-up slice.

## Decision

Expose methodology artifact revisions through the existing framework-agnostic
API boundary:

- `GET /api/methodology/artifacts` lists validated immutable revisions in the
  request tenant scope and supports an allowlisted artifact-kind filter.
- `GET /api/methodology/artifacts/:id/:revision` loads one revision with the
  same tenant fence.
- `POST /api/methodology/artifacts` requires `risk-map:edit`, authenticated
  identity, an envelope and the ID of an already-approved persisted proposal.
  The API verifies the envelope digest, proposal identity/kind/revision
  binding and approval freshness before persisting.
- `GET /api/methodology/proposals` lists tenant-scoped workflow records.
- `POST /api/methodology/proposals` persists a pending proposal only after
  binding it to the exact artifact envelope. Human proposals are bound to the
  authenticated proposer; agent proposals require the host-owned verifier.
- `POST /api/methodology/proposals/:id/approve` atomically transitions a
  pending proposal to approved and stores the approval record.
- Publication accepts only an already-approved proposal ID; it does not accept
  proposal/approval objects supplied ad hoc by the publishing request.

The API never accepts a bare payload as a published artifact. Without a
host-owned proposal verifier it fails closed; comparing two identities supplied
by the same request is not considered independent evidence. Same-revision
same-digest retries remain idempotent through the store; a different digest is
reported as a conflict.

## Consequences

The control-plane boundary cannot turn an unreviewed or cross-tenant artifact
into durable methodology evidence. The proposal and approval workflow now
survives process restarts in Postgres and is isolated by tenant. The admin
review console must still expose the pending queue, artifact diff,
approve/reject actions and complete browser journey.
