# `@aqa/integrations`

Provider-neutral outbound delivery primitives for enterprise integrations.

## Features

- bounded exponential retry with `Retry-After` support;
- HMAC-SHA256 signatures and stable delivery IDs;
- per-integration rate limiting hook;
- explicit dead-letter queue state after five attempts;
- injectable transport, so tests never call a real vendor.

## Setup

1. From the repository root run `bun install`.
2. Import `MemoryWebhookQueue` for local development and tests.
3. Enqueue a tenant-scoped `WebhookRequest` with a secret from a secret
   manager, never from committed configuration.
4. Run `bun run --filter @aqa/integrations test`.

The memory queue is a contract/reference implementation. A production adapter
must persist pending and dead-letter rows atomically and expose audit metrics.
