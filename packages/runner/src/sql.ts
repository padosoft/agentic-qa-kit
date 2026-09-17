import { redactJson } from '@aqa/observability';
import type { ProbeRunner } from './run.js';

export type SqlRow = Readonly<Record<string, unknown>>;

export interface SqlProbeRunnerOptions {
  /** Adapter owned by the host; credentials and connection lifecycle stay outside packs. */
  query: (
    sql: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ) => Promise<readonly SqlRow[]>;
  maxRows?: number;
}

function isReadOnly(sql: string): boolean {
  const normalized = sql.trim().replace(/;\s*$/, '');
  if (!normalized || normalized.includes(';')) return false;
  return /^(select|with|explain)\b/i.test(normalized);
}

/** Execute bounded, read-only SQL through an explicitly injected DB adapter. */
export function makeSqlProbeRunner(opts: SqlProbeRunnerOptions): ProbeRunner {
  const maxRows = opts.maxRows ?? 1_000;
  if (!Number.isInteger(maxRows) || maxRows < 1)
    throw new Error('sql maxRows must be a positive integer');
  return async (probe, externalSignal) => {
    if (probe.kind !== 'sql') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    const sql = probe.with.query;
    const params = probe.with.params;
    if (typeof sql !== 'string' || !sql.trim()) {
      return { probe_id: probe.id, error: 'sql probe requires with.query' };
    }
    if (!isReadOnly(sql)) {
      return {
        probe_id: probe.id,
        error: 'sql probe allows one read-only SELECT, WITH or EXPLAIN statement',
      };
    }
    if (params !== undefined && !Array.isArray(params)) {
      return { probe_id: probe.id, error: 'sql probe with.params must be an array' };
    }
    if (externalSignal?.aborted)
      return { probe_id: probe.id, error: 'sql probe cancelled before dispatch' };
    try {
      const rows = await opts.query(
        sql,
        (params as readonly unknown[] | undefined) ?? [],
        externalSignal,
      );
      if (externalSignal?.aborted) return { probe_id: probe.id, error: 'sql probe cancelled' };
      if (rows.length > maxRows) {
        return { probe_id: probe.id, error: `sql result exceeds ${maxRows} rows` };
      }
      return { probe_id: probe.id, body: rows.map((row) => redactJson(row)) };
    } catch (error) {
      return {
        probe_id: probe.id,
        error: redactJson(error instanceof Error ? error.message : String(error)) as string,
      };
    }
  };
}
