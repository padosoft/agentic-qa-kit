import postgres from 'postgres';
import { type SqlProbeRunnerOptions, makeSqlProbeRunner } from './sql.js';

export interface PostgresSqlProbeRunnerOptions {
  connectionString: string;
  maxRows?: number;
  statementTimeoutMs?: number;
}

export type PostgresSqlProbeRunner = SqlProbeProbeRunner;
type SqlProbeProbeRunner = ReturnType<typeof makeSqlProbeRunner> & { close(): Promise<void> };

/**
 * Postgres implementation of the read-only SQL boundary. Each query runs in
 * a read-only transaction with a local statement timeout; the DSN remains in
 * the host configuration and is never copied into probe evidence.
 */
export function makePostgresSqlProbeRunner(
  opts: PostgresSqlProbeRunnerOptions,
): PostgresSqlProbeRunner {
  if (!opts.connectionString.trim()) throw new Error('Postgres connectionString is required');
  const statementTimeoutMs = opts.statementTimeoutMs ?? 30_000;
  if (
    !Number.isInteger(statementTimeoutMs) ||
    statementTimeoutMs < 1 ||
    statementTimeoutMs > 600_000
  ) {
    throw new Error('Postgres statementTimeoutMs must be an integer between 1 and 600000');
  }
  const sql = postgres(opts.connectionString, {
    max: 1,
    connect_timeout: Math.ceil(statementTimeoutMs / 1000),
    idle_timeout: 20,
  });
  const runner = makeSqlProbeRunner({
    ...(opts.maxRows ? { maxRows: opts.maxRows } : {}),
    query: async (query, params, signal) => {
      const rows = await sql.begin(async (transaction) => {
        const unsafe = transaction.unsafe as unknown as (
          text: string,
          values?: unknown[],
        ) => Promise<readonly Record<string, unknown>[]>;
        await unsafe('SET TRANSACTION READ ONLY');
        await unsafe("SELECT set_config('statement_timeout', $1, true)", [
          String(statementTimeoutMs),
        ]);
        return unsafe(query, [...params]);
      });
      if (signal?.aborted) throw new Error('Postgres SQL probe cancelled');
      return rows;
    },
  } satisfies SqlProbeRunnerOptions);
  return Object.assign(runner, {
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  });
}
