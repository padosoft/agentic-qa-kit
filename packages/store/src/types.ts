import type { Event, Finding, Run } from '@aqa/schemas';

/**
 * Persistence boundary for the runner. SQLite (Bun built-in) is the v0.3
 * default; Postgres lands behind a feature flag when the server (Task 19)
 * is extracted. Every adapter shares this interface so swapping backends is
 * a configuration change, not a code rewrite.
 */
export interface StoreProvider {
  saveRun(run: Run.Run): Promise<void>;
  loadRun(id: string): Promise<Run.Run | null>;
  listRuns(opts?: { project?: string; profile?: string; limit?: number }): Promise<Run.Run[]>;
  appendEvent(event: Event.Event): Promise<void>;
  listEvents(run_id: string): Promise<Event.Event[]>;
  appendFinding(finding: Finding.Finding): Promise<void>;
  listFindings(opts: { run_id?: string; severity?: Finding.Finding['severity'] }): Promise<
    Finding.Finding[]
  >;
  close(): Promise<void>;
}
