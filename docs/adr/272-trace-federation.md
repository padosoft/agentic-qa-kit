# 272 — Bounded OTLP trace federation

- **Status:** accepted
- **Date:** 2026-09-19
- **Deciders:** maintainers
- **Tags:** observability, security, evidence, agentic-qa

## Context

Stateful journeys may emit traces through multiple collectors or runners. A
single raw exporter payload is not a safe evidence format: it can contain
credentials, URLs, unbounded attributes and duplicate or contradictory spans.
Telemetry also cannot prove that a business mutation was durably committed.

## Decision

Add a bounded OTLP/HTTP JSON normalizer and deterministic federation contract
to `@aqa/ingest`. The normalizer validates IDs and time ranges, limits spans
and attributes, retains primitive metadata, redacts credential-like keys and
URLs, and accepts OTLP's optional status. Federation groups by trace ID,
deduplicates equal span content across sources, and reports orphan parents and
conflicting observations. The result is diagnostic telemetry and must be
joined to signed application evidence by a separate policy boundary.

## Consequences

### Positive

- Trace data can be correlated across Playwright, API and worker collectors.
- Sensitive metadata is removed before normalized artifacts are serialized.
- Conflicts and incomplete parent graphs remain visible.
- Bounds and deterministic ordering reduce memory and replay risk.

### Negative / trade-offs

- URL redaction and key matching are conservative and may lose context.
- Sampling, clock skew, exporter integrity and provider retention are not solved
  by this package.
- Production execution and provenance binding require protected workflows.

### Neutral / follow-ups

- Runtime journey execution should attach trace correlation IDs without making
  telemetry authoritative.
- OTLP protobuf may be added only with equivalent redaction and bounds.

## Alternatives considered

- **Store raw OTLP payloads:** rejected because it expands secret and retention
  risk and makes deterministic comparison difficult.
- **Use trace presence as business proof:** rejected because sampled telemetry
  cannot prove durable side effects, ordering or settlement.

## References

- `packages/ingest/src/trace-federation.ts`
- `packages/ingest/test/trace-federation.test.ts`
- ADR-268 — Stateful journey graph
