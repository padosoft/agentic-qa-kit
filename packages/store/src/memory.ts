import type { Event, Finding, Run } from '@aqa/schemas';
import type { StoreProvider } from './types.js';

/**
 * In-memory StoreProvider — the v0.3 default. Useful for tests, smoke runs,
 * and developer-local profiles. Drops everything on `close()`. The Postgres
 * adapter has identical semantics and tests share fixtures.
 */
export class MemoryStore implements StoreProvider {
  private runs = new Map<string, Run.Run>();
  private events = new Map<string, Event.Event[]>();
  private findings: Finding.Finding[] = [];

  async saveRun(run: Run.Run): Promise<void> {
    this.runs.set(run.id, run);
  }

  async loadRun(id: string): Promise<Run.Run | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(
    opts: { project?: string; profile?: string; limit?: number } = {},
  ): Promise<Run.Run[]> {
    let out = [...this.runs.values()];
    if (opts.project) out = out.filter((r) => r.project === opts.project);
    if (opts.profile) out = out.filter((r) => r.profile === opts.profile);
    out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }

  async appendEvent(event: Event.Event): Promise<void> {
    const bucket = this.events.get(event.run_id) ?? [];
    bucket.push(event);
    this.events.set(event.run_id, bucket);
  }

  async listEvents(run_id: string): Promise<Event.Event[]> {
    return [...(this.events.get(run_id) ?? [])];
  }

  async appendFinding(finding: Finding.Finding): Promise<void> {
    this.findings.push(finding);
  }

  async listFindings(opts: { run_id?: string; severity?: Finding.Finding['severity'] }): Promise<
    Finding.Finding[]
  > {
    return this.findings.filter(
      (f) =>
        (opts.run_id === undefined || f.run_id === opts.run_id) &&
        (opts.severity === undefined || f.severity === opts.severity),
    );
  }

  async close(): Promise<void> {
    this.runs.clear();
    this.events.clear();
    this.findings = [];
  }
}
