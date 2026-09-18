# 274 — Whitelisted journey correlation in OTLP spans

- **Status:** accepted
- **Date:** 2026-09-19
- **Deciders:** maintainers
- **Tags:** observability, stateful-qa, evidence, security

## Context

The runtime journey and OTLP exporter previously operated independently. Audit
events were exported as payload-free spans, so operators could not locate a
journey transition in a federated trace without copying business payloads into
telemetry. Copying the payload would create a secret/PII and high-cardinality
risk, while trace data must not become business-effect proof.

## Decision

Extend the audit-to-span observer with a strict allowlist of technical journey
attributes: safe slug IDs, a 64-character SHA-256 plan digest, transition
identity, actor identity, bounded state IDs and a boolean outcome. Reject all
other values before export. The hash-chained audit event remains authoritative;
OTLP spans are only a correlation index and diagnostic signal.

## Consequences

### Positive

- Journey transitions are searchable across collectors using stable technical
  identifiers.
- Secrets, URLs, PII and arbitrary provider payloads do not cross into spans.
- The evidence boundary remains explicit: trace presence never proves a durable
  commerce effect.

### Negative / trade-offs

- Operators cannot search telemetry by arbitrary business labels.
- A trace exporter may drop spans or sample them; the audit chain remains the
  source of truth and must be joined separately.

### Neutral / follow-ups

- Add a protected workflow that proves correlation against an operator-owned
  collector and the bounded OTLP federation parser.

## Alternatives considered

- **Export the complete event payload:** rejected for secret, PII and cardinality
  risk.
- **Use only `run_id`/`scenario_id`:** rejected because it cannot distinguish
  multiple state transitions in one journey.

## References

- ADR-272 — Bounded OTLP trace federation
- ADR-273 — Runtime execution for actor-bound stateful journeys
- `packages/observability/src/index.ts`
