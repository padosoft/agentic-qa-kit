# ADR-271: Protected reusable mutation evidence workflow

## Status

Accepted

## Context

Mutation tools differ by language and build system. Running arbitrary commands
from a report-gate workflow would create a supply-chain and secret-boundary
problem, while a library-only parser leaves operators without a repeatable
protected release path.

## Decision

Provide a reusable GitHub workflow that accepts producer-uploaded report and
reviewed manifest artifacts, runs in a protected Environment, validates bounded
relative paths, invokes the fixed AQA coverage gate and uploads only its
bounded redacted log. The caller owns mutation-tool execution and must bind the
artifacts to the source revision and tool configuration.

## Consequences

The workflow is safe to compose with Stryker, mutmut or another independently
controlled producer and makes the release boundary explicit. It does not claim
that a producer artifact is genuine, complete or representative until the
protected workflow has actually run and its provenance has been reviewed.
