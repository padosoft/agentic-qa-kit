# ADR-148: Resolve webhook secrets through Vault KV-v2

## Status

Accepted

## Context

Durable webhook delivery must not persist provider credentials. A generic
resolver interface existed, but production guidance lacked a concrete,
auditable secret-manager implementation with token rotation and bounded
network behavior.

## Decision

Add `VaultSecretResolver` for Vault KV-v2. It resolves `secret_ref` lazily at
delivery time, obtains the Vault token from an injected async provider, requires
a credential-free HTTPS endpoint, rejects unsafe reference segments, enforces a
bounded timeout, and emits generic errors without response bodies or tokens.
Tests inject the fetcher; they never contact Vault or contain real credentials.

## Consequences

- The queue stores only an opaque reference and token rotation does not require
  rewriting queued deliveries.
- Vault availability becomes a delivery dependency and must be monitored.
- Other KMS or secret-manager integrations can implement the same resolver
  interface with equivalent redaction and timeout guarantees.
- Connection-time DNS/private-IP protections remain a transport/runtime
  responsibility and are not replaced by the resolver.
