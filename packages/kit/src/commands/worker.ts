import { resolve } from 'node:path';
import { PostgresRunnerQueue } from '@aqa/server';
import { makeKitWorker } from '../worker.js';

export type RunnerWorkerConfig = {
  queue_dsn: string;
  root: string;
  poll_ms: number;
  scopes: readonly { org: string; project?: string }[];
};

/** Parse the deliberately boring `org/project,org/*` deployment format. */
export function parseRunnerScopes(raw: string): RunnerWorkerConfig['scopes'] {
  const scopes = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const slash = value.indexOf('/');
      if (slash <= 0 || slash !== value.lastIndexOf('/'))
        throw new Error('[worker] scopes must use org/project or org/* entries');
      const org = value.slice(0, slash);
      const project = value.slice(slash + 1);
      if (!org || !project || project === '*') return { org };
      return { org, project };
    });
  if (scopes.length === 0) throw new Error('[worker] AQA_RUNNER_SCOPES must not be empty');
  return scopes;
}

export function runnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerWorkerConfig {
  const queueDsn = env.AQA_QUEUE_DSN?.trim();
  const root = env.AQA_RUNNER_ROOT?.trim();
  const scopes = env.AQA_RUNNER_SCOPES?.trim();
  if (!queueDsn) throw new Error('[worker] AQA_QUEUE_DSN is required');
  if (!root) throw new Error('[worker] AQA_RUNNER_ROOT is required');
  if (!scopes) throw new Error('[worker] AQA_RUNNER_SCOPES is required');
  const rawPoll = env.AQA_RUNNER_POLL_MS?.trim();
  const pollMs = rawPoll ? Number(rawPoll) : 250;
  if (!Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60_000)
    throw new Error('[worker] AQA_RUNNER_POLL_MS must be an integer from 10 to 60000');
  return {
    queue_dsn: queueDsn,
    root: resolve(root),
    poll_ms: pollMs,
    scopes: parseRunnerScopes(scopes),
  };
}

/** Run the production-shaped PostgreSQL worker until SIGTERM/SIGINT. */
export async function runWorker(config: RunnerWorkerConfig): Promise<void> {
  const queue = new PostgresRunnerQueue(config.queue_dsn);
  const worker = makeKitWorker({
    queue,
    root: config.root,
    poll_ms: config.poll_ms,
    scopes: config.scopes,
  });
  const stop = () => worker.stop();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await worker.runUntilStopped();
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await queue.close();
  }
}
