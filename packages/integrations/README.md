# `@aqa/integrations`

Provider-neutral outbound delivery primitives for enterprise integrations.

## Features

- bounded exponential retry with `Retry-After` support;
- HMAC-SHA256 signatures and stable delivery IDs;
- per-integration rate limiting hook;
- explicit dead-letter queue state after five attempts;
- injectable transport, so tests never call a real vendor;
- PostgreSQL queue with atomic `SKIP LOCKED` claims and operator redrive;
- mandatory HTTPS destination-origin allowlisting for the durable queue;
- redacted audit observer hooks for Prometheus/OTel/log adapters.
- bounded HTTP transport with timeout, no redirects and `Retry-After` parsing.
- lazy `VaultSecretResolver` support for Vault KV-v2 without persisting tokens.
- Node `NodePinnedHttpsWebhookTransport` for one-shot DNS resolution, TLS SNI
  pinning and private/link-local address rejection at connection time.

## Setup

1. From the repository root run `bun install`.
2. Import `MemoryWebhookQueue` for local development and tests.
3. Enqueue a tenant-scoped `WebhookRequest` with a secret from a secret
   manager, never from committed configuration.
4. Run `bun run --filter @aqa/integrations test`.

For production, use `PostgresWebhookQueue` with `VaultSecretResolver` or an
equivalent audited KMS/secret-manager adapter. Only `secret_ref` is persisted;
the secret itself is resolved inside the worker and is never written to the queue.
Both implementations
require audit metrics, destination allowlisting and an authenticated operator
workflow for DLQ redrive.
The transport layer must additionally enforce DNS rebinding and private/link-local
IP protections at connection time.

The optional observer receives only delivery metadata (`attempt`/`outcome`,
tenant, integration, stable ID, attempt number and HTTP status). It never
receives the URL, payload, secret or secret reference.

`HttpWebhookTransport` is safe against redirect-based destination changes and
limits response handling. For direct Node egress, use
`NodePinnedHttpsWebhookTransport`: it resolves all answers once, rejects a
private/local answer in the set, and connects to a selected IP while retaining
the original hostname for TLS SNI and `Host`. A service-mesh egress proxy may
provide the equivalent connection-time policy for other runtimes.
