# ADR-277: Bind mutation regression evidence to the workflow revision

## Context

Mutation regression evidence includes a `source_revision`, but a parser cannot
trust that field merely because it is present. Without an authoritative
comparison, a producer can accidentally upload observations from another
commit and still satisfy the report/manifest gate.

## Decision

The protected reusable workflow passes its immutable `${{ github.sha }}` to the
CLI. `aqa mutation regression --source-revision` rejects evidence whose
declared revision differs. Programmatic callers may supply the same expected
revision through `runMutationRegressionGate`; local development can omit it
explicitly, while protected release use must provide it.

## Consequences

The gate now proves commit alignment in addition to pair completeness and
outcome consistency. It still does not prove that the producer itself was
trusted or that a provider executed the run; those remain protected job and
deployment responsibilities.
