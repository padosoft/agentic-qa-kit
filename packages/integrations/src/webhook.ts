import { createHmac } from 'node:crypto';

export interface WebhookDelivery {
  id: string;
  org: string;
  integration: string;
  url: string;
  payload: Record<string, unknown>;
  secret: string;
  attempts: number;
  next_attempt_at: number;
  last_error?: string;
}

export interface WebhookRequest {
  id: string;
  org: string;
  integration: string;
  url: string;
  payload: Record<string, unknown>;
  secret: string;
}

export interface WebhookResponse {
  status: number;
  retry_after_ms?: number;
}
export interface WebhookTransport {
  send(request: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<WebhookResponse>;
}

export interface DeliveryResult {
  id: string;
  state: 'delivered' | 'retrying' | 'dead_lettered' | 'rate_limited';
}

const MAX_BODY_BYTES = 64_000;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15 * 60_000;

function validateRequest(request: WebhookRequest): void {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('webhook URL must use http or https');
  if (!request.id.trim() || !request.org.trim() || !request.integration.trim() || !request.secret)
    throw new Error('webhook id, org, integration and secret are required');
  const body = JSON.stringify(request.payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES)
    throw new Error('webhook payload exceeds 64000 bytes');
}

export function signWebhook(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Deterministic in-memory contract; production adapters persist the same state machine. */
export class MemoryWebhookQueue {
  private readonly pending = new Map<string, WebhookDelivery>();
  private readonly dead = new Map<string, WebhookDelivery>();
  private readonly lastSent = new Map<string, number>();

  enqueue(request: WebhookRequest, now = Date.now()): void {
    validateRequest(request);
    if (!this.pending.has(request.id) && !this.dead.has(request.id)) {
      this.pending.set(request.id, { ...request, attempts: 0, next_attempt_at: now });
    }
  }

  async deliverDue(
    transport: WebhookTransport,
    now = Date.now(),
    minIntervalMs = 0,
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];
    for (const delivery of [...this.pending.values()]) {
      if (delivery.next_attempt_at > now) continue;
      const last = this.lastSent.get(delivery.integration) ?? Number.NEGATIVE_INFINITY;
      if (now - last < minIntervalMs) {
        results.push({ id: delivery.id, state: 'rate_limited' });
        continue;
      }
      const body = JSON.stringify(delivery.payload);
      this.lastSent.set(delivery.integration, now);
      delivery.attempts += 1;
      let response: WebhookResponse;
      try {
        response = await transport.send({
          url: delivery.url,
          body,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'agentic-qa-kit-webhook/1',
            'x-aqa-delivery-id': delivery.id,
            'x-aqa-signature': signWebhook(body, delivery.secret),
          },
        });
      } catch (error) {
        response = { status: 599 };
        delivery.last_error =
          error instanceof Error ? error.message.slice(0, 256) : 'transport failure';
      }
      if (response.status >= 200 && response.status < 300) {
        this.pending.delete(delivery.id);
        results.push({ id: delivery.id, state: 'delivered' });
        continue;
      }
      if (delivery.attempts >= MAX_ATTEMPTS) {
        this.pending.delete(delivery.id);
        this.dead.set(delivery.id, { ...delivery });
        results.push({ id: delivery.id, state: 'dead_lettered' });
        continue;
      }
      const retryAfter = response.retry_after_ms ?? 0;
      const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (delivery.attempts - 1));
      delivery.next_attempt_at = now + Math.max(backoff, Math.max(0, retryAfter));
      delivery.last_error ??= `HTTP ${response.status}`;
      results.push({ id: delivery.id, state: 'retrying' });
    }
    return results;
  }

  pendingCount(): number {
    return this.pending.size;
  }
  deadLetters(): readonly WebhookDelivery[] {
    return [...this.dead.values()].map((item) => ({ ...item }));
  }
}
