# ADR-181: Fail-closed LLM endpoint transport policy

## Context

LLM adapters already bound time, output size and evidence redaction, but each
provider accepted a configurable URL independently. A typo, credential-bearing
URL, plain-HTTP endpoint or literal private address could widen the egress
boundary without an explicit operator decision. Static URL checks cannot prove
DNS safety, so a network egress control remains required in production.

## Decision

All live LLM adapters call `assertEndpointAllowed()` before dispatch. By
default it requires HTTPS, rejects credentials/query/fragment components,
rejects localhost/private/link-local/metadata hostnames and literal private
IPs, and optionally enforces an exact or wildcard host allow-list. Local
models and private endpoints must set `allowPrivateNetwork: true`; this is an
explicit configuration signal, not an implicit provider default.

## Boundary

The policy is a synchronous configuration guard, not a replacement for a
container egress policy, DNS pinning/resolution control or service mesh. Those
layers must enforce the resolved destination and prevent DNS rebinding in a
production deployment. Fixture adapters remain network-free.
