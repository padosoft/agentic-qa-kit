import { verifyStripeWebhookSignature } from './stripe-webhook.js';
import { type WebhookEffectLedger, applyWebhookEffectOnce } from './webhook-ledger.js';

export type StripeWebhookEvent = {
  id: string;
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed' | 'charge.refunded';
  data: { object: Record<string, unknown> };
};

export type StripeWebhookProcessResult =
  | {
      status: 'applied' | 'duplicate';
      event_id: string;
      event_type: StripeWebhookEvent['type'];
      effect_key: string;
    }
  | { status: 'unsupported' | 'rejected'; reason: string; event_id?: string };

export type StripeWebhookProcessorOptions = {
  endpointSecret: string;
  ledger: WebhookEffectLedger;
  now_ms?: number;
  tolerance_seconds?: number;
  maxBodyBytes?: number;
};

/** Verify and apply Stripe payment events without allowing duplicate effects. */
export class StripeWebhookProcessor {
  private readonly options: StripeWebhookProcessorOptions;

  constructor(options: StripeWebhookProcessorOptions) {
    if (!options.endpointSecret.trim())
      throw new Error('[commerce/stripe] endpoint secret is required');
    if (!options.ledger) throw new Error('[commerce/stripe] webhook ledger is required');
    const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1)
      throw new Error('[commerce/stripe] maxBodyBytes must be positive');
    this.options = { ...options, maxBodyBytes };
  }

  async process(
    rawBody: string,
    signatureHeader: string | undefined,
    effect: (event: StripeWebhookEvent) => Promise<void> | void,
  ): Promise<StripeWebhookProcessResult> {
    if (new TextEncoder().encode(rawBody).byteLength > (this.options.maxBodyBytes ?? 0))
      return { status: 'rejected', reason: 'body_too_large' };
    const verification = verifyStripeWebhookSignature(
      rawBody,
      signatureHeader,
      this.options.endpointSecret,
      this.options,
    );
    if (!verification.ok) return { status: 'rejected', reason: verification.reason };
    let event: StripeWebhookEvent;
    try {
      event = parseEvent(JSON.parse(rawBody));
    } catch {
      return { status: 'rejected', reason: 'invalid_event' };
    }
    if (!SUPPORTED_TYPES.has(event.type))
      return { status: 'unsupported', reason: event.type, event_id: event.id };
    const orderId = text(
      event.data.object.metadata &&
        (event.data.object.metadata as Record<string, unknown>).order_id,
    );
    const providerId = text(event.data.object.id) ?? text(event.data.object.payment_intent);
    if (!orderId || !providerId)
      return { status: 'rejected', reason: 'missing_order_or_provider_id', event_id: event.id };
    const effectKey = `${orderId}:${effectName(event.type)}`;
    try {
      const status = await applyWebhookEffectOnce(this.options.ledger, effectKey, event.id, () =>
        effect(event),
      );
      return { status, event_id: event.id, event_type: event.type, effect_key: effectKey };
    } catch (error) {
      return {
        status: 'rejected',
        reason:
          error instanceof Error && error.message.includes('conflicts')
            ? 'effect_conflict'
            : 'effect_failed',
        event_id: event.id,
      };
    }
  }
}

const SUPPORTED_TYPES = new Set<StripeWebhookEvent['type']>([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
]);

function parseEvent(value: unknown): StripeWebhookEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('event object required');
  const object = value as Record<string, unknown>;
  const id = text(object.id);
  const type = text(object.type);
  const data = object.data;
  if (!id || !type || !data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('event fields missing');
  const payload = (data as Record<string, unknown>).object;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('event data missing');
  return {
    id,
    type: type as StripeWebhookEvent['type'],
    data: { object: payload as Record<string, unknown> },
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && !/[\r\n]/.test(value)
    ? value.trim()
    : undefined;
}

function effectName(type: StripeWebhookEvent['type']): string {
  if (type === 'payment_intent.succeeded') return 'payment_captured';
  if (type === 'payment_intent.payment_failed') return 'payment_failed';
  return 'payment_refunded';
}
