import type { Money } from './index.js';

export type StripePaymentIntentObservation = {
  provider: 'stripe';
  payment_id: string;
  amount: Money;
  amount_received: Money;
  status: string;
  observed_at: string;
};

export type StripeRefundObservation = {
  provider: 'stripe';
  refund_id: string;
  payment_id: string;
  amount: Money;
  status: string;
  observed_at: string;
};

export type StripePaymentGatewayOptions = {
  secretKey: string;
  apiVersion?: string;
  baseUrl?: string;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
};

export type StripeCreatePaymentIntent = {
  amount: Money;
  order_id: string;
  customer_id?: string;
  idempotency_key: string;
};

export type StripeCreateRefund = {
  payment_id: string;
  amount?: Money;
  idempotency_key: string;
};

/**
 * Minimal REST boundary for Stripe PaymentIntents and refunds.
 *
 * The gateway deliberately returns provider observations instead of pretending
 * to be a complete CommerceAdapter: carts, inventory, fulfilment and order
 * ownership remain merchant-system responsibilities. All write calls require
 * an explicit idempotency key and every response is size-bounded and parsed.
 */
export class StripePaymentGateway {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly apiVersion: string | undefined;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: StripePaymentGatewayOptions) {
    if (!/^sk_(?:test|live)_[A-Za-z0-9]+$/.test(options.secretKey))
      throw new Error('[commerce/stripe] secretKey must be a Stripe secret key');
    const baseUrl = new URL(options.baseUrl ?? 'https://api.stripe.com/v1/');
    if (baseUrl.protocol !== 'https:' && !isLocalHttp(baseUrl))
      throw new Error('[commerce/stripe] baseUrl must use HTTPS');
    this.baseUrl = `${baseUrl.toString().replace(/\/$/, '')}/`;
    this.secretKey = options.secretKey;
    this.apiVersion = validateOptionalHeader(options.apiVersion, 'apiVersion');
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1)
      throw new Error('[commerce/stripe] maxResponseBytes must be a positive integer');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('[commerce/stripe] fetch is required');
  }

  async createPaymentIntent(
    input: StripeCreatePaymentIntent,
  ): Promise<StripePaymentIntentObservation> {
    const amount = minorUnits(input.amount);
    const orderId = requiredText(input.order_id, 'order_id');
    const customerId =
      input.customer_id === undefined ? undefined : requiredText(input.customer_id, 'customer_id');
    const idempotencyKey = idempotency(input.idempotency_key);
    const body = new URLSearchParams({
      amount: String(amount),
      currency: input.amount.currency.toLowerCase(),
      'metadata[order_id]': orderId,
      ...(customerId ? { customer: customerId } : {}),
    });
    const response = await this.request('payment_intents', body, idempotencyKey);
    return parsePaymentIntent(response);
  }

  async retrievePaymentIntent(paymentId: string): Promise<StripePaymentIntentObservation> {
    const id = providerId(paymentId, 'payment_id');
    return parsePaymentIntent(await this.request(`payment_intents/${encodeURIComponent(id)}`));
  }

  async createRefund(input: StripeCreateRefund): Promise<StripeRefundObservation> {
    const paymentId = providerId(input.payment_id, 'payment_id');
    const idempotencyKey = idempotency(input.idempotency_key);
    const body = new URLSearchParams({ payment_intent: paymentId });
    if (input.amount !== undefined) body.set('amount', String(minorUnits(input.amount)));
    if (input.amount !== undefined) body.set('currency', input.amount.currency.toLowerCase());
    const response = await this.request('refunds', body, idempotencyKey);
    return parseRefund(response, paymentId);
  }

  private async request(
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.secretKey}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(this.apiVersion ? { 'Stripe-Version': this.apiVersion } : {}),
      },
      ...(body ? { body } : {}),
      redirect: 'manual',
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxResponseBytes)
      throw new Error('[commerce/stripe] response exceeds configured limit');
    if (!response.ok) throw new Error(`[commerce/stripe] provider HTTP ${response.status}`);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('[commerce/stripe] provider returned invalid JSON');
    }
  }
}

function parsePaymentIntent(value: unknown): StripePaymentIntentObservation {
  const object = record(value);
  if (object.object !== 'payment_intent')
    throw new Error('[commerce/stripe] expected PaymentIntent');
  const currency = currencyCode(object.currency);
  const amount = money(object.amount, currency, 'amount');
  return {
    provider: 'stripe',
    payment_id: providerId(object.id, 'payment_intent.id'),
    amount,
    amount_received: money(object.amount_received ?? 0, currency, 'amount_received'),
    status: requiredText(object.status, 'payment_intent.status'),
    observed_at: new Date().toISOString(),
  };
}

function parseRefund(value: unknown, paymentId: string): StripeRefundObservation {
  const object = record(value);
  if (object.object !== 'refund') throw new Error('[commerce/stripe] expected Refund');
  const currency = currencyCode(object.currency);
  return {
    provider: 'stripe',
    refund_id: providerId(object.id, 'refund.id'),
    payment_id: paymentId,
    amount: money(object.amount, currency, 'refund.amount'),
    status: requiredText(object.status, 'refund.status'),
    observed_at: new Date().toISOString(),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('[commerce/stripe] provider response must be an object');
  return value as Record<string, unknown>;
}

function money(value: unknown, currency: string, field: string): Money {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`[commerce/stripe] ${field} must be a non-negative safe integer`);
  return { currency, amount_minor: String(value) };
}

function minorUnits(value: Money): number {
  const parsed = Number(value.amount_minor);
  if (!/^[A-Z]{3}$/.test(value.currency) || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('[commerce/stripe] amount must contain an ISO currency and safe minor units');
  return parsed;
}

function currencyCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z]{3}$/.test(value))
    throw new Error('[commerce/stripe] provider currency is invalid');
  return value.toUpperCase();
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value))
    throw new Error(`[commerce/stripe] ${field} is required`);
  return value.trim();
}

function providerId(value: unknown, field: string): string {
  const id = requiredText(value, field);
  if (id.length > 255) throw new Error(`[commerce/stripe] ${field} is too long`);
  return id;
}

function idempotency(value: string): string {
  const key = requiredText(value, 'idempotency_key');
  if (key.length > 255) throw new Error('[commerce/stripe] idempotency_key is too long');
  return key;
}

function validateOptionalHeader(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const result = requiredText(value, field);
  if (result.length > 128) throw new Error(`[commerce/stripe] ${field} is too long`);
  return result;
}

function isLocalHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  );
}
