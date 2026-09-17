# ADR-060 — OTLP exporter lifecycle

## Status

Accepted — 2026-09-17

## Decision

`OtlpHttpSpanExporter` exposes a bounded lifecycle: `startAutoFlush()` starts a
timer whose failures retain queued spans, `stopAutoFlush()` cancels it, and
`shutdown()` stops the timer and drains a finite number of batches. Concurrent
flush calls share one in-flight operation, preventing duplicate or racing
delivery.

## Rationale

Telemetry must be best-effort relative to audit truth, but “best effort” cannot
mean silent loss during normal process shutdown. The lifecycle is explicit so
server/runner boot code can choose when to start and stop delivery and can
surface a Collector outage without corrupting QA evidence.

## Evidence and limits

Unit tests cover concurrent flush serialization, retry preservation, auto-flush
validation and shutdown drain. Wiring into server/runner signal handlers and a
deployed Collector remain required for production readiness.
