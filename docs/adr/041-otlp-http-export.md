# ADR-041: Bounded OTLP/HTTP trace export

## Status

Accepted — exporter contract shipped; Collector deployment wiring remains open.

## Decision

`@aqa/observability` provides `OtlpHttpSpanExporter` for OTLP/HTTP JSON. It
queues a bounded number of spans, batches them on explicit `flush()`, redacts
sensitive attribute keys and bearer/AWS key patterns, and restores a failed
batch to the bounded queue for retry. Span creation/end stays synchronous.

## Consequences

Applications can connect AQA traces to an OpenTelemetry Collector without a
vendor SDK dependency. The queue is telemetry-only and may drop the oldest
spans at capacity; hash-chained audit events remain authoritative. Production
still needs timer/shutdown wiring, Collector configuration, metrics export and
an operational trace-loss policy.
