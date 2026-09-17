# ADR-166: Propagate trusted W3C trace context to HTTP probes

## Status

Accepted

## Context

The runner emits spans, but an HTTP target could lose correlation unless the
W3C `traceparent` header crossed the probe boundary. A scenario is test input,
not a trusted telemetry authority, and must not be able to forge that header.

## Decision

`makeHttpProbeRunner` accepts an optional `TraceContext`, formats it with the
shared W3C formatter and injects `traceparent` into every HTTP request. The
trusted value overwrites any scenario-provided header. If no trusted context is
configured, no header is synthesized.

## Evidence and boundary

Runner tests pass 25/25 locally. This proves header propagation and anti-spoof
precedence; Collector availability, reverse-proxy preservation and
runner/server/DB cross-process correlation remain deployment evidence.
