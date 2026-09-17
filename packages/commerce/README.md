# `@aqa/commerce`

Typed commerce-assurance contracts used by Agentic QA Kit merchant adapters and journeys.

## Table of contents

- [Features](#features)
- [Setup](#setup)

## Features

- Decimal-safe `Money` values using ISO currency plus integer minor units.
- Versioned tenant/run context and order, payment, inventory snapshots.
- Explicit `pass`, `fail`, `blocked`, `unsupported`, and `inconclusive` outcomes.
- Fail-closed currency and inventory invariants.
- Deterministic `InMemoryCommerceReference` for synthetic checkout, idempotency,
  inventory race and tenant-isolation journeys. It has no real payment side effect.

## Setup

From the repository root:

```bash
bun install
bun run --filter @aqa/commerce build
bun test packages/commerce/test/contracts.test.ts
```

The reference merchant is suitable for deterministic contract and journey tests:

```ts
const merchant = new InMemoryCommerceReference();
merchant.seedProduct({
  sku: 'sku-1',
  price: { currency: 'EUR', amount_minor: '1099' },
  on_hand: 1,
});
const identity = { tenant: 'shop-a', customer_id: 'customer-a' };
const cart = merchant.createCart(identity);
merchant.addLine(identity, cart.id, 'sku-1', 1);
const result = merchant.checkout(identity, cart.id, 'stable-key');
```

Use it as a test merchant, not as a production payment implementation. Real
merchant/payment adapters must provide authoritative observations; an unavailable
observer is `unsupported`, never an empty success.
