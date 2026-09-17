import { z } from 'zod';

export {
  CommerceToolCall,
  CommerceToolPolicy,
  HumanCommerceApproval,
  type CommerceAuthorization,
  type CommerceToolPolicyOptions,
} from './agent-security.js';
export {
  InMemoryCommerceApprovalLedger,
  PostgresCommerceApprovalLedger,
  type ApprovalClaim,
  type CommerceApprovalLedger,
} from './approval-ledger.js';

export {
  verifyStripeWebhookSignature,
  type StripeWebhookVerification,
  type StripeWebhookVerificationOptions,
} from './stripe-webhook.js';
export {
  applyWebhookEffectOnce,
  InMemoryWebhookEffectLedger,
  PostgresWebhookEffectLedger,
  type WebhookClaim,
  type WebhookEffectLedger,
} from './webhook-ledger.js';
export { HttpCommerceAdapter, type HttpCommerceAdapterOptions } from './http-adapter.js';
export {
  CommerceMutationGate,
  type CommerceMutationExecution,
  type CommerceMutationExecutor,
  type CommerceMutationGateResult,
} from './mutation-gate.js';

/** Decimal minor units are strings so no binary floating point enters money math. */
export const Money = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO-4217 code'),
  amount_minor: z.string().regex(/^(0|[1-9]\d*)$/, 'amount_minor must be a non-negative integer'),
});
export type Money = z.infer<typeof Money>;

export const CommerceContext = z.object({
  schema_version: z.literal('1'),
  merchant: z.string().min(1),
  environment: z.enum(['sandbox', 'staging', 'production']),
  tenant: z.string().min(1),
  run_id: z.string().min(1),
  policy_revision: z.string().min(1),
  capabilities: z.record(z.boolean()).default({}),
});
export type CommerceContext = z.infer<typeof CommerceContext>;

export const OrderLine = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: Money,
  line_total: Money,
});
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  lines: z.array(OrderLine),
  subtotal: Money,
  tax: Money,
  discount: Money,
  total: Money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(['pending', 'authorized', 'paid', 'fulfilled', 'cancelled', 'refunded']),
});
export type OrderSnapshot = z.infer<typeof OrderSnapshot>;

export const PaymentSnapshot = z.object({
  schema_version: z.literal('1'),
  order_id: z.string().min(1),
  provider: z.string().min(1),
  payment_id: z.string().min(1),
  amount: Money,
  refunded_amount: Money,
  status: z.enum(['pending', 'authorized', 'captured', 'partially_refunded', 'refunded', 'failed']),
  observed_at: z.string().datetime({ offset: true }),
});
export type PaymentSnapshot = z.infer<typeof PaymentSnapshot>;

export const SubscriptionSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  plan: z.string().min(1),
  status: z.enum(['trialing', 'active', 'past_due', 'paused', 'cancelled']),
  interval: z.enum(['week', 'month', 'year']),
  amount: Money,
  current_period_start: z.string().datetime({ offset: true }),
  current_period_end: z.string().datetime({ offset: true }),
  cancel_at_period_end: z.boolean(),
});
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshot>;

export const ChargebackSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  order_id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: Money,
  status: z.enum(['opened', 'won', 'lost']),
  reason: z.string().min(1),
  opened_at: z.string().datetime({ offset: true }),
  evidence_due_at: z.string().datetime({ offset: true }).optional(),
});
export type ChargebackSnapshot = z.infer<typeof ChargebackSnapshot>;

export const LoyaltyTransactionSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  account_id: z.string().min(1),
  kind: z.enum(['earn', 'redeem', 'expire', 'adjust']),
  points: z.number().int(),
  reference: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
});
export type LoyaltyTransactionSnapshot = z.infer<typeof LoyaltyTransactionSnapshot>;

export const LoyaltyAccountSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  balance_points: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export type LoyaltyAccountSnapshot = z.infer<typeof LoyaltyAccountSnapshot>;

export const RefundSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  order_id: z.string().min(1),
  amount: Money,
  status: z.enum(['pending', 'succeeded', 'failed']),
  observed_at: z.string().datetime({ offset: true }),
});
export type RefundSnapshot = z.infer<typeof RefundSnapshot>;

export const WebhookObservation = z.object({
  schema_version: z.literal('1'),
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  order_id: z.string().min(1),
  delivery_id: z.string().min(1),
  status: z.enum(['delivered', 'failed']),
  attempts: z.number().int().positive(),
  signature_valid: z.boolean(),
  observed_at: z.string().datetime({ offset: true }),
});
export type WebhookObservation = z.infer<typeof WebhookObservation>;

export const InventorySnapshot = z.object({
  schema_version: z.literal('1'),
  sku: z.string().min(1),
  location: z.string().min(1),
  on_hand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  backorder_allowed: z.boolean(),
});
export type InventorySnapshot = z.infer<typeof InventorySnapshot>;

export const JourneyOutcome = z.object({
  status: z.enum(['pass', 'fail', 'error', 'inconclusive', 'blocked', 'unsupported']),
  evidence_complete: z.boolean(),
  reason: z.string().min(1),
});
export type JourneyOutcome = z.infer<typeof JourneyOutcome>;

export const CommerceCapabilities = z.object({
  checkout: z.boolean(),
  refunds: z.boolean(),
  inventory_observer: z.boolean(),
  webhook_observer: z.boolean(),
  idempotency: z.boolean(),
  tax_quote: z.boolean().default(false),
  shipping_quote: z.boolean().default(false),
});
export type CommerceCapabilities = z.infer<typeof CommerceCapabilities>;

export const CartSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  tenant: z.string().min(1),
  customer_id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  lines: z.array(OrderLine),
  status: z.enum(['open', 'checked_out']),
});
export type CartSnapshot = z.infer<typeof CartSnapshot>;

export type CommerceIdentity = {
  tenant: string;
  customer_id: string;
};

export const ShippingAddress = z.object({
  country_code: z.string().regex(/^[A-Z]{2}$/),
  postal_code: z.string().min(1),
  city: z.string().min(1),
  region: z.string().optional(),
});
export type ShippingAddress = z.infer<typeof ShippingAddress>;

export const TaxQuote = z.object({
  schema_version: z.literal('1'),
  provider: z.string().min(1),
  jurisdiction: z.string().min(1),
  amount: Money,
  observed_at: z.string().datetime({ offset: true }),
});
export type TaxQuote = z.infer<typeof TaxQuote>;

export const ShippingRate = z.object({
  id: z.string().min(1),
  carrier: z.string().min(1),
  service: z.string().min(1),
  amount: Money,
  estimated_days: z.number().int().positive(),
});
export type ShippingRate = z.infer<typeof ShippingRate>;

export const ShippingQuote = z.object({
  schema_version: z.literal('1'),
  destination: ShippingAddress,
  rates: z.array(ShippingRate).min(1),
  observed_at: z.string().datetime({ offset: true }),
});
export type ShippingQuote = z.infer<typeof ShippingQuote>;

export const TenderAllocation = z.object({
  tender_id: z.string().min(1),
  kind: z.enum(['card', 'gift_card', 'store_credit']),
  amount: Money,
});
export type TenderAllocation = z.infer<typeof TenderAllocation>;

export const PromotionSnapshot = z.object({
  code: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  discount: Money,
  max_redemptions: z.number().int().positive(),
  redemptions: z.number().int().nonnegative(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
export type PromotionSnapshot = z.infer<typeof PromotionSnapshot>;

export const FulfillmentLine = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type FulfillmentLine = z.infer<typeof FulfillmentLine>;

export const FulfillmentSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  order_id: z.string().min(1),
  lines: z.array(FulfillmentLine).min(1),
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
  carrier: z.string().min(1).optional(),
  tracking_number: z.string().min(1).optional(),
  shipped_at: z.string().datetime({ offset: true }).optional(),
  delivered_at: z.string().datetime({ offset: true }).optional(),
});
export type FulfillmentSnapshot = z.infer<typeof FulfillmentSnapshot>;

export const ReturnRequestSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  order_id: z.string().min(1),
  lines: z.array(FulfillmentLine).min(1),
  amount: Money,
  reason: z.string().min(1),
  status: z.enum(['requested', 'approved', 'received', 'refunded', 'rejected']),
  created_at: z.string().datetime({ offset: true }),
});
export type ReturnRequestSnapshot = z.infer<typeof ReturnRequestSnapshot>;

/** Tender is money allocation, not an order discount. It must reconcile exactly. */
export function assertTenderAllocation(
  total: Money,
  allocations: readonly TenderAllocation[],
): void {
  const parsedTotal = Money.parse(total);
  if (allocations.length === 0) throw new Error('tender allocation is empty');
  const seen = new Set<string>();
  let sum = 0n;
  for (const allocation of allocations) {
    const item = TenderAllocation.parse(allocation);
    if (item.amount.currency !== parsedTotal.currency)
      throw new Error('tender allocation currency mismatch');
    if (seen.has(item.tender_id)) throw new Error(`duplicate tender allocation: ${item.tender_id}`);
    seen.add(item.tender_id);
    sum += BigInt(item.amount.amount_minor);
  }
  if (sum !== BigInt(parsedTotal.amount_minor))
    throw new Error('tender allocation does not reconcile to total');
}

/** Validate promotion state at commit time, not only when the cart was quoted. */
export function assertPromotionRedeemable(promotion: PromotionSnapshot, now = new Date()): void {
  const item = PromotionSnapshot.parse(promotion);
  if (item.discount.currency !== item.currency) throw new Error('promotion currency mismatch');
  if (item.redemptions >= item.max_redemptions)
    throw new Error('promotion redemption limit reached');
  if (item.expires_at && Date.parse(item.expires_at) <= now.getTime())
    throw new Error('promotion is expired');
}

export function assertSubscriptionIntegrity(subscription: SubscriptionSnapshot): void {
  const item = SubscriptionSnapshot.parse(subscription);
  if (Date.parse(item.current_period_end) <= Date.parse(item.current_period_start))
    throw new Error('subscription period end must be after period start');
  assertMoneyNonNegative(item.amount, 'subscription amount');
  if (item.status === 'cancelled' && !item.cancel_at_period_end)
    throw new Error('cancelled subscription must be marked cancel_at_period_end');
}

export function assertChargebackIntegrity(
  order: OrderSnapshot,
  payment: PaymentSnapshot,
  chargeback: ChargebackSnapshot,
): void {
  const item = ChargebackSnapshot.parse(chargeback);
  if (item.order_id !== order.id || item.payment_id !== payment.payment_id)
    throw new Error('chargeback is not linked to the exact order payment');
  assertSameCurrency(item.amount, payment.amount);
  if (BigInt(item.amount.amount_minor) <= 0n) throw new Error('chargeback amount must be positive');
  if (BigInt(item.amount.amount_minor) > BigInt(payment.amount.amount_minor))
    throw new Error('chargeback exceeds captured payment');
  if (item.status === 'opened' && !item.evidence_due_at)
    throw new Error('opened chargeback requires evidence_due_at');
}

export function assertLoyaltyLedgerIntegrity(
  account: LoyaltyAccountSnapshot,
  transactions: readonly LoyaltyTransactionSnapshot[],
): void {
  const item = LoyaltyAccountSnapshot.parse(account);
  const seen = new Set<string>();
  let balance = 0;
  for (const transaction of transactions) {
    const entry = LoyaltyTransactionSnapshot.parse(transaction);
    if (entry.account_id !== item.id)
      throw new Error('loyalty transaction targets another account');
    if (seen.has(entry.id)) throw new Error(`duplicate loyalty transaction: ${entry.id}`);
    seen.add(entry.id);
    if (entry.points === 0) throw new Error('loyalty transaction points must be non-zero');
    if ((entry.kind === 'earn' || entry.kind === 'adjust') && entry.points < 0)
      throw new Error(`${entry.kind} transaction cannot reduce points`);
    if ((entry.kind === 'redeem' || entry.kind === 'expire') && entry.points > 0)
      throw new Error(`${entry.kind} transaction must reduce points`);
    balance += entry.points;
    if (balance < 0) throw new Error('loyalty ledger balance cannot be negative');
  }
  if (balance !== item.balance_points)
    throw new Error('loyalty balance does not reconcile to ledger');
}

/** A fulfillment or RMA line can never exceed the original order quantity. */
export function assertOrderLineQuantitiesWithinOrder(
  order: OrderSnapshot,
  lines: readonly FulfillmentLine[],
  label = 'lines',
): void {
  const orderQuantities = new Map(order.lines.map((line) => [line.sku, line.quantity]));
  const seen = new Set<string>();
  for (const line of lines) {
    const item = FulfillmentLine.parse(line);
    if (seen.has(item.sku)) throw new Error(`${label} contains duplicate sku: ${item.sku}`);
    seen.add(item.sku);
    if ((orderQuantities.get(item.sku) ?? 0) < item.quantity)
      throw new Error(`${label} exceeds order quantity: ${item.sku}`);
  }
}

export function assertFulfillmentIntegrity(
  order: OrderSnapshot,
  fulfillment: FulfillmentSnapshot,
): void {
  const item = FulfillmentSnapshot.parse(fulfillment);
  if (item.order_id !== order.id) throw new Error('fulfillment does not belong to order');
  assertOrderLineQuantitiesWithinOrder(order, item.lines, 'fulfillment lines');
  if (item.status === 'shipped' || item.status === 'delivered') {
    if (!item.carrier || !item.tracking_number || !item.shipped_at)
      throw new Error('shipped fulfillment requires carrier, tracking and shipped_at');
  }
  if (item.status === 'delivered' && !item.delivered_at)
    throw new Error('delivered fulfillment requires delivered_at');
}

export function assertReturnRequestIntegrity(
  order: OrderSnapshot,
  request: ReturnRequestSnapshot,
): void {
  const item = ReturnRequestSnapshot.parse(request);
  if (item.order_id !== order.id) throw new Error('return request does not belong to order');
  assertOrderLineQuantitiesWithinOrder(order, item.lines, 'return lines');
  assertSameCurrency(item.amount, order.total);
  if (BigInt(item.amount.amount_minor) <= 0n) throw new Error('return amount must be positive');
}

/**
 * Provider-neutral contract for a commerce system under test. Implementations
 * may call HTTP, a browser, or a read-only database observer, but they must
 * return validated snapshots rather than provider-specific response blobs.
 */
export interface CommerceAdapter {
  capabilities(context: CommerceContext): Promise<CommerceCapabilities>;
  createCart(identity: CommerceIdentity): Promise<CartSnapshot>;
  addLine(
    identity: CommerceIdentity,
    cartId: string,
    sku: string,
    quantity: number,
  ): Promise<CartSnapshot>;
  checkout(
    identity: CommerceIdentity,
    cartId: string,
    idempotencyKey: string,
  ): Promise<CheckoutResult>;
  getOrder(identity: CommerceIdentity, orderId: string): Promise<OrderSnapshot>;
  getPayment(identity: CommerceIdentity, orderId: string): Promise<PaymentSnapshot>;
  getInventory(sku: string): Promise<InventorySnapshot>;
  refund(
    identity: CommerceIdentity,
    orderId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<RefundResult>;
  quoteTax?(identity: CommerceIdentity, cartId: string): Promise<TaxQuote>;
  quoteShipping?(
    identity: CommerceIdentity,
    cartId: string,
    destination: ShippingAddress,
  ): Promise<ShippingQuote>;
  observeWebhooks?(orderId: string): Promise<readonly WebhookObservation[]>;
}

export type CommerceJourneyEvidence = {
  step: string;
  ok: boolean;
  detail: string;
};

export type CheckoutJourneyOptions = {
  context: CommerceContext;
  identity: CommerceIdentity;
  sku: string;
  quantity: number;
  idempotencyKey: string;
};

export type RefundJourneyOptions = CheckoutJourneyOptions & {
  refundAmount: Money;
  refundIdempotencyKey: string;
};

export type TaxJourneyOptions = CheckoutJourneyOptions;
export type ShippingJourneyOptions = CheckoutJourneyOptions & {
  destination: ShippingAddress;
};

/** Verifies a signed, delivered webhook is linked to the exact checkout order. */
export async function verifyWebhookJourney(
  adapter: CommerceAdapter,
  opts: CheckoutJourneyOptions,
): Promise<{ outcome: JourneyOutcome; evidence: readonly CommerceJourneyEvidence[] }> {
  const evidence: CommerceJourneyEvidence[] = [];
  try {
    const capabilities = CommerceCapabilities.parse(await adapter.capabilities(opts.context));
    if (!capabilities.webhook_observer || !adapter.observeWebhooks) {
      return {
        outcome: {
          status: 'unsupported',
          evidence_complete: false,
          reason: 'adapter lacks webhook observation',
        },
        evidence,
      };
    }
    const cart = CartSnapshot.parse(await adapter.createCart(opts.identity));
    const updated = CartSnapshot.parse(
      await adapter.addLine(opts.identity, cart.id, opts.sku, opts.quantity),
    );
    const checkout = validateCheckoutResult(
      await adapter.checkout(opts.identity, updated.id, opts.idempotencyKey),
    );
    const observations = (await adapter.observeWebhooks(checkout.order.id)).map((item) =>
      WebhookObservation.parse(item),
    );
    const matching = observations.filter(
      (item) => item.order_id === checkout.order.id && item.status === 'delivered',
    );
    if (matching.length === 0) throw new Error('no delivered webhook observed for order');
    if (matching.some((item) => !item.signature_valid))
      throw new Error('webhook signature verification failed');
    if (matching.some((item) => item.attempts > 10))
      throw new Error('webhook delivery attempts exceed bounded retry policy');
    evidence.push({
      step: 'webhook.delivered',
      ok: true,
      detail: `order=${checkout.order.id}; deliveries=${matching.length}`,
    });
    return {
      outcome: { status: 'pass', evidence_complete: true, reason: 'webhook journey passed' },
      evidence,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

/** Verifies a tax quote is observable, non-negative and currency-consistent. */
export async function verifyTaxJourney(
  adapter: CommerceAdapter,
  opts: TaxJourneyOptions,
): Promise<{ outcome: JourneyOutcome; evidence: readonly CommerceJourneyEvidence[] }> {
  const evidence: CommerceJourneyEvidence[] = [];
  try {
    const capabilities = CommerceCapabilities.parse(await adapter.capabilities(opts.context));
    if (!capabilities.tax_quote || !adapter.quoteTax) {
      return {
        outcome: {
          status: 'unsupported',
          evidence_complete: false,
          reason: 'adapter lacks tax quote observation',
        },
        evidence,
      };
    }
    const cart = CartSnapshot.parse(await adapter.createCart(opts.identity));
    const updated = CartSnapshot.parse(
      await adapter.addLine(opts.identity, cart.id, opts.sku, opts.quantity),
    );
    const quote = TaxQuote.parse(await adapter.quoteTax(opts.identity, updated.id));
    assertMoneyNonNegative(quote.amount, 'tax quote');
    const currency = updated.lines[0]?.unit_price.currency;
    if (currency && quote.amount.currency !== currency)
      throw new Error('tax quote currency mismatch');
    evidence.push({ step: 'tax.quote', ok: true, detail: `amount=${quote.amount.amount_minor}` });
    return {
      outcome: { status: 'pass', evidence_complete: true, reason: 'tax quote passed' },
      evidence,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

/** Verifies shipping rates are complete, unique, bounded and currency-safe. */
export async function verifyShippingJourney(
  adapter: CommerceAdapter,
  opts: ShippingJourneyOptions,
): Promise<{ outcome: JourneyOutcome; evidence: readonly CommerceJourneyEvidence[] }> {
  const evidence: CommerceJourneyEvidence[] = [];
  try {
    const capabilities = CommerceCapabilities.parse(await adapter.capabilities(opts.context));
    if (!capabilities.shipping_quote || !adapter.quoteShipping) {
      return {
        outcome: {
          status: 'unsupported',
          evidence_complete: false,
          reason: 'adapter lacks shipping quote observation',
        },
        evidence,
      };
    }
    const cart = CartSnapshot.parse(await adapter.createCart(opts.identity));
    const updated = CartSnapshot.parse(
      await adapter.addLine(opts.identity, cart.id, opts.sku, opts.quantity),
    );
    const quote = ShippingQuote.parse(
      await adapter.quoteShipping(opts.identity, updated.id, opts.destination),
    );
    const ids = new Set<string>();
    for (const rate of quote.rates) {
      if (ids.has(rate.id)) throw new Error(`duplicate shipping rate: ${rate.id}`);
      ids.add(rate.id);
      assertMoneyNonNegative(rate.amount, `shipping rate ${rate.id}`);
    }
    const currency = updated.lines[0]?.unit_price.currency;
    if (currency && quote.rates.some((rate) => rate.amount.currency !== currency))
      throw new Error('shipping quote currency mismatch');
    evidence.push({ step: 'shipping.quote', ok: true, detail: `rates=${quote.rates.length}` });
    return {
      outcome: { status: 'pass', evidence_complete: true, reason: 'shipping quote passed' },
      evidence,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

/**
 * Runs the minimum safe checkout journey against any adapter. A provider is
 * never marked as passing when it cannot expose the required observations or
 * when an idempotent retry produces a second effect.
 */
export async function verifyCheckoutJourney(
  adapter: CommerceAdapter,
  opts: CheckoutJourneyOptions,
): Promise<{ outcome: JourneyOutcome; evidence: readonly CommerceJourneyEvidence[] }> {
  const evidence: CommerceJourneyEvidence[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    evidence.push({ step, ok, detail });
  };
  try {
    const capabilities = CommerceCapabilities.parse(await adapter.capabilities(opts.context));
    if (!capabilities.checkout || !capabilities.idempotency || !capabilities.inventory_observer) {
      return {
        outcome: {
          status: 'unsupported',
          evidence_complete: false,
          reason: 'adapter lacks checkout, idempotency, or inventory observation',
        },
        evidence,
      };
    }
    const before = InventorySnapshot.parse(await adapter.getInventory(opts.sku));
    assertInventoryIntegrity(before);
    record('inventory.before', true, `revision=${before.revision}`);
    const cart = CartSnapshot.parse(await adapter.createCart(opts.identity));
    const updatedCart = CartSnapshot.parse(
      await adapter.addLine(opts.identity, cart.id, opts.sku, opts.quantity),
    );
    assertCartIntegrity(updatedCart);
    record('cart.add_line', true, `cart=${updatedCart.id}`);
    const first = validateCheckoutResult(
      await adapter.checkout(opts.identity, updatedCart.id, opts.idempotencyKey),
    );
    const retry = validateCheckoutResult(
      await adapter.checkout(opts.identity, updatedCart.id, opts.idempotencyKey),
    );
    if (JSON.stringify(first) !== JSON.stringify(retry)) {
      throw new Error('idempotent checkout retry returned a different result');
    }
    record('checkout.idempotent_retry', true, `order=${first.order.id}`);
    const order = OrderSnapshot.parse(await adapter.getOrder(opts.identity, first.order.id));
    const payment = PaymentSnapshot.parse(await adapter.getPayment(opts.identity, first.order.id));
    assertOrderIntegrity(order);
    assertPaymentIntegrity(payment);
    const after = InventorySnapshot.parse(await adapter.getInventory(opts.sku));
    assertInventoryIntegrity(after);
    if (after.committed - before.committed !== opts.quantity) {
      throw new Error('checkout did not commit the requested inventory quantity exactly once');
    }
    record('postconditions', true, `order=${order.status}; payment=${payment.status}`);
    return {
      outcome: { status: 'pass', evidence_complete: true, reason: 'checkout journey passed' },
      evidence,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

/** Verifies that a partial refund is bounded and exactly-once under retry. */
export async function verifyRefundJourney(
  adapter: CommerceAdapter,
  opts: RefundJourneyOptions,
): Promise<{ outcome: JourneyOutcome; evidence: readonly CommerceJourneyEvidence[] }> {
  const evidence: CommerceJourneyEvidence[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    evidence.push({ step, ok, detail });
  };
  try {
    const capabilities = CommerceCapabilities.parse(await adapter.capabilities(opts.context));
    if (!capabilities.checkout || !capabilities.refunds || !capabilities.idempotency) {
      return {
        outcome: {
          status: 'unsupported',
          evidence_complete: false,
          reason: 'adapter lacks checkout, refunds, or idempotency',
        },
        evidence,
      };
    }
    assertMoneyNonNegative(opts.refundAmount, 'refund amount');
    if (BigInt(opts.refundAmount.amount_minor) <= 0n) {
      throw new Error('refund amount must be positive');
    }
    const cart = CartSnapshot.parse(await adapter.createCart(opts.identity));
    const updatedCart = CartSnapshot.parse(
      await adapter.addLine(opts.identity, cart.id, opts.sku, opts.quantity),
    );
    const checkout = validateCheckoutResult(
      await adapter.checkout(opts.identity, updatedCart.id, opts.idempotencyKey),
    );
    assertSameCurrency(opts.refundAmount, checkout.payment.amount);
    if (BigInt(opts.refundAmount.amount_minor) >= BigInt(checkout.payment.amount.amount_minor)) {
      throw new Error('refund journey requires a partial refund amount');
    }
    record('checkout.captured', true, `order=${checkout.order.id}`);
    const first = validateRefundResult(
      await adapter.refund(
        opts.identity,
        checkout.order.id,
        opts.refundAmount,
        opts.refundIdempotencyKey,
      ),
    );
    const retry = validateRefundResult(
      await adapter.refund(
        opts.identity,
        checkout.order.id,
        opts.refundAmount,
        opts.refundIdempotencyKey,
      ),
    );
    if (JSON.stringify(first) !== JSON.stringify(retry)) {
      throw new Error('idempotent refund retry returned a different result');
    }
    const expectedRefunded = BigInt(opts.refundAmount.amount_minor);
    if (BigInt(first.payment.refunded_amount.amount_minor) !== expectedRefunded) {
      throw new Error('partial refund amount was not persisted exactly once');
    }
    record('refund.idempotent_retry', true, `refund=${first.refund.id}`);
    return {
      outcome: { status: 'pass', evidence_complete: true, reason: 'refund journey passed' },
      evidence,
    };
  } catch (error) {
    return {
      outcome: {
        status: 'error',
        evidence_complete: evidence.length > 0,
        reason: error instanceof Error ? error.message : String(error),
      },
      evidence,
    };
  }
}

export type ReferenceProduct = {
  sku: string;
  price: Money;
  on_hand: number;
};

export type CheckoutResult = {
  order: OrderSnapshot;
  payment: PaymentSnapshot;
  inventory: InventorySnapshot[];
};

export type RefundResult = {
  refund: RefundSnapshot;
  payment: PaymentSnapshot;
  order: OrderSnapshot;
};

/**
 * Deterministic merchant used by contract tests and local journey pilots.
 * It deliberately has no network or real payment side effect. Mutations are
 * synchronous inside each method, so concurrent callers cannot interleave a
 * stock check and the commit in this reference implementation.
 */
export class InMemoryCommerceReference {
  private readonly products = new Map<string, ReferenceProduct>();
  private readonly carts = new Map<string, CartSnapshot>();
  private readonly orders = new Map<string, OrderSnapshot>();
  private readonly payments = new Map<string, PaymentSnapshot>();
  private readonly refunds = new Map<string, RefundSnapshot>();
  private readonly refundIdempotency = new Map<
    string,
    { fingerprint: string; result: RefundResult }
  >();
  private readonly inventory = new Map<string, InventorySnapshot>();
  private readonly webhooks = new Map<string, WebhookObservation[]>();
  private readonly idempotency = new Map<string, { fingerprint: string; result: CheckoutResult }>();
  private sequence = 0;

  seedProduct(product: ReferenceProduct, location = 'main'): void {
    if (!Number.isSafeInteger(product.on_hand) || product.on_hand < 0) {
      throw new Error('product on_hand must be a non-negative safe integer');
    }
    Money.parse(product.price);
    this.products.set(product.sku, product);
    this.inventory.set(product.sku, {
      schema_version: '1',
      sku: product.sku,
      location,
      on_hand: product.on_hand,
      reserved: 0,
      committed: 0,
      revision: 0,
      backorder_allowed: false,
    });
  }

  createCart(identity: CommerceIdentity): CartSnapshot {
    const cart: CartSnapshot = {
      schema_version: '1',
      id: this.nextId('cart'),
      tenant: identity.tenant,
      customer_id: identity.customer_id,
      revision: 0,
      lines: [],
      status: 'open',
    };
    this.carts.set(cart.id, cart);
    return cart;
  }

  addLine(identity: CommerceIdentity, cartId: string, sku: string, quantity: number): CartSnapshot {
    const cart = this.authorizeCart(identity, cartId);
    if (cart.status !== 'open') throw new Error('cart is already checked out');
    const product = this.products.get(sku);
    if (!product) throw new Error(`unknown sku: ${sku}`);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new Error('quantity must be positive');
    const existing = cart.lines.find((line) => line.sku === sku);
    const lines = existing
      ? cart.lines.map((line) =>
          line.sku === sku
            ? {
                ...line,
                quantity: line.quantity + quantity,
                line_total: this.money(
                  product.price.currency,
                  BigInt(line.quantity + quantity) * BigInt(product.price.amount_minor),
                ),
              }
            : line,
        )
      : [
          ...cart.lines,
          {
            sku,
            quantity,
            unit_price: product.price,
            line_total: this.money(
              product.price.currency,
              BigInt(quantity) * BigInt(product.price.amount_minor),
            ),
          },
        ];
    const updated = { ...cart, revision: cart.revision + 1, lines };
    this.carts.set(cartId, updated);
    return updated;
  }

  checkout(identity: CommerceIdentity, cartId: string, idempotencyKey: string): CheckoutResult {
    if (!idempotencyKey.trim()) throw new Error('idempotency key is required');
    const cart = this.authorizeCart(identity, cartId);
    const fingerprint = JSON.stringify({
      tenant: identity.tenant,
      customer_id: identity.customer_id,
      cart_id: cart.id,
      lines: cart.lines,
    });
    const key = `${identity.tenant}:${idempotencyKey}`;
    const previous = this.idempotency.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error('idempotency key reused with a different payload');
      return previous.result;
    }
    if (cart.status !== 'open') throw new Error('cart is already checked out');
    if (cart.lines.length === 0) throw new Error('cannot checkout an empty cart');
    for (const line of cart.lines) {
      const stock = this.inventory.get(line.sku);
      if (!stock || stock.on_hand - stock.reserved - stock.committed < line.quantity)
        throw new Error(`insufficient inventory: ${line.sku}`);
    }
    const currency = assertSameCurrency(
      ...cart.lines.flatMap((line) => [line.unit_price, line.line_total]),
    );
    const subtotal = this.money(
      currency,
      cart.lines.reduce((sum, line) => sum + BigInt(line.line_total.amount_minor), 0n),
    );
    const zero = this.money(currency, 0n);
    const order: OrderSnapshot = {
      schema_version: '1',
      id: this.nextId('order'),
      revision: 1,
      tenant: identity.tenant,
      customer_id: identity.customer_id,
      lines: cart.lines,
      subtotal,
      tax: zero,
      discount: zero,
      total: subtotal,
      currency,
      status: 'paid',
    };
    const payment: PaymentSnapshot = {
      schema_version: '1',
      order_id: order.id,
      provider: 'reference-sandbox',
      payment_id: this.nextId('payment'),
      amount: subtotal,
      refunded_amount: zero,
      status: 'captured',
      observed_at: new Date().toISOString(),
    };
    const snapshots = cart.lines.map((line) => {
      const stock = this.inventory.get(line.sku);
      if (!stock) throw new Error(`unknown sku: ${line.sku}`);
      const updated = {
        ...stock,
        committed: stock.committed + line.quantity,
        revision: stock.revision + 1,
      };
      this.inventory.set(line.sku, updated);
      return updated;
    });
    this.orders.set(order.id, order);
    this.payments.set(order.id, payment);
    this.carts.set(cart.id, { ...cart, status: 'checked_out', revision: cart.revision + 1 });
    const result = { order, payment, inventory: snapshots };
    this.idempotency.set(key, { fingerprint, result });
    this.webhooks.set(order.id, [
      {
        schema_version: '1',
        event_id: this.nextId('event'),
        event_type: 'order.created',
        order_id: order.id,
        delivery_id: this.nextId('delivery'),
        status: 'delivered',
        attempts: 1,
        signature_valid: true,
        observed_at: new Date().toISOString(),
      },
    ]);
    return result;
  }

  getOrder(identity: CommerceIdentity, orderId: string): OrderSnapshot {
    const order = this.orders.get(orderId);
    if (!order || order.tenant !== identity.tenant || order.customer_id !== identity.customer_id)
      throw new Error('order not found');
    return order;
  }

  getPayment(identity: CommerceIdentity, orderId: string): PaymentSnapshot {
    this.getOrder(identity, orderId);
    const payment = this.payments.get(orderId);
    if (!payment) throw new Error('payment not found');
    return payment;
  }

  refund(
    identity: CommerceIdentity,
    orderId: string,
    amount: Money,
    idempotencyKey: string,
  ): RefundResult {
    const order = this.getOrder(identity, orderId);
    const payment = this.getPayment(identity, orderId);
    if (!idempotencyKey.trim()) throw new Error('idempotency key is required');
    assertSameCurrency(amount, payment.amount, payment.refunded_amount);
    if (BigInt(amount.amount_minor) <= 0n) throw new Error('refund amount must be positive');
    const key = `${identity.tenant}:${idempotencyKey}`;
    const fingerprint = JSON.stringify({ orderId, amount });
    const previous = this.refundIdempotency.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error('refund idempotency key reused with a different payload');
      return previous.result;
    }
    const alreadyRefunded = BigInt(payment.refunded_amount.amount_minor);
    const requested = BigInt(amount.amount_minor);
    const captured = BigInt(payment.amount.amount_minor);
    if (alreadyRefunded + requested > captured) throw new Error('refund exceeds captured amount');
    const refundedAmount = this.money(payment.amount.currency, alreadyRefunded + requested);
    const updatedPayment: PaymentSnapshot = {
      ...payment,
      refunded_amount: refundedAmount,
      status: alreadyRefunded + requested === captured ? 'refunded' : 'partially_refunded',
      observed_at: new Date().toISOString(),
    };
    const updatedOrder = {
      ...order,
      revision: order.revision + 1,
      status: updatedPayment.status === 'refunded' ? 'refunded' : order.status,
    };
    const refund: RefundSnapshot = {
      schema_version: '1',
      id: this.nextId('refund'),
      order_id: orderId,
      amount,
      status: 'succeeded',
      observed_at: updatedPayment.observed_at,
    };
    this.payments.set(orderId, updatedPayment);
    this.orders.set(orderId, updatedOrder);
    this.refunds.set(refund.id, refund);
    const result = { refund, payment: updatedPayment, order: updatedOrder };
    this.refundIdempotency.set(key, { fingerprint, result });
    return result;
  }

  getInventory(sku: string): InventorySnapshot {
    const stock = this.inventory.get(sku);
    if (!stock) throw new Error(`unknown sku: ${sku}`);
    return stock;
  }

  /** Exposes the reference merchant through the same async contract as real providers. */
  asAdapter(): CommerceAdapter {
    return {
      capabilities: async () => ({
        checkout: true,
        refunds: true,
        inventory_observer: true,
        webhook_observer: true,
        idempotency: true,
        tax_quote: true,
        shipping_quote: true,
      }),
      createCart: async (identity) => this.createCart(identity),
      addLine: async (identity, cartId, sku, quantity) =>
        this.addLine(identity, cartId, sku, quantity),
      checkout: async (identity, cartId, key) => this.checkout(identity, cartId, key),
      getOrder: async (identity, orderId) => this.getOrder(identity, orderId),
      getPayment: async (identity, orderId) => this.getPayment(identity, orderId),
      getInventory: async (sku) => this.getInventory(sku),
      refund: async (identity, orderId, amount, key) => this.refund(identity, orderId, amount, key),
      quoteTax: async (identity, cartId) => this.quoteTax(identity, cartId),
      quoteShipping: async (identity, cartId, destination) =>
        this.quoteShipping(identity, cartId, destination),
      observeWebhooks: async (orderId) => this.observeWebhooks(orderId),
    };
  }

  quoteTax(identity: CommerceIdentity, cartId: string): TaxQuote {
    const cart = this.authorizeCart(identity, cartId);
    const currency = assertSameCurrency(...cart.lines.map((line) => line.unit_price));
    return {
      schema_version: '1',
      provider: 'reference-sandbox',
      jurisdiction: 'reference-zero-tax',
      amount: { currency, amount_minor: '0' },
      observed_at: new Date().toISOString(),
    };
  }

  observeWebhooks(orderId: string): readonly WebhookObservation[] {
    return this.webhooks.get(orderId) ?? [];
  }

  quoteShipping(
    identity: CommerceIdentity,
    cartId: string,
    destination: ShippingAddress,
  ): ShippingQuote {
    const cart = this.authorizeCart(identity, cartId);
    const currency = assertSameCurrency(...cart.lines.map((line) => line.unit_price));
    ShippingAddress.parse(destination);
    return {
      schema_version: '1',
      destination,
      rates: [
        {
          id: 'standard',
          carrier: 'reference-carrier',
          service: 'standard',
          amount: { currency, amount_minor: '0' },
          estimated_days: 3,
        },
      ],
      observed_at: new Date().toISOString(),
    };
  }

  private authorizeCart(identity: CommerceIdentity, cartId: string): CartSnapshot {
    const cart = this.carts.get(cartId);
    if (!cart || cart.tenant !== identity.tenant || cart.customer_id !== identity.customer_id)
      throw new Error('cart not found');
    return cart;
  }

  private money(currency: string, amount: bigint): Money {
    return { currency, amount_minor: amount.toString() };
  }
  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }
}

export function assertSameCurrency(...money: Money[]): string {
  const currency = money[0]?.currency;
  if (!currency || money.some((item) => item.currency !== currency)) {
    throw new Error('cross-currency arithmetic requires an explicit FX operation');
  }
  return currency;
}

export function assertMoneyNonNegative(money: Money, label = 'money'): void {
  Money.parse(money);
  if (BigInt(money.amount_minor) < 0n) throw new Error(`${label} cannot be negative`);
}

export function assertCartIntegrity(cart: CartSnapshot): void {
  const currency =
    cart.lines.length > 0
      ? assertSameCurrency(...cart.lines.map((line) => line.unit_price))
      : undefined;
  for (const line of cart.lines) {
    assertMoneyNonNegative(line.unit_price, `${line.sku}.unit_price`);
    assertMoneyNonNegative(line.line_total, `${line.sku}.line_total`);
    const expected = BigInt(line.unit_price.amount_minor) * BigInt(line.quantity);
    if (BigInt(line.line_total.amount_minor) !== expected) {
      throw new Error(`line total mismatch for ${line.sku}`);
    }
    if (currency && line.line_total.currency !== currency) {
      throw new Error(`line total currency mismatch for ${line.sku}`);
    }
  }
}

export function assertOrderIntegrity(order: OrderSnapshot): void {
  assertCartIntegrity({
    schema_version: '1',
    id: `order-lines-${order.id}`,
    tenant: order.tenant,
    customer_id: order.customer_id,
    revision: 0,
    lines: order.lines,
    status: 'checked_out',
  });
  const currency = assertSameCurrency(order.subtotal, order.tax, order.discount, order.total);
  const subtotal = order.lines.reduce(
    (sum, line) => sum + BigInt(line.line_total.amount_minor),
    0n,
  );
  const expectedTotal =
    subtotal + BigInt(order.tax.amount_minor) - BigInt(order.discount.amount_minor);
  if (order.subtotal.currency !== currency || BigInt(order.subtotal.amount_minor) !== subtotal) {
    throw new Error('order subtotal does not match its lines');
  }
  if (BigInt(order.total.amount_minor) !== expectedTotal || expectedTotal < 0n) {
    throw new Error('order total does not match subtotal, tax, and discount');
  }
}

export function assertPaymentIntegrity(payment: PaymentSnapshot): void {
  assertSameCurrency(payment.amount, payment.refunded_amount);
  if (BigInt(payment.refunded_amount.amount_minor) > BigInt(payment.amount.amount_minor)) {
    throw new Error('payment refunded amount exceeds captured amount');
  }
  const fullyRefunded =
    BigInt(payment.refunded_amount.amount_minor) === BigInt(payment.amount.amount_minor);
  if (fullyRefunded !== (payment.status === 'refunded')) {
    throw new Error('payment refund status does not match refunded amount');
  }
}

export function assertInventoryIntegrity(snapshot: InventorySnapshot): void {
  if (snapshot.reserved + snapshot.committed > snapshot.on_hand && !snapshot.backorder_allowed) {
    throw new Error(`inventory oversell: ${snapshot.sku} exceeds on_hand`);
  }
  if (snapshot.revision < 0) throw new Error(`inventory revision is invalid for ${snapshot.sku}`);
}

function validateCheckoutResult(result: CheckoutResult): CheckoutResult {
  const order = OrderSnapshot.parse(result.order);
  const payment = PaymentSnapshot.parse(result.payment);
  const inventory = result.inventory.map((snapshot) => InventorySnapshot.parse(snapshot));
  assertOrderIntegrity(order);
  assertPaymentIntegrity(payment);
  inventory.forEach(assertInventoryIntegrity);
  if (payment.order_id !== order.id || payment.amount.currency !== order.currency) {
    throw new Error('checkout payment does not belong to order');
  }
  return { order, payment, inventory };
}

function validateRefundResult(result: RefundResult): RefundResult {
  const refund = RefundSnapshot.parse(result.refund);
  const payment = PaymentSnapshot.parse(result.payment);
  const order = OrderSnapshot.parse(result.order);
  assertOrderIntegrity(order);
  assertPaymentIntegrity(payment);
  assertSameCurrency(refund.amount, payment.amount, payment.refunded_amount);
  if (refund.order_id !== order.id || payment.order_id !== order.id) {
    throw new Error('refund does not belong to the returned order');
  }
  if (refund.status !== 'succeeded') throw new Error('refund was not successful');
  return { refund, payment, order };
}

export function assertNoOversell(snapshot: InventorySnapshot): void {
  if (!snapshot.backorder_allowed && snapshot.reserved + snapshot.committed > snapshot.on_hand) {
    throw new Error(`inventory oversell: ${snapshot.sku} exceeds on_hand`);
  }
}
