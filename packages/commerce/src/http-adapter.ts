import {
  type CancellationResult,
  CancellationSnapshot,
  CartSnapshot,
  ChargebackSnapshot,
  type CheckoutResult,
  type CommerceAdapter,
  CommerceCapabilities,
  type CommerceContext,
  type CommerceIdentity,
  type DisputeObservation,
  DunningAttemptSnapshot,
  type DunningObservation,
  type FulfillmentLine,
  FulfillmentSnapshot,
  InventorySnapshot,
  LoyaltyAccountSnapshot,
  type LoyaltyObservation,
  LoyaltyTransactionSnapshot,
  type Money,
  OrderSnapshot,
  PaymentSnapshot,
  type RefundResult,
  RefundSnapshot,
  ReturnRequestSnapshot,
  type SettlementObservation,
  SettlementSnapshot,
  type ShippingAddress,
  ShippingQuote,
  SubscriptionSnapshot,
  TaxQuote,
  WebhookObservation,
} from './index.js';

export interface HttpCommerceAdapterOptions {
  baseUrl: string;
  allowedOrigins?: readonly string[];
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
  headers?: (
    context: CommerceContext,
    identity?: CommerceIdentity,
  ) => Readonly<Record<string, string>>;
  paths?: Partial<{
    capabilities: string;
    carts: string;
    order: string;
    payment: string;
    inventory: string;
    refund: string;
    cancellation: string;
    settlement: string;
    fulfillments: string;
    returns: string;
    subscriptions: string;
    subscription: string;
    dunning: string;
    disputes: string;
    tax: string;
    shipping: string;
    webhooks: string;
    loyalty: string;
  }>;
}

function pathTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/:([a-z_]+)/g, (_match, key: string) => {
    const value = values[key];
    if (!value) throw new Error(`missing path value: ${key}`);
    return encodeURIComponent(value);
  });
}

/** Provider-neutral HTTP adapter for live commerce systems under test. */
export class HttpCommerceAdapter implements CommerceAdapter {
  private readonly baseUrl: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly headers: NonNullable<HttpCommerceAdapterOptions['headers']>;
  private readonly paths: Required<NonNullable<HttpCommerceAdapterOptions['paths']>>;

  constructor(opts: HttpCommerceAdapterOptions) {
    this.baseUrl = new URL(opts.baseUrl).toString().replace(/\/$/, '');
    this.allowedOrigins = new Set(opts.allowedOrigins ?? [new URL(this.baseUrl).origin]);
    this.maxResponseBytes = opts.maxResponseBytes ?? 1_048_576;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1)
      throw new Error('commerce maxResponseBytes must be a positive integer');
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('commerce adapter requires fetch');
    this.headers = opts.headers ?? (() => ({}));
    this.paths = {
      capabilities: '/aqa/capabilities',
      carts: '/carts',
      order: '/orders/:order_id',
      payment: '/orders/:order_id/payment',
      inventory: '/inventory/:sku',
      refund: '/orders/:order_id/refunds',
      cancellation: '/orders/:order_id/cancellation',
      settlement: '/orders/:order_id/settlement',
      fulfillments: '/orders/:order_id/fulfillments',
      returns: '/orders/:order_id/returns',
      subscriptions: '/subscriptions',
      subscription: '/subscriptions/:subscription_id',
      dunning: '/subscriptions/:subscription_id/dunning',
      disputes: '/orders/:order_id/disputes',
      tax: '/carts/:cart_id/tax',
      shipping: '/carts/:cart_id/shipping',
      webhooks: '/orders/:order_id/webhooks',
      loyalty: '/customers/:customer_id/loyalty',
      ...opts.paths,
    };
  }

  async capabilities(context: CommerceContext) {
    return CommerceCapabilities.parse(await this.request('GET', this.paths.capabilities, context));
  }

  async createCart(identity: CommerceIdentity) {
    const context = this.context(identity);
    return CartSnapshot.parse(await this.request('POST', this.paths.carts, context, identity));
  }

  async addLine(identity: CommerceIdentity, cartId: string, sku: string, quantity: number) {
    const context = this.context(identity);
    return CartSnapshot.parse(
      await this.request(
        'POST',
        `${this.paths.carts}/${encodeURIComponent(cartId)}/lines`,
        context,
        identity,
        {
          sku,
          quantity,
        },
      ),
    );
  }

  async checkout(
    identity: CommerceIdentity,
    cartId: string,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    const context = this.context(identity);
    const raw = await this.request(
      'POST',
      `${this.paths.carts}/${encodeURIComponent(cartId)}/checkout`,
      context,
      identity,
      { idempotency_key: idempotencyKey },
      { 'Idempotency-Key': idempotencyKey },
    );
    const body = raw as Record<string, unknown>;
    return {
      order: OrderSnapshot.parse(body.order),
      payment: PaymentSnapshot.parse(body.payment),
      inventory: Array.isArray(body.inventory)
        ? body.inventory.map((item) => InventorySnapshot.parse(item))
        : [],
    };
  }

  async getOrder(identity: CommerceIdentity, orderId: string) {
    return OrderSnapshot.parse(
      await this.request(
        'GET',
        pathTemplate(this.paths.order, { order_id: orderId }),
        this.context(identity),
        identity,
      ),
    );
  }

  async getPayment(identity: CommerceIdentity, orderId: string) {
    return PaymentSnapshot.parse(
      await this.request(
        'GET',
        pathTemplate(this.paths.payment, { order_id: orderId }),
        this.context(identity),
        identity,
      ),
    );
  }

  async getInventory(sku: string) {
    return InventorySnapshot.parse(
      await this.request('GET', pathTemplate(this.paths.inventory, { sku }), this.context()),
    );
  }

  async refund(
    identity: CommerceIdentity,
    orderId: string,
    amount: Money,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const raw = (await this.request(
      'POST',
      pathTemplate(this.paths.refund, { order_id: orderId }),
      this.context(identity),
      identity,
      { amount, idempotency_key: idempotencyKey },
      { 'Idempotency-Key': idempotencyKey },
    )) as Record<string, unknown>;
    return {
      refund: RefundSnapshot.parse(raw.refund),
      payment: PaymentSnapshot.parse(raw.payment),
      order: OrderSnapshot.parse(raw.order),
    };
  }

  async cancel(
    identity: CommerceIdentity,
    orderId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<CancellationResult> {
    const raw = (await this.request(
      'POST',
      pathTemplate(this.paths.cancellation, { order_id: orderId }),
      this.context(identity),
      identity,
      { reason, idempotency_key: idempotencyKey },
      { 'Idempotency-Key': idempotencyKey },
    )) as Record<string, unknown>;
    return {
      cancellation: CancellationSnapshot.parse(raw.cancellation),
      payment: PaymentSnapshot.parse(raw.payment),
      order: OrderSnapshot.parse(raw.order),
      ...(raw.refund ? { refund: RefundSnapshot.parse(raw.refund) } : {}),
    };
  }

  async observeSettlement(
    identity: CommerceIdentity,
    orderId: string,
  ): Promise<SettlementObservation> {
    const raw = (await this.request(
      'GET',
      pathTemplate(this.paths.settlement, { order_id: orderId }),
      this.context(identity),
      identity,
    )) as Record<string, unknown>;
    if (!Array.isArray(raw.refunds) || !Array.isArray(raw.chargebacks))
      throw new Error('commerce settlement response must include refunds and chargebacks arrays');
    return {
      payment: PaymentSnapshot.parse(raw.payment),
      refunds: raw.refunds.map((item) => RefundSnapshot.parse(item)),
      chargebacks: raw.chargebacks.map((item) => ChargebackSnapshot.parse(item)),
      settlement: SettlementSnapshot.parse(raw.settlement),
    };
  }

  async observeFulfillments(identity: CommerceIdentity, orderId: string) {
    const raw = await this.request(
      'GET',
      pathTemplate(this.paths.fulfillments, { order_id: orderId }),
      this.context(identity),
      identity,
    );
    if (!Array.isArray(raw)) throw new Error('commerce fulfillment response must be an array');
    return raw.map((item) => FulfillmentSnapshot.parse(item));
  }

  async requestReturn(
    identity: CommerceIdentity,
    orderId: string,
    lines: readonly FulfillmentLine[],
    amount: Money,
    reason: string,
    idempotencyKey: string,
  ) {
    return ReturnRequestSnapshot.parse(
      await this.request(
        'POST',
        pathTemplate(this.paths.returns, { order_id: orderId }),
        this.context(identity),
        identity,
        { lines, amount, reason, idempotency_key: idempotencyKey },
        { 'Idempotency-Key': idempotencyKey },
      ),
    );
  }

  async createSubscription(
    identity: CommerceIdentity,
    plan: string,
    amount: Money,
    interval: SubscriptionSnapshot['interval'],
    idempotencyKey: string,
  ) {
    return SubscriptionSnapshot.parse(
      await this.request(
        'POST',
        this.paths.subscriptions,
        this.context(identity),
        identity,
        { plan, amount, interval, idempotency_key: idempotencyKey },
        { 'Idempotency-Key': idempotencyKey },
      ),
    );
  }

  async getSubscription(identity: CommerceIdentity, subscriptionId: string) {
    return SubscriptionSnapshot.parse(
      await this.request(
        'GET',
        pathTemplate(this.paths.subscription, { subscription_id: subscriptionId }),
        this.context(identity),
        identity,
      ),
    );
  }

  async observeDunning(
    identity: CommerceIdentity,
    subscriptionId: string,
  ): Promise<DunningObservation> {
    const raw = (await this.request(
      'GET',
      pathTemplate(this.paths.dunning, { subscription_id: subscriptionId }),
      this.context(identity),
      identity,
    )) as Record<string, unknown>;
    if (!Array.isArray(raw.attempts))
      throw new Error('commerce dunning response must include attempts array');
    return {
      subscription: SubscriptionSnapshot.parse(raw.subscription),
      attempts: raw.attempts.map((item) => DunningAttemptSnapshot.parse(item)),
    };
  }

  async observeDisputes(identity: CommerceIdentity, orderId: string): Promise<DisputeObservation> {
    const raw = (await this.request(
      'GET',
      pathTemplate(this.paths.disputes, { order_id: orderId }),
      this.context(identity),
      identity,
    )) as Record<string, unknown>;
    if (!Array.isArray(raw.chargebacks))
      throw new Error('commerce dispute response must include chargebacks array');
    return {
      order: OrderSnapshot.parse(raw.order),
      payment: PaymentSnapshot.parse(raw.payment),
      chargebacks: raw.chargebacks.map((item) => ChargebackSnapshot.parse(item)),
    };
  }

  async quoteTax(identity: CommerceIdentity, cartId: string) {
    return TaxQuote.parse(
      await this.request(
        'POST',
        pathTemplate(this.paths.tax, { cart_id: cartId }),
        this.context(identity),
        identity,
      ),
    );
  }

  async quoteShipping(identity: CommerceIdentity, cartId: string, destination: ShippingAddress) {
    return ShippingQuote.parse(
      await this.request(
        'POST',
        pathTemplate(this.paths.shipping, { cart_id: cartId }),
        this.context(identity),
        identity,
        { destination },
      ),
    );
  }

  async observeWebhooks(orderId: string) {
    const raw = await this.request(
      'GET',
      pathTemplate(this.paths.webhooks, { order_id: orderId }),
      this.context(),
    );
    if (!Array.isArray(raw)) throw new Error('commerce webhook response must be an array');
    return raw.map((item) => WebhookObservation.parse(item));
  }

  async observeLoyalty(identity: CommerceIdentity): Promise<LoyaltyObservation> {
    const raw = (await this.request(
      'GET',
      pathTemplate(this.paths.loyalty, { customer_id: identity.customer_id }),
      this.context(identity),
      identity,
    )) as Record<string, unknown>;
    if (!Array.isArray(raw.transactions))
      throw new Error('commerce loyalty response must include transactions array');
    return {
      account: LoyaltyAccountSnapshot.parse(raw.account),
      transactions: raw.transactions.map((item) => LoyaltyTransactionSnapshot.parse(item)),
    };
  }

  private context(identity?: CommerceIdentity): CommerceContext {
    return {
      schema_version: '1',
      merchant: 'http-adapter',
      environment: 'sandbox',
      tenant: identity?.tenant ?? 'observer',
      run_id: 'http-commerce-adapter',
      policy_revision: 'runtime',
      capabilities: {},
    };
  }

  private async request(
    method: string,
    path: string,
    context: CommerceContext,
    identity?: CommerceIdentity,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (!this.allowedOrigins.has(url.origin))
      throw new Error(`commerce origin is not allowlisted: ${url.origin}`);
    const headers = {
      Accept: 'application/json',
      ...this.headers(context, identity),
      ...extraHeaders,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxResponseBytes)
      throw new Error('commerce response exceeds configured byte limit');
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Preserve a bounded response for the diagnostic below.
    }
    if (!response.ok)
      throw new Error(
        `commerce HTTP ${response.status}: ${typeof parsed === 'string' ? parsed : response.statusText}`,
      );
    return parsed;
  }
}
