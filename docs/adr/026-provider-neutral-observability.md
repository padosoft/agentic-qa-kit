# ADR-026 — Provider-neutral observability boundary

## Status

Accepted — 2026-09-17

## Context

Enterprise runs need correlated traces, bounded Prometheus metrics and
structured redacted logs. Hard-coding an OTel SDK or cloud exporter into the
runner would make air-gapped and self-hosted deployments harder to operate,
while unbounded scenario/project labels can exhaust a metrics process.

## Decision

Add `@aqa/observability` with W3C `traceparent` parsing/formatting, injectable
span exporters, bounded counters/gauges/histograms, label-name validation and
cardinality limits, plus pre-write redacted JSON logging. `EventChainWriter`
accepts an optional non-blocking event observer; telemetry failures fail open
after the audit event is persisted. Deployments can bridge the primitives to
OTel Collector, Prometheus, Loki or another existing stack without a runtime
cloud dependency.

## Consequences

Trace and metric contracts are available to runner/server integrations and
are covered without network credentials. The package is not itself an OTel
Collector or durable metrics backend: production operators still configure
export, retention, sampling and dashboards, and must not use high-cardinality
IDs as metric labels.
