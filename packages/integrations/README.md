# `@aqa/integrations`

Provider-neutral outbound delivery primitives for enterprise integrations.

## Features

- bounded exponential retry with `Retry-After` support;
- HMAC-SHA256 signatures and stable delivery IDs;
- per-integration rate limiting hook;
- explicit dead-letter queue state after five attempts;
- injectable transport, so tests never call a real vendor;
- PostgreSQL queue with atomic `SKIP LOCKED` claims and operator redrive.

## Setup

1. From the repository root run `bun install`.
2. Import `MemoryWebhookQueue` for local development and tests.
3. Enqueue a tenant-scoped `WebhookRequest` with a secret from a secret
   manager, never from committed configuration.
4. Run `bun run --filter @aqa/integrations test`.

For production, use `PostgresWebhookQueue` with a secret resolver backed by a
secret manager. Only `secret_ref` is persisted; the secret itself is resolved
inside the worker and is never written to the queue. Both implementations
require audit metrics, destination allowlisting and an authenticated operator
workflow for DLQ redrive.
