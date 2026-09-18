import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';

export function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('unsafe PostgreSQL identifier');
  return `"${value}"`;
}

export function digestRows(rows) {
  const canonical = JSON.stringify(
    rows.map((row) => ({
      id: Number(row.id),
      value: String(row.value),
      digest: String(row.digest),
    })),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

function databaseDsn(sourceDsn, database) {
  const url = new URL(sourceDsn);
  url.pathname = `/${database}`;
  return url.toString();
}

async function command(commandName, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${commandName} exited with ${code}`)),
    );
  });
}

export async function runPostgresBackupRestoreJourney(sourceDsn) {
  if (!sourceDsn?.trim()) throw new Error('AQA_TEST_POSTGRES_DSN is required');
  const suffix = randomBytes(8).toString('hex');
  const table = `aqa_restore_canary_${suffix}`;
  const database = `aqa_restore_${suffix}`;
  const dumpDir = mkdtempSync(join(tmpdir(), 'aqa-postgres-restore-'));
  const dumpPath = join(dumpDir, 'backup.dump');
  const source = postgres(sourceDsn, { max: 1, connect_timeout: 10 });
  const admin = postgres(databaseDsn(sourceDsn, 'postgres'), { max: 1, connect_timeout: 10 });
  const tableSql = quoteIdentifier(table);
  let createdDatabase = false;
  try {
    await source.unsafe(
      `CREATE TABLE ${tableSql} (id integer PRIMARY KEY, value text NOT NULL, digest text NOT NULL)`,
    );
    await source.unsafe(
      `INSERT INTO ${tableSql} (id, value, digest) VALUES (1, 'synthetic-tenant-a', 'canary-a'), (2, 'synthetic-tenant-b', 'canary-b')`,
    );
    const before = await source.unsafe(`SELECT id, value, digest FROM ${tableSql} ORDER BY id`);
    const beforeDigest = digestRows(before);

    await command('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      `--table=public.${table}`,
      `--file=${dumpPath}`,
      sourceDsn,
    ]);
    await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(database)}`);
    createdDatabase = true;
    await command('pg_restore', [
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      `--dbname=${databaseDsn(sourceDsn, database)}`,
      dumpPath,
    ]);

    const restored = postgres(databaseDsn(sourceDsn, database), { max: 1, connect_timeout: 10 });
    try {
      const after = await restored.unsafe(`SELECT id, value, digest FROM ${tableSql} ORDER BY id`);
      const afterDigest = digestRows(after);
      if (after.length !== before.length || afterDigest !== beforeDigest) {
        throw new Error('restored PostgreSQL data digest does not match the source');
      }
    } finally {
      await restored.end({ timeout: 5 });
    }
    return { rows: before.length, digest: beforeDigest };
  } finally {
    await source.unsafe(`DROP TABLE IF EXISTS ${tableSql}`).catch(() => undefined);
    if (createdDatabase)
      await admin.unsafe(`DROP DATABASE ${quoteIdentifier(database)}`).catch(() => undefined);
    await source.end({ timeout: 5 });
    await admin.end({ timeout: 5 });
    rmSync(dumpDir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('postgres-backup-restore-journey.mjs')) {
  try {
    const result = await runPostgresBackupRestoreJourney(process.env.AQA_TEST_POSTGRES_DSN);
    console.log(`PostgreSQL backup/restore journey passed (${result.rows} synthetic rows)`);
  } catch {
    console.error('PostgreSQL backup/restore journey failed');
    process.exitCode = 1;
  }
}
