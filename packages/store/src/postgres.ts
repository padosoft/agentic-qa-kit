import type { Event, Finding, Run } from '@aqa/schemas';
import type { StoreProvider } from './types.js';

/**
 * Postgres adapter scaffold — concrete implementation lands with the
 * server extraction (Task 19) using drizzle-orm. Every method currently
 * throws `not implemented` so a misconfigured production deployment fails
 * loudly at boot instead of silently dropping data.
 *
 * Constructor accepts a DSN; ctor validates non-empty so a `PG_URL` env var
 * gone empty does not silently swap to MemoryStore behaviour.
 */
export class PostgresStore implements StoreProvider {
  constructor(private readonly dsn: string) {
    if (!dsn || !dsn.trim()) {
      throw new Error('[store/postgres] DSN is empty — refusing to construct.');
    }
  }

  private notImpl(method: string): never {
    throw new Error(
      `[store/postgres] ${method} not implemented at v0.3; ships with the server extraction (Task 19). dsn=${this.dsn}`,
    );
  }

  async saveRun(_run: Run.Run): Promise<void> {
    this.notImpl('saveRun');
  }
  async loadRun(_id: string): Promise<Run.Run | null> {
    this.notImpl('loadRun');
  }
  async listRuns(): Promise<Run.Run[]> {
    this.notImpl('listRuns');
  }
  async appendEvent(_event: Event.Event): Promise<void> {
    this.notImpl('appendEvent');
  }
  async listEvents(): Promise<Event.Event[]> {
    this.notImpl('listEvents');
  }
  async appendFinding(_finding: Finding.Finding): Promise<void> {
    this.notImpl('appendFinding');
  }
  async listFindings(): Promise<Finding.Finding[]> {
    this.notImpl('listFindings');
  }
  async close(): Promise<void> {
    // no-op for the scaffold; real connection pool closes here in v0.4+.
  }
}
