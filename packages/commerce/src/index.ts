import { z } from 'zod';

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

export const RefundSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  order_id: z.string().min(1),
  amount: Money,
  status: z.enum(['pending', 'succeeded', 'failed']),
  observed_at: z.string().datetime({ offset: true }),
});
export type RefundSnapshot = z.infer<typeof RefundSnapshot>;

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
        webhook_observer: false,
        idempotency: true,
      }),
      createCart: async (identity) => this.createCart(identity),
      addLine: async (identity, cartId, sku, quantity) =>
        this.addLine(identity, cartId, sku, quantity),
      checkout: async (identity, cartId, key) => this.checkout(identity, cartId, key),
      getOrder: async (identity, orderId) => this.getOrder(identity, orderId),
      getPayment: async (identity, orderId) => this.getPayment(identity, orderId),
      getInventory: async (sku) => this.getInventory(sku),
      refund: async (identity, orderId, amount, key) => this.refund(identity, orderId, amount, key),
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

export function assertNoOversell(snapshot: InventorySnapshot): void {
  if (!snapshot.backorder_allowed && snapshot.reserved + snapshot.committed > snapshot.on_hand) {
    throw new Error(`inventory oversell: ${snapshot.sku} exceeds on_hand`);
  }
}
