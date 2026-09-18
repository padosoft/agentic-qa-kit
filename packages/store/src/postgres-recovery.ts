import postgres from 'postgres';

export interface PostgresRecoveryObservation {
  schema_version: '1';
  observed_at: string;
  in_recovery: boolean;
  transaction_read_only: boolean;
  replay_lsn: string | null;
  replay_timestamp: string | null;
  server_version: string;
}

export interface RecoveryQueryClient {
  unsafe<T>(query: string, values?: readonly unknown[]): Promise<T[]>;
}

interface RecoveryRow {
  in_recovery: boolean;
  transaction_read_only: string;
  replay_lsn: string | null;
  replay_timestamp: string | null;
  server_version: string;
}

/**
 * Observe the state of a PostgreSQL recovery target using SELECT-only SQL.
 * The returned record contains no DSN, credentials, database name or payload.
 * This proves the target's observed recovery state; it does not prove that a
 * backup provider performed the restore, which requires provider evidence.
 */
export async function observePostgresRecovery(
  client: RecoveryQueryClient,
  now: () => Date = () => new Date(),
): Promise<PostgresRecoveryObservation> {
  const rows = await client.unsafe<RecoveryRow>(
    `SELECT
       pg_is_in_recovery() AS in_recovery,
       current_setting('transaction_read_only') AS transaction_read_only,
       pg_last_wal_replay_lsn()::text AS replay_lsn,
       pg_last_xact_replay_timestamp()::text AS replay_timestamp,
       current_setting('server_version') AS server_version`,
  );
  const row = rows[0];
  if (!row || rows.length !== 1)
    throw new Error('postgres recovery probe returned an invalid row count');
  if (typeof row.in_recovery !== 'boolean')
    throw new Error('postgres recovery probe returned invalid recovery state');
  if (row.transaction_read_only !== 'on' && row.transaction_read_only !== 'off')
    throw new Error('postgres recovery probe returned invalid read-only state');
  if (row.replay_lsn !== null && !/^\d+\/[0-9A-F]+$/i.test(row.replay_lsn))
    throw new Error('postgres recovery probe returned invalid replay LSN');
  if (row.replay_timestamp !== null && Number.isNaN(Date.parse(row.replay_timestamp)))
    throw new Error('postgres recovery probe returned invalid replay timestamp');
  if (typeof row.server_version !== 'string' || row.server_version.length === 0)
    throw new Error('postgres recovery probe returned invalid server version');
  const observedAt = now();
  if (Number.isNaN(observedAt.getTime()))
    throw new Error('postgres recovery observation timestamp is invalid');
  return {
    schema_version: '1',
    observed_at: observedAt.toISOString(),
    in_recovery: row.in_recovery,
    transaction_read_only: row.transaction_read_only === 'on',
    replay_lsn: row.replay_lsn,
    replay_timestamp: row.replay_timestamp,
    server_version: row.server_version,
  };
}

/** Require the safe posture expected from an isolated PITR recovery target. */
export function assertPostgresRecoveryTarget(
  observation: PostgresRecoveryObservation,
): PostgresRecoveryObservation {
  if (!observation.in_recovery) throw new Error('postgres recovery target is not in recovery mode');
  if (!observation.transaction_read_only)
    throw new Error('postgres recovery target is not transaction read-only');
  return observation;
}

/** Connect to a real target, collect the observation, and close the client. */
export async function observePostgresRecoveryAtDsn(
  dsn: string,
  now?: () => Date,
): Promise<PostgresRecoveryObservation> {
  if (!dsn || !dsn.trim()) throw new Error('postgres recovery DSN is empty');
  const client = postgres(dsn, { max: 1, connect_timeout: 10, idle_timeout: 10 });
  try {
    return await observePostgresRecovery(client, now);
  } finally {
    await client.end({ timeout: 5 });
  }
}
