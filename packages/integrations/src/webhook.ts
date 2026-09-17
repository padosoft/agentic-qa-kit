import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import type { JSONValue, Sql } from 'postgres';

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

export interface DurableWebhookRequest extends Omit<WebhookRequest, 'secret'> {
  secret_ref: string;
}

export interface WebhookSecretResolver {
  resolve(secretRef: string): Promise<string>;
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

function validateDurableRequest(request: DurableWebhookRequest): void {
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('webhook URL must use http or https');
  if (
    !request.id.trim() ||
    !request.org.trim() ||
    !request.integration.trim() ||
    !request.secret_ref.trim()
  )
    throw new Error('webhook id, org, integration and secret_ref are required');
  const body = JSON.stringify(request.payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES)
    throw new Error('webhook payload exceeds 64000 bytes');
}

function asJson(value: Record<string, unknown>): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
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

interface DurableRow {
  id: string;
  org: string;
  integration: string;
  url: string;
  payload: Record<string, unknown>;
  secret_ref: string;
  attempts: number;
}

/** PostgreSQL-backed multi-replica queue. Secrets are resolved outside the database. */
export class PostgresWebhookQueue {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;
  private readonly resolver: WebhookSecretResolver;

  constructor(dsn: string, resolver: WebhookSecretResolver) {
    if (!dsn.trim()) throw new Error('[integrations/webhook] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.resolver = resolver;
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS aqa_webhook_deliveries (
        id text PRIMARY KEY,
        org text NOT NULL,
        integration text NOT NULL,
        url text NOT NULL,
        payload jsonb NOT NULL,
        secret_ref text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        locked_until timestamptz,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await this
      .sql`CREATE INDEX IF NOT EXISTS aqa_webhook_due ON aqa_webhook_deliveries (status, next_attempt_at)`;
  }

  async enqueue(request: DurableWebhookRequest, now = new Date()): Promise<void> {
    validateDurableRequest(request);
    await this.ready;
    await this.sql`
      INSERT INTO aqa_webhook_deliveries (id, org, integration, url, payload, secret_ref, next_attempt_at)
      VALUES (${request.id}, ${request.org}, ${request.integration}, ${request.url}, ${this.sql.json(asJson(request.payload))}, ${request.secret_ref}, ${now})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async deliverDue(
    transport: WebhookTransport,
    now = new Date(),
    limit = 25,
  ): Promise<DeliveryResult[]> {
    await this.ready;
    const rows = await this.sql<DurableRow[]>`
      WITH claimed AS (
        SELECT id FROM aqa_webhook_deliveries
        WHERE status = 'pending' AND next_attempt_at <= ${now}
          AND (locked_until IS NULL OR locked_until < ${now})
        ORDER BY next_attempt_at, created_at
        LIMIT ${Math.min(Math.max(limit, 1), 100)}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE aqa_webhook_deliveries AS d
      SET locked_until = ${new Date(now.getTime() + 5 * 60_000)}, attempts = d.attempts + 1
      FROM claimed WHERE d.id = claimed.id
      RETURNING d.id, d.org, d.integration, d.url, d.payload, d.secret_ref, d.attempts
    `;
    const results: DeliveryResult[] = [];
    for (const row of rows) {
      const body = JSON.stringify(row.payload);
      let response: WebhookResponse;
      try {
        response = await transport.send({
          url: row.url,
          body,
          headers: {
            'content-type': 'application/json',
            'user-agent': 'agentic-qa-kit-webhook/1',
            'x-aqa-delivery-id': row.id,
            'x-aqa-signature': signWebhook(body, await this.resolver.resolve(row.secret_ref)),
          },
        });
      } catch (error) {
        response = { status: 599 };
        await this.recordFailure(
          row,
          error instanceof Error ? error.message.slice(0, 256) : 'transport failure',
          now,
        );
      }
      if (response.status >= 200 && response.status < 300) {
        await this.sql`DELETE FROM aqa_webhook_deliveries WHERE id = ${row.id}`;
        results.push({ id: row.id, state: 'delivered' });
      } else if (row.attempts >= MAX_ATTEMPTS) {
        await this
          .sql`UPDATE aqa_webhook_deliveries SET status = 'dead', locked_until = NULL, last_error = ${`HTTP ${response.status}`} WHERE id = ${row.id}`;
        results.push({ id: row.id, state: 'dead_lettered' });
      } else {
        const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (row.attempts - 1));
        const delay = Math.max(backoff, response.retry_after_ms ?? 0);
        await this
          .sql`UPDATE aqa_webhook_deliveries SET next_attempt_at = ${new Date(now.getTime() + delay)}, locked_until = NULL, last_error = ${`HTTP ${response.status}`} WHERE id = ${row.id}`;
        results.push({ id: row.id, state: 'retrying' });
      }
    }
    return results;
  }

  async redrive(id: string, now = new Date()): Promise<boolean> {
    await this.ready;
    const rows = await this
      .sql`UPDATE aqa_webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = ${now}, locked_until = NULL, last_error = NULL WHERE id = ${id} AND status = 'dead' RETURNING id`;
    return rows.length > 0;
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }

  private async recordFailure(row: DurableRow, message: string, now: Date): Promise<void> {
    await this
      .sql`UPDATE aqa_webhook_deliveries SET last_error = ${message}, locked_until = NULL, next_attempt_at = ${now} WHERE id = ${row.id}`;
  }
}
