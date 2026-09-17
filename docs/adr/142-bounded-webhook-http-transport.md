# ADR-142: Bounded outbound webhook HTTP transport

**Status:** Accepted  
**Date:** 2026-09-17

## Decision

Ship an injectable `HttpWebhookTransport` that rechecks the HTTPS origin
allowlist at send time, disables redirects, cancels requests after a bounded
timeout, reads response streams incrementally under a byte cap and parses
bounded `Retry-After` values.
Transport responses contain only status and retry delay for the queue.

## Security boundary

This transport prevents redirect-based allowlist bypasses and unbounded
response allocation/work. It does not claim DNS rebinding or private-IP protection because
portable `fetch` does not expose the resolved connection address. Production
deployments must use a connection-aware egress proxy/agent that pins or
validates DNS results and rejects loopback, private, link-local and metadata
service addresses.
