import { PostgresRunnerQueue } from './postgres-queue.js';

/** One-shot janitor for jobs orphaned by a crashed or unavailable worker fleet. */
export async function runRunnerReaper(): Promise<{ requeued: number; failed: number }> {
  const dsn = process.env.AQA_RUNNER_QUEUE_DSN?.trim();
  if (!dsn) throw new Error('AQA_RUNNER_QUEUE_DSN is required');
  const queue = new PostgresRunnerQueue(dsn);
  try {
    const result = await queue.reapExpired();
    console.info(JSON.stringify(result));
    return result;
  } finally {
    await queue.close();
  }
}

if (process.argv[1]?.endsWith('runner-reaper-cli.js')) {
  runRunnerReaper().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'runner reaper failed');
    process.exitCode = 1;
  });
}
