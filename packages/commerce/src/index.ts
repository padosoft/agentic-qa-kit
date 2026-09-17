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
  status: z.enum(['pending', 'authorized', 'captured', 'partially_refunded', 'refunded', 'failed']),
  observed_at: z.string().datetime({ offset: true }),
});
export type PaymentSnapshot = z.infer<typeof PaymentSnapshot>;

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

  getInventory(sku: string): InventorySnapshot {
    const stock = this.inventory.get(sku);
    if (!stock) throw new Error(`unknown sku: ${sku}`);
    return stock;
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

export function assertNoOversell(snapshot: InventorySnapshot): void {
  if (!snapshot.backorder_allowed && snapshot.reserved + snapshot.committed > snapshot.on_hand) {
    throw new Error(`inventory oversell: ${snapshot.sku} exceeds on_hand`);
  }
}
