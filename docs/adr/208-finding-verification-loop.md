# ADR-208: Finding fix-verification lifecycle

## Status

Accepted — 2026-09-18

## Context

The replay engine already reruns a scenario against its original failure
fingerprint, but a successful replay alone did not update the durable finding
state. That left the enterprise workflow between “fix submitted” and
“regression detected” as a manual, unaudited step.

## Decision

Findings may carry a bounded `last_verification` record. A tenant-scoped
`POST /api/findings/:id/verification` endpoint validates that record and the
store applies the transition atomically:

- deterministic `fixed` evidence moves an open finding to `fixed`;
- deterministic `reproduced` evidence moves `fixed` to `regressed`;
- reproduced evidence must include both the observed fingerprint and the
  original fingerprint, which must match the persisted finding;
- inconclusive or non-deterministic evidence is persisted but does not change
  status;
- every record is added to the hash-chained audit stream.

The endpoint records evidence; it does not pretend to execute a replay. The
CLI replay remains responsible for producing evidence from a real base URL or
an explicitly injected probe runner, and an external CI/PR integration remains
responsible for branch, merge and seven-day retest policy.

## Consequences

- Fix and regression transitions are durable and concurrency-safe in both
  MemoryStore and PostgreSQL.
- A fingerprint mismatch fails closed instead of allowing an unrelated failure
  to reopen a fixed finding.
- The lifecycle is now machine-readable for admin and external integrations;
  PR automation and scheduled retests remain separate deployment integrations.
