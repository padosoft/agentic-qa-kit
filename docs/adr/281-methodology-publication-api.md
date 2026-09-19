# ADR-281: Authenticated methodology publication API

## Status

Accepted — tenant-scoped read and approval-bound publication routes are shipped;
durable proposal workflow and admin review UI remain follow-up slices.

## Decision

Expose methodology artifact revisions through the existing framework-agnostic
API boundary:

- `GET /api/methodology/artifacts` lists validated immutable revisions in the
  request tenant scope and supports an allowlisted artifact-kind filter.
- `GET /api/methodology/artifacts/:id/:revision` loads one revision with the
  same tenant fence.
- `POST /api/methodology/artifacts` requires `risk-map:edit`, authenticated
  identity, an envelope, a proposal and an approval. The API verifies the
  envelope digest, proposal identity/kind/revision binding, independent
  reviewer rule, approval freshness, that `approved_by` is the authenticated
  user, and a host-owned proposal-origin verifier before persisting.

The API never accepts a bare payload as a published artifact. Without a
host-owned proposal verifier it fails closed; comparing two identities supplied
by the same request is not considered independent evidence. Same-revision
same-digest retries remain idempotent through the store; a different digest is
reported as a conflict.

## Consequences

The control-plane boundary cannot turn an unreviewed or cross-tenant artifact
into durable methodology evidence. The proposal and approval are currently
submitted together because the existing StoreProvider persists artifact
revisions, not workflow records. A production review console must add durable
proposal/approval records and an explicit pending-review lifecycle before
claiming a complete multi-step approval workflow.
