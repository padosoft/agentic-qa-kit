import postgres from 'postgres';
import type { Sql } from 'postgres';

export interface BusEvent {
  id: string;
  type: string;
  occurred_at: string;
  org?: string;
  project?: string;
  data: Record<string, unknown>;
}

export type EventHandler = (event: BusEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: BusEvent): Promise<void>;
  subscribe(handler: EventHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

const MAX_PAYLOAD_BYTES = 7_500;
const CHANNEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function assertEvent(event: BusEvent): void {
  if (!event.id.trim() || !event.type.trim() || !event.occurred_at.trim())
    throw new Error('[server/events] id, type and occurred_at are required');
  const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES)
    throw new Error(`[server/events] payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
}

/** In-process fan-out bus for local development and deterministic tests. */
export class MemoryEventBus implements EventBus {
  private readonly handlers = new Set<EventHandler>();

  async publish(event: BusEvent): Promise<void> {
    assertEvent(event);
    await Promise.all(
      [...this.handlers].map(async (handler) => {
        try {
          await handler(event);
        } catch {
          // Subscriber failures must not make the publisher fail.
        }
      }),
    );
  }

  async subscribe(handler: EventHandler): Promise<() => Promise<void>> {
    this.handlers.add(handler);
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      this.handlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}

/** PostgreSQL LISTEN/NOTIFY fan-out for self-hosted multi-replica deployments.
 *
 * LISTEN/NOTIFY is a low-latency notification transport, not a durable queue:
 * publishers persist authoritative state first and consumers reconcile after
 * reconnects.
 */
export class PostgresEventBus implements EventBus {
  private readonly sql: Sql;
  private readonly channel: string;
  private readonly handlers = new Set<EventHandler>();
  private readonly ready: Promise<void>;
  private listener: { unlisten(): Promise<void> } | undefined;

  constructor(dsn: string, channel = 'aqa_events') {
    if (!dsn.trim()) throw new Error('[server/events] DSN is empty');
    if (!CHANNEL_PATTERN.test(channel)) throw new Error('[server/events] invalid channel');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.channel = channel;
    this.ready = this.startListener();
  }

  private async startListener(): Promise<void> {
    this.listener = await this.sql.listen(this.channel, (raw) => {
      let event: BusEvent;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        event = parsed as BusEvent;
        assertEvent(event);
      } catch {
        return;
      }
      void Promise.all(
        [...this.handlers].map(async (handler) => {
          try {
            await handler(event);
          } catch {
            // A bad subscriber cannot take down the shared listener.
          }
        }),
      );
    });
  }

  async publish(event: BusEvent): Promise<void> {
    assertEvent(event);
    await this.ready;
    await this.sql.notify(this.channel, JSON.stringify(event));
  }

  async subscribe(handler: EventHandler): Promise<() => Promise<void>> {
    await this.ready;
    this.handlers.add(handler);
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      this.handlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    await this.ready;
    await this.listener?.unlisten();
    this.handlers.clear();
    await this.sql.end({ timeout: 5 });
  }
}
