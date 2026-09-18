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

export type StripeRefundReconciliationInput = {
  payment_id: string;
  expected_captured: Money;
  expected_refunded: Money;
};

export type StripeRefundReconciliation = {
  provider: 'stripe';
  payment: StripePaymentIntentObservation;
  refunds: readonly StripeRefundObservation[];
  refunded_amount: Money;
  observed_at: string;
};

export type StripeDisputeObservation = {
  provider: 'stripe';
  dispute_id: string;
  payment_id: string;
  amount: Money;
  status: StripeDisputeStatus;
  evidence_due_at?: string;
  observed_at: string;
};

export type StripeDisputeStatus =
  | 'warning_needs_response'
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost';

export type StripeDisputeReconciliationInput = {
  payment_id: string;
  expected_disputed: Money;
};

export type StripeDisputeReconciliation = {
  provider: 'stripe';
  payment: StripePaymentIntentObservation;
  disputes: readonly StripeDisputeObservation[];
  disputed_amount: Money;
  observed_at: string;
};

export type StripePayoutStatus = 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';

export type StripeSignedMoney = {
  currency: string;
  amount_minor: string;
};

export type StripePayoutObservation = {
  provider: 'stripe';
  payout_id: string;
  amount: Money;
  currency: string;
  status: StripePayoutStatus;
  balance_transaction_id: string;
  balance_transaction_type: string;
  balance_transaction_source: string;
  balance_transaction_amount: StripeSignedMoney;
  fee_amount: Money;
  net_amount: StripeSignedMoney;
  observed_at: string;
};

export type StripePayoutReconciliationInput = {
  payout_id: string;
  expected_amount: Money;
  expected_fee: Money;
  expected_status?: StripePayoutStatus;
};

/**
 * Minimal REST boundary for Stripe PaymentIntents, refunds and disputes.
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

  /** Read the complete bounded refund ledger for one PaymentIntent. */
  async listRefunds(paymentId: string): Promise<StripeRefundObservation[]> {
    const id = providerId(paymentId, 'payment_id');
    const response = record(
      await this.request(`refunds?payment_intent=${encodeURIComponent(id)}&limit=100`),
    );
    if (response.object !== 'list' || !Array.isArray(response.data))
      throw new Error('[commerce/stripe] refund list response is invalid');
    if (response.has_more === true)
      throw new Error('[commerce/stripe] refund list exceeds the bounded reconciliation page');
    return response.data.map((item) => parseRefund(item, id));
  }

  /** Read the complete bounded dispute ledger for one PaymentIntent. */
  async listDisputes(paymentId: string): Promise<StripeDisputeObservation[]> {
    const id = providerId(paymentId, 'payment_id');
    const response = record(
      await this.request(`disputes?payment_intent=${encodeURIComponent(id)}&limit=100`),
    );
    if (response.object !== 'list' || !Array.isArray(response.data))
      throw new Error('[commerce/stripe] dispute list response is invalid');
    if (response.has_more === true)
      throw new Error('[commerce/stripe] dispute list exceeds the bounded dispute page');
    return response.data.map((item) => parseDispute(item, id));
  }

  /** Read a payout and its linked balance transaction as one observation. */
  async retrievePayout(payoutId: string): Promise<StripePayoutObservation> {
    const id = providerId(payoutId, 'payout_id');
    const payout = parsePayout(await this.request(`payouts/${encodeURIComponent(id)}`));
    const balanceTransaction = parseBalanceTransaction(
      await this.request(
        `balance_transactions/${encodeURIComponent(payout.balance_transaction_id)}`,
      ),
    );
    return {
      provider: 'stripe',
      payout_id: id,
      amount: payout.amount,
      currency: payout.amount.currency,
      status: payout.status,
      balance_transaction_id: payout.balance_transaction_id,
      balance_transaction_type: balanceTransaction.type,
      balance_transaction_source: balanceTransaction.source,
      balance_transaction_amount: balanceTransaction.amount,
      fee_amount: balanceTransaction.fee,
      net_amount: balanceTransaction.net,
      observed_at: new Date().toISOString(),
    };
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

/**
 * Reconcile merchant-authoritative payment/refund totals with Stripe's live
 * read-back. Disputes and payouts remain separate provider observations.
 */
export async function reconcileStripeRefunds(
  gateway: StripePaymentGateway,
  input: StripeRefundReconciliationInput,
): Promise<StripeRefundReconciliation> {
  const paymentId = providerId(input.payment_id, 'payment_id');
  const expectedCaptured = validateMoney(input.expected_captured, 'expected_captured');
  const expectedRefunded = validateMoney(input.expected_refunded, 'expected_refunded');
  if (expectedCaptured.currency !== expectedRefunded.currency)
    throw new Error('[commerce/stripe] expected totals use different currencies');
  const payment = await gateway.retrievePaymentIntent(paymentId);
  if (payment.status !== 'succeeded')
    throw new Error('[commerce/stripe] payment is not provider-captured');
  if (payment.amount.currency !== expectedCaptured.currency)
    throw new Error('[commerce/stripe] provider payment currency mismatch');
  if (BigInt(payment.amount_received.amount_minor) !== BigInt(expectedCaptured.amount_minor))
    throw new Error('[commerce/stripe] provider captured amount does not reconcile');
  const refunds = await gateway.listRefunds(paymentId);
  let refundedMinor = 0n;
  for (const refund of refunds) {
    if (refund.status !== 'succeeded')
      throw new Error('[commerce/stripe] refund ledger contains a non-successful refund');
    if (refund.amount.currency !== expectedRefunded.currency)
      throw new Error('[commerce/stripe] provider refund currency mismatch');
    refundedMinor += BigInt(refund.amount.amount_minor);
  }
  if (refundedMinor !== BigInt(expectedRefunded.amount_minor))
    throw new Error('[commerce/stripe] provider refund total does not reconcile');
  return {
    provider: 'stripe',
    payment,
    refunds,
    refunded_amount: expectedRefunded,
    observed_at: new Date().toISOString(),
  };
}

/**
 * Reconcile provider-reported dispute exposure with the merchant ledger.
 * This is intentionally separate from settlement: a won dispute is still a
 * provider observation, while only a lost dispute is a settled chargeback.
 */
export async function reconcileStripeDisputes(
  gateway: StripePaymentGateway,
  input: StripeDisputeReconciliationInput,
): Promise<StripeDisputeReconciliation> {
  const paymentId = providerId(input.payment_id, 'payment_id');
  const expectedDisputed = validateMoney(input.expected_disputed, 'expected_disputed');
  const payment = await gateway.retrievePaymentIntent(paymentId);
  if (payment.status !== 'succeeded')
    throw new Error('[commerce/stripe] payment is not provider-captured');
  if (payment.amount.currency !== expectedDisputed.currency)
    throw new Error('[commerce/stripe] provider payment currency mismatch');
  const disputes = await gateway.listDisputes(paymentId);
  let disputedMinor = 0n;
  for (const dispute of disputes) {
    if (dispute.amount.currency !== expectedDisputed.currency)
      throw new Error('[commerce/stripe] provider dispute currency mismatch');
    disputedMinor += BigInt(dispute.amount.amount_minor);
  }
  if (disputedMinor !== BigInt(expectedDisputed.amount_minor))
    throw new Error('[commerce/stripe] provider dispute total does not reconcile');
  return {
    provider: 'stripe',
    payment,
    disputes,
    disputed_amount: expectedDisputed,
    observed_at: new Date().toISOString(),
  };
}

/**
 * Reconcile a payout with the linked Stripe balance transaction. The signed
 * balance values remain visible because a payout transaction is a debit from
 * the Stripe balance; no order or payment linkage is inferred here.
 */
export async function reconcileStripePayout(
  gateway: StripePaymentGateway,
  input: StripePayoutReconciliationInput,
): Promise<StripePayoutObservation> {
  const payoutId = providerId(input.payout_id, 'payout_id');
  const expectedAmount = validateMoney(input.expected_amount, 'expected_amount');
  const expectedFee = validateMoney(input.expected_fee, 'expected_fee');
  if (expectedAmount.currency !== expectedFee.currency)
    throw new Error('[commerce/stripe] expected payout values use different currencies');
  const payout = await gateway.retrievePayout(payoutId);
  if (payout.amount.currency !== expectedAmount.currency)
    throw new Error('[commerce/stripe] provider payout currency mismatch');
  if (BigInt(payout.amount.amount_minor) !== BigInt(expectedAmount.amount_minor))
    throw new Error('[commerce/stripe] provider payout amount does not reconcile');
  if (BigInt(payout.fee_amount.amount_minor) !== BigInt(expectedFee.amount_minor))
    throw new Error('[commerce/stripe] provider payout fee does not reconcile');
  if (input.expected_status !== undefined && payout.status !== input.expected_status)
    throw new Error('[commerce/stripe] provider payout status does not reconcile');
  if (payout.balance_transaction_type !== 'payout')
    throw new Error(
      '[commerce/stripe] linked balance transaction is not a payout balance transaction',
    );
  if (payout.balance_transaction_source !== payoutId)
    throw new Error('[commerce/stripe] balance transaction source does not link to payout');
  if (payout.balance_transaction_amount.currency !== expectedAmount.currency)
    throw new Error('[commerce/stripe] provider balance transaction currency mismatch');
  if (
    BigInt(payout.balance_transaction_amount.amount_minor) !== -BigInt(expectedAmount.amount_minor)
  )
    throw new Error('[commerce/stripe] payout balance transaction amount does not reconcile');
  const expectedNet =
    BigInt(payout.balance_transaction_amount.amount_minor) - BigInt(expectedFee.amount_minor);
  if (BigInt(payout.net_amount.amount_minor) !== expectedNet)
    throw new Error('[commerce/stripe] payout balance transaction net does not reconcile');
  return payout;
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

function parseDispute(value: unknown, paymentId: string): StripeDisputeObservation {
  const object = record(value);
  if (object.object !== 'dispute') throw new Error('[commerce/stripe] expected Dispute');
  if (object.payment_intent !== paymentId)
    throw new Error('[commerce/stripe] dispute belongs to a different PaymentIntent');
  const status = disputeStatus(object.status);
  const evidenceDetails = object.evidence_details;
  let evidenceDueAt: string | undefined;
  if (evidenceDetails !== undefined) {
    const details = record(evidenceDetails);
    if (details.due_by !== undefined) {
      if (!Number.isSafeInteger(details.due_by) || (details.due_by as number) < 0)
        throw new Error('[commerce/stripe] dispute evidence due_by is invalid');
      evidenceDueAt = new Date((details.due_by as number) * 1000).toISOString();
    }
  }
  return {
    provider: 'stripe',
    dispute_id: providerId(object.id, 'dispute.id'),
    payment_id: paymentId,
    amount: money(object.amount, currencyCode(object.currency), 'dispute.amount'),
    status,
    ...(evidenceDueAt ? { evidence_due_at: evidenceDueAt } : {}),
    observed_at: new Date().toISOString(),
  };
}

function parsePayout(value: unknown): {
  amount: Money;
  balance_transaction_id: string;
  status: StripePayoutStatus;
} {
  const object = record(value);
  if (object.object !== 'payout') throw new Error('[commerce/stripe] expected Payout');
  return {
    amount: money(object.amount, currencyCode(object.currency), 'payout.amount'),
    balance_transaction_id: providerId(object.balance_transaction, 'payout.balance_transaction'),
    status: payoutStatus(object.status),
  };
}

function parseBalanceTransaction(value: unknown): {
  type: string;
  source: string;
  amount: StripeSignedMoney;
  fee: Money;
  net: StripeSignedMoney;
} {
  const object = record(value);
  if (object.object !== 'balance_transaction')
    throw new Error('[commerce/stripe] expected BalanceTransaction');
  const currency = currencyCode(object.currency);
  return {
    type: requiredText(object.type, 'balance_transaction.type'),
    source: providerId(object.source, 'balance_transaction.source'),
    amount: signedMoney(object.amount, currency, 'balance_transaction.amount'),
    fee: money(object.fee, currency, 'balance_transaction.fee'),
    net: signedMoney(object.net, currency, 'balance_transaction.net'),
  };
}

function disputeStatus(value: unknown): StripeDisputeStatus {
  if (
    value !== 'warning_needs_response' &&
    value !== 'needs_response' &&
    value !== 'under_review' &&
    value !== 'won' &&
    value !== 'lost'
  )
    throw new Error('[commerce/stripe] unsupported dispute status');
  return value;
}

function payoutStatus(value: unknown): StripePayoutStatus {
  if (
    value !== 'pending' &&
    value !== 'in_transit' &&
    value !== 'paid' &&
    value !== 'failed' &&
    value !== 'canceled'
  )
    throw new Error('[commerce/stripe] unsupported payout status');
  return value;
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

function signedMoney(value: unknown, currency: string, field: string): StripeSignedMoney {
  if (!Number.isSafeInteger(value))
    throw new Error(`[commerce/stripe] ${field} must be a signed safe integer`);
  return { currency, amount_minor: String(value) };
}

function minorUnits(value: Money): number {
  const parsed = Number(value.amount_minor);
  if (!/^[A-Z]{3}$/.test(value.currency) || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('[commerce/stripe] amount must contain an ISO currency and safe minor units');
  return parsed;
}

function validateMoney(value: Money, field: string): Money {
  if (!/^[A-Z]{3}$/.test(value.currency) || !/^\d+$/.test(value.amount_minor))
    throw new Error(`[commerce/stripe] ${field} is invalid`);
  const amount = BigInt(value.amount_minor);
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`[commerce/stripe] ${field} is out of range`);
  return { currency: value.currency, amount_minor: value.amount_minor };
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
