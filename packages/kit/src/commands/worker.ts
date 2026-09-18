import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpRunnerQueue, PostgresRunnerQueue } from '@aqa/server';
import { makeKitWorker } from '../worker.js';

export type RunnerWorkerConfig = {
  queue_dsn?: string;
  server_url?: string;
  runner_token?: string;
  runner_token_file?: string;
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
      if (!org || !project) throw new Error('[worker] runner scope must include a project or *');
      if (project === '*') return { org };
      return { org, project };
    });
  if (scopes.length === 0) throw new Error('[worker] AQA_RUNNER_SCOPES must not be empty');
  return scopes;
}

export function runnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RunnerWorkerConfig {
  const queueDsn = env.AQA_QUEUE_DSN?.trim();
  const serverUrl = env.AQA_SERVER_URL?.trim();
  const runnerToken = env.AQA_RUNNER_TOKEN?.trim();
  const runnerTokenFile = env.AQA_RUNNER_TOKEN_FILE?.trim();
  const root = env.AQA_RUNNER_ROOT?.trim();
  const scopes = env.AQA_RUNNER_SCOPES?.trim();
  if (!queueDsn && !serverUrl)
    throw new Error('[worker] AQA_QUEUE_DSN or AQA_SERVER_URL is required');
  if (serverUrl && !runnerToken && !runnerTokenFile)
    throw new Error(
      '[worker] AQA_RUNNER_TOKEN or AQA_RUNNER_TOKEN_FILE is required with AQA_SERVER_URL',
    );
  if (!serverUrl && (runnerToken || runnerTokenFile))
    throw new Error('[worker] AQA_SERVER_URL is required when a runner token is configured');
  if (!root) throw new Error('[worker] AQA_RUNNER_ROOT is required');
  if (!scopes) throw new Error('[worker] AQA_RUNNER_SCOPES is required');
  const rawPoll = env.AQA_RUNNER_POLL_MS?.trim();
  const pollMs = rawPoll ? Number(rawPoll) : 250;
  if (!Number.isInteger(pollMs) || pollMs < 10 || pollMs > 60_000)
    throw new Error('[worker] AQA_RUNNER_POLL_MS must be an integer from 10 to 60000');
  return {
    ...(queueDsn ? { queue_dsn: queueDsn } : {}),
    ...(serverUrl ? { server_url: serverUrl } : {}),
    ...(runnerToken ? { runner_token: runnerToken } : {}),
    ...(runnerTokenFile ? { runner_token_file: resolve(runnerTokenFile) } : {}),
    root: resolve(root),
    poll_ms: pollMs,
    scopes: parseRunnerScopes(scopes),
  };
}

/** Run the production-shaped PostgreSQL worker until SIGTERM/SIGINT. */
export async function runWorker(config: RunnerWorkerConfig): Promise<void> {
  const queue = config.server_url
    ? new HttpRunnerQueue(config.server_url, async () => {
        if (config.runner_token_file) return readFile(config.runner_token_file, 'utf8');
        return config.runner_token ?? '';
      })
    : new PostgresRunnerQueue(config.queue_dsn ?? '');
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
    await (queue as { close?: () => Promise<void> }).close?.();
  }
}
