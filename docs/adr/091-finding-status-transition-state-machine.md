# ADR-091 — Finding status transition state machine

## Status

Accepted — 2026-09-17

## Decision

Finding status changes use a shared transition matrix in `@aqa/schemas`.
The API validates the candidate and maps illegal/no-op changes to `409`, while
Memory and PostgreSQL stores re-check the current state immediately before
mutation and audit append. The resulting finding is schema-parsed at the
write boundary.

## Rationale

The API is not the only caller and a prior read can race with another status
change. Persistence must reject stale or impossible transitions atomically and
must not emit an audit event for a rejected mutation.

## Limits

The current matrix supports reopening rejected/duplicate/fixed findings to
draft and the existing operational review flows. Approval policy, required
roles per transition and evidence attestation remain separate authorization
controls.
