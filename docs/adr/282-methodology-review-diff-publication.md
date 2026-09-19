# ADR-282: Methodology review diff and publication boundary

## Status

Accepted — 2026-09-19

## Context

The methodology review workspace could inspect and approve a staged proposal,
but reviewers could not compare it with the preceding published revision or
complete the approved publication journey from the UI. A client-side preview
must not be mistaken for durable history, and a browser must not be allowed to
mutate an unapproved or digest-mismatched artifact.

## Decision

- For revision `N > 1`, the live admin loads revision `N-1` through the
  tenant-scoped artifact endpoint and shows an explicit unavailable state when
  that revision is absent. Revision 1 has no previous revision.
- The publish action is rendered only for an approved proposal and posts the
  exact staged envelope returned by the proposal detail endpoint together with
  its proposal ID to the existing approval-bound publication route.
- Mock mode stays read-only. The server remains authoritative for approval,
  digest, revision, tenant and idempotency checks.

## Consequences

Reviewers get a complete local control-plane journey without weakening the
human gate. The browser test proves request binding and UI behavior, but does
not claim real provider authentication or production retention evidence.

