# ADR-249: Generate restore-drill timing from the operation

## Status

Accepted

## Context

Restore evidence contains an RTO and timestamps, but accepting caller-supplied
timing makes it easy for a wrapper to report a value unrelated to the actual
restore operation. The evidence verifier can validate consistency, but it
cannot know how the fields were produced.

## Decision

`@aqa/compliance` exposes `measureRestoreDrill(operation, now?)`. It records
the start before invoking the operation, records completion only after the
operation resolves, computes the ceiling in minutes and propagates failures.
The optional clock exists only for deterministic tests; production callers use
the default clock.

## Consequences

Restore runners can produce internally measured timing without hand-built
timestamps. The helper still does not prove that the callback used a cloud
PITR, KMS, WORM or artifact provider; provider-specific evidence must remain
attached to the same drill.
