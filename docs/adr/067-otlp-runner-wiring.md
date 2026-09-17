# ADR-067 — OTLP wiring at the runner boundary

## Status

Accepted — 2026-09-17

## Decision

`aqa run` accepts an explicit `otlpEndpoint` option and the CLI exposes it as
`--otlp-endpoint`, with `AQA_OTLP_ENDPOINT` as the environment fallback. Each
audit event emits a bounded span containing only event kind, sequence, actor
type and optional scenario/finding identifiers. The exporter is drained before
the command returns; delivery failures are surfaced as warnings and do not
change the persisted audit result.

## Rationale

Observability must correlate with the same run/event lifecycle that auditors
inspect, while telemetry must not become a second mutable source of truth or
leak arbitrary event payloads. Wiring at `EventChainWriter` preserves both
properties and gives operators a real process-exit delivery contract.

## Evidence and limits

The kit complete-journey test runs a real temporary project against a local
HTTP OTLP fixture and asserts a batch is received before `runRun` returns.
Collector deployment, authentication headers, dashboards and alert rules are
still deployment-level work; no hosted Collector availability is claimed.
