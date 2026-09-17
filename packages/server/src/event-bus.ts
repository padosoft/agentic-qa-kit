import postgres from 'postgres';
import type { JSONValue, Sql } from 'postgres';

export interface BusEvent {
  id: string;
  type: string;
  occurred_at: string;
  org?: string;
  project?: string;
  data: Record<string, unknown>;
}

export type EventHandler = (event: BusEvent) => void | Promise<void>;

export interface EventReplayOptions {
  after_id?: string;
  org: string;
  project?: string;
  limit?: number;
}

export interface EventReplayResult {
  events: BusEvent[];
  cursor_found: boolean;
}

export interface EventBus {
  publish(event: BusEvent): Promise<void>;
  subscribe(handler: EventHandler): Promise<() => Promise<void>>;
  /** Optional bounded replay for transports that support durable cursors. */
  replay?(options: EventReplayOptions): Promise<EventReplayResult>;
  close(): Promise<void>;
}

const MAX_PAYLOAD_BYTES = 7_500;
const CHANNEL_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

function asPostgresJson(value: Record<string, unknown>): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

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
  private readonly history: Array<{ sequence: number; event: BusEvent }> = [];
  private sequence = 0;

  async publish(event: BusEvent): Promise<void> {
    assertEvent(event);
    const recorded = { sequence: ++this.sequence, event };
    this.history.push(recorded);
    if (this.history.length > 1_000) this.history.shift();
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

  async replay(options: EventReplayOptions): Promise<EventReplayResult> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const cursor = options.after_id
      ? this.history.find((item) => item.event.id === options.after_id)
      : undefined;
    const cursorFound = !options.after_id || cursor !== undefined;
    const events = this.history
      .filter((item) => (cursor ? item.sequence > cursor.sequence : !options.after_id))
      .map((item) => item.event)
      .filter(
        (event) =>
          event.org === options.org && (!options.project || event.project === options.project),
      )
      .slice(0, limit);
    return { events, cursor_found: cursorFound };
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
    // `CREATE TABLE IF NOT EXISTS` is not sufficient when two replicas boot
    // concurrently: PostgreSQL can race while creating the implicit identity
    // sequence, before either statement has committed the relation. Serialize
    // only this short, transactional bootstrap section with a stable advisory
    // lock; the lock is released automatically on commit/rollback.
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('aqa_live_events_schema'))`;
      await tx`
        CREATE TABLE IF NOT EXISTS aqa_live_events (
          sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          event_id text NOT NULL UNIQUE,
          org text NOT NULL,
          project text,
          type text NOT NULL,
          occurred_at timestamptz NOT NULL,
          data jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await tx`CREATE INDEX IF NOT EXISTS aqa_live_events_scope_sequence ON aqa_live_events (org, project, sequence)`;
    });
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
    await this.sql`
      INSERT INTO aqa_live_events (event_id, org, project, type, occurred_at, data)
      VALUES (${event.id}, ${event.org ?? ''}, ${event.project ?? null}, ${event.type}, ${event.occurred_at}, ${this.sql.json(asPostgresJson(event.data))})
      ON CONFLICT (event_id) DO NOTHING
    `;
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

  async replay(options: EventReplayOptions): Promise<EventReplayResult> {
    await this.ready;
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    let afterSequence = 0n;
    let cursorFound = !options.after_id;
    if (options.after_id) {
      const cursor = await this.sql<{ sequence: string }[]>`
        SELECT sequence::text FROM aqa_live_events WHERE event_id = ${options.after_id}
      `;
      cursorFound = cursor.length > 0;
      if (cursor[0]?.sequence) afterSequence = BigInt(cursor[0].sequence);
    }
    if (!cursorFound) return { cursor_found: false, events: [] };
    const rows = await this.sql<
      Array<{
        event_id: string;
        org: string;
        project: string | null;
        type: string;
        occurred_at: string;
        data: Record<string, unknown>;
      }>
    >`
      SELECT event_id, org, project, type, occurred_at, data
      FROM aqa_live_events
      WHERE org = ${options.org}
        AND (${options.project ?? null}::text IS NULL OR project = ${options.project ?? null})
        AND sequence > ${afterSequence.toString()}
      ORDER BY sequence ASC
      LIMIT ${limit}
    `;
    return {
      cursor_found: cursorFound,
      events: rows.map((row) => ({
        id: row.event_id,
        type: row.type,
        occurred_at: new Date(row.occurred_at).toISOString(),
        org: row.org,
        ...(row.project ? { project: row.project } : {}),
        data: row.data,
      })),
    };
  }

  async close(): Promise<void> {
    await this.ready;
    await this.listener?.unlisten();
    this.handlers.clear();
    await this.sql.end({ timeout: 5 });
  }
}
