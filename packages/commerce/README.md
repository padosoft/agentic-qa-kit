# `@aqa/commerce`

Typed commerce-assurance contracts used by Agentic QA Kit merchant adapters and journeys.

## Table of contents

- [Features](#features)
- [Setup](#setup)

## Features

- Decimal-safe `Money` values using ISO currency plus integer minor units.
- Versioned tenant/run context and order, payment, inventory snapshots.
- Explicit `pass`, `fail`, `blocked`, `unsupported`, and `inconclusive` outcomes.
- `HttpCommerceAdapter` for live provider-neutral HTTP merchants, with origin
  allowlisting, bounded responses, tenant context and typed snapshot parsing.
- Fail-closed currency and inventory invariants.
- Provider-neutral `CommerceAdapter` contract for HTTP, browser and observer-backed merchants.
- `verifyCheckoutJourney()` checks capability preflight, exact inventory effects,
  snapshot integrity and idempotent checkout retries with structured evidence.
- `verifyTaxJourney()` and `verifyShippingJourney()` validate observable,
  currency-safe tax quotes and unique bounded shipping rates, returning
  `unsupported` when a real provider cannot expose the required evidence.
- `verifyWebhookJourney()` checks order linkage, delivered state, valid
  signatures and bounded delivery attempts; it never treats an absent webhook
  observer as a pass.
- `verifyStripeWebhookSignature()` validates the raw-body `Stripe-Signature`
  v1 contract, positive replay tolerance and constant-time HMAC comparison;
  it does not perform payment calls or replace durable event idempotency.
- `applyWebhookEffectOnce()` and the in-memory/PostgreSQL effect ledgers make
  the business side effect idempotent across retries and replicas, rejecting
  reuse of one logical effect key by a different event.
- Deterministic `InMemoryCommerceReference` for synthetic checkout, idempotency,
  inventory race and tenant-isolation journeys. It has no real payment side effect.
- `CommerceToolPolicy` for agentic commerce: read tools are explicitly
  allowlisted; writes/financial actions require a single-use human approval
  bound to tenant, customer, cart revision, exact currency/amount and expiry.
- `InMemoryCommerceApprovalLedger` and `PostgresCommerceApprovalLedger` provide
  atomic approval consumption; production uses `authorizeAsync()` when a
  durable ledger is configured.

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

To run the same journey through the adapter contract:

```ts
const journey = await verifyCheckoutJourney(merchant.asAdapter(), {
  context: {
    schema_version: '1', merchant: 'reference', environment: 'sandbox',
    tenant: 'shop-a', run_id: 'run-1', policy_revision: 'policy-1',
    capabilities: {},
  },
  identity,
  sku: 'sku-1',
  quantity: 1,
  idempotencyKey: 'stable-key',
});
// journey.outcome.status === 'pass' only when observations are complete.
```

Use it as a test merchant, not as a production payment implementation. Real
merchant/payment adapters must provide authoritative observations; an unavailable
observer is `unsupported`, never an empty success.

Agentic tools must apply `CommerceToolPolicy` at the mutation gateway and bind
the returned decision atomically to the merchant write. The policy is not a
replacement for durable approval storage, provider reconciliation or a real
authorization service.
