# `@aqa/commerce`

Typed commerce-assurance contracts used by Agentic QA Kit merchant adapters and journeys.

## Table of contents

- [Features](#features)
- [Setup](#setup)

## Features

- Decimal-safe `Money` values using ISO currency plus integer minor units.
- Versioned tenant/run context and order, payment, inventory snapshots.
- Versioned fulfillment and return/RMA snapshots with anti-over-quantity invariants.
- Versioned subscription and chargeback snapshots with period and payment-linkage invariants.
- Reconciled loyalty account and transaction snapshots with duplicate/event-sign invariants.
- Cancellation snapshots distinguish requested/accepted/rejected and require
  compensating refund evidence for paid orders.
- Explicit `pass`, `fail`, `blocked`, `unsupported`, and `inconclusive` outcomes.
- `HttpCommerceAdapter` for live provider-neutral HTTP merchants, with origin
  allowlisting, bounded responses, tenant context and typed snapshot parsing.
- Fail-closed currency and inventory invariants.
- Fulfillment evidence requires tracking metadata for shipped/delivered states;
  return requests cannot exceed original order quantities or currency.
- Subscription periods cannot invert; opened chargebacks require an evidence
  deadline and cannot exceed the captured payment.
- Loyalty balances are derived from a deduplicated transaction ledger and
  cannot become negative.
- Provider-neutral `CommerceAdapter` contract for HTTP, browser and observer-backed merchants.
- `verifyCheckoutJourney()` checks capability preflight, exact inventory effects,
  snapshot integrity and idempotent checkout retries with structured evidence.
- `verifyTaxJourney()` and `verifyShippingJourney()` validate observable,
  currency-safe tax quotes and unique bounded shipping rates. Quotes must carry
  the exact cart ID under test; shipping quotes must also echo the requested
  destination. Stale, cross-cart or cross-destination provider responses fail
  closed, while missing provider capability returns `unsupported`. When the
  merchant also exposes checkout, the tax journey performs a separate,
  namespaced idempotent checkout and requires the final order tax to equal the
  provider quote; a quote that is never applied cannot pass as complete.
- `verifyWebhookJourney()` checks order linkage, delivered state, valid
  signatures and bounded delivery attempts; it never treats an absent webhook
  observer as a pass.
- `verifyCommerceJourneySuite()` combines required checkout/refund evidence
  with optional tax, shipping and webhook journeys into one explicit gate;
  unsupported capabilities remain visible and never become a green result.
- `verifyCancellationJourney()` verifies accepted paid-order cancellation is
  idempotent and linked to compensating refund evidence.
- `verifySettlementJourney()` reconciles captured payment, successful refunds,
  lost chargebacks and net provider settlement when the adapter exposes that
  observation capability.
- `verifyPostPurchaseJourney()` validates observed fulfillment/tracking and an
  optional idempotent return/RMA request bound to the original order. Every
  fulfillment also carries and matches the order tenant and customer, so a
  provider cannot pass a cross-tenant delivery record by reusing an order ID.
- `verifySubscriptionJourney()` validates idempotent subscription creation,
  period/amount invariants, tenant ownership and authoritative re-observation.
- `verifyLoyaltyJourney()` validates checkout-linked earning, tenant/customer
  ownership, complete ledger reconciliation and an optional points expectation.
- `verifyDunningJourney()` validates provider-observed failed renewal attempts,
  contiguous retry history, subscription ownership, amount/currency linkage and
  expected past-due state.
- `verifyDisputeJourney()` validates provider-observed chargebacks, exact
  order/payment linkage, tenant isolation, amount bounds, evidence deadlines
  and expected dispute state.
- `verifyStripeWebhookSignature()` validates the raw-body `Stripe-Signature`
  v1 contract, positive replay tolerance and constant-time HMAC comparison;
  it does not perform payment calls or replace durable event idempotency.
- `StripeWebhookProcessor` combines raw-body signature verification, bounded
  event parsing, supported-event allowlisting and the durable effect ledger.
  Failed effects release their in-progress claim so provider retries can
  safely recover; abandoned processing claims are reclaimed after a bounded
  lease; conflicting logical effects fail closed. Business effects must remain
  idempotent because a process can crash after the external effect and before
  marking it completed.
- `StripePaymentGateway` is a bounded REST boundary for PaymentIntent create/
  retrieve and refund operations. It requires Stripe secret-key format,
  HTTPS (except localhost test servers), write idempotency keys, bounded
  responses and typed provider observations; it deliberately does not pretend
  to own merchant carts, inventory or fulfillment.
- `reconcileStripeRefunds()` reads back the provider PaymentIntent and bounded
  refund list, then fails closed when captured or successful-refund totals do
  not match merchant-authoritative values. Disputes and payout settlement
  remain separate provider observations.
- `reconcileStripeDisputes()` reads back the bounded Stripe dispute list,
  requires every dispute to link to the exact PaymentIntent, validates known
  provider lifecycle states and evidence deadlines, and fails closed on
  pagination, currency, status or total drift. It reports provider dispute
  exposure; it does not turn a won/open dispute into settled chargeback
  accounting.
- `reconcileStripePayout()` reads back a payout and its linked balance
  transaction, preserving signed provider amounts and failing closed when the
  payout amount, fee, net equation, source linkage, type, currency or expected
  status drifts. It is payout evidence, not proof that a merchant order was
  included in that payout.
- When `expected_balance_transaction_sources` is supplied,
  `reconcileStripePayout()` also reads the bounded Stripe balance transactions
  assigned to the payout and requires every merchant-persisted provider
  source ID to be present. This is an explicit order/payment-to-payout join,
  not an inferred success; incomplete pagination fails closed.
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
- `CommerceMutationGate` is the mandatory orchestration boundary for writes:
  it distinguishes `committed`, `not_committed` and `unknown` outcomes. A
  transport ambiguity never becomes a success and the claimed approval must be
  reconciled before retrying.

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

For a real Stripe test-mode boundary, inject the test-mode `sk_test_...` key
only through a secret manager or process environment and construct
`StripePaymentGateway` with it. Never place the key in fixtures or logs. The
adapter is intentionally not exercised by default CI; a live Stripe account,
webhook endpoint and provider settlement evidence are deployment prerequisites.

Agentic tools must apply `CommerceMutationGate` at the mutation gateway. The
executor must re-check cart revision and total inside the merchant transaction
and return `unknown` when the provider outcome cannot be established. The
policy is not a replacement for durable approval storage, provider
reconciliation or a real authorization service.
