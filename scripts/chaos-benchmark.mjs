#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

execFileSync('bun', ['run', '--filter', '@aqa/server', 'build'], { stdio: 'ignore' });
const { RunnerQueue } = await import('../packages/server/dist/index.js');

const args = parseArgs(process.argv.slice(2));
const jobs = boundedInteger(args.jobs ?? '200', 'jobs', 1, 10_000);
const runs = boundedInteger(args.runs ?? '3', 'runs', 1, 20);
const maxAttempts = boundedInteger(args.max_attempts ?? '3', 'max-attempts', 1, 10);
const minCompletionRatio = boundedRatio(
  args.min_completion_ratio ?? '0.95',
  'min-completion-ratio',
);
const sourceRevision = cleanRevision();

const measurements = [];
for (let run = 0; run < runs; run += 1) measurements.push(executeRun(run));
const totals = measurements.reduce(
  (acc, item) => ({
    jobs: acc.jobs + item.jobs,
    completed: acc.completed + item.completed,
    failed: acc.failed + item.failed,
    expired: acc.expired + item.expired,
    explicit_failures: acc.explicit_failures + item.explicit_failures,
  }),
  { jobs: 0, completed: 0, failed: 0, expired: 0, explicit_failures: 0 },
);
const completionRatio = totals.jobs === 0 ? 0 : totals.completed / totals.jobs;
const pass =
  completionRatio >= minCompletionRatio && measurements.every((item) => item.stranded === 0);

console.log(
  JSON.stringify(
    {
      schema_version: '1',
      scope: 'memory-runner-queue-chaos',
      source_revision: sourceRevision,
      configuration: {
        jobs,
        runs,
        max_attempts: maxAttempts,
        min_completion_ratio: minCompletionRatio,
      },
      thresholds: { completion_ratio: minCompletionRatio, stranded_jobs: 0 },
      result: pass ? 'pass' : 'fail',
      totals: { ...totals, completion_ratio: Number(completionRatio.toFixed(6)) },
      measurements,
      evidence_boundary:
        'Deterministic in-memory queue contract only; this is not provider-scale, network, database, or production SLO evidence.',
    },
    null,
    2,
  ),
);
if (!pass) process.exitCode = 1;

function executeRun(run) {
  const queue = new RunnerQueue({ lease_ms: 10, max_attempts: maxAttempts });
  const base = new Date('2026-01-01T00:00:00.000Z').getTime() + run * 60_000;
  for (let index = 0; index < jobs; index += 1) {
    queue.enqueue({
      id: `chaos-${run}-${index}`,
      payload: { org: 'benchmark', project: 'chaos', scenario_count: 1 },
      enqueued_at: new Date(base + index).toISOString(),
      priority: index % 10 === 0 ? 5 : 0,
      idempotency_key: `benchmark:${run}:${index}`,
      idempotency_fingerprint: 'chaos-v1',
    });
  }
  let now = base;
  let expired = 0;
  let explicitFailures = 0;
  for (;;) {
    const job = queue.dequeue(new Date(now), undefined, `chaos-runner-${run}`);
    if (!job) break;
    const index = Number(job.id.split('-').at(-1));
    if (job.attempts === 1 && index % 101 === 0) {
      if (!queue.fail(job.id, job.lease_token, 'injected transient failure', `chaos-runner-${run}`))
        throw new Error('chaos explicit failure could not be recorded');
      explicitFailures += 1;
    } else if (job.attempts === 1 && index % 7 === 0) {
      now += 20;
      const reaped = queue.reapExpired(new Date(now));
      if (reaped.requeued + reaped.failed < 1) throw new Error('chaos lease expiry was not reaped');
      expired += 1;
    } else if (!queue.ack(job.id, job.lease_token, `chaos-runner-${run}`)) {
      throw new Error('chaos successful ACK was rejected');
    }
    now += 1;
  }
  const snapshot = queue.snapshot();
  const completed = snapshot.filter((job) => job.status === 'done').length;
  const failed = snapshot.filter((job) => job.status === 'failed').length;
  const stranded = snapshot.filter(
    (job) => job.status === 'queued' || job.status === 'in_flight',
  ).length;
  if (completed + failed + stranded !== jobs)
    throw new Error('queue terminal accounting does not reconcile');
  return { run, jobs, completed, failed, expired, explicit_failures: explicitFailures, stranded };
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith('--')) throw new Error(`unknown argument: ${value}`);
    const key = value.slice(2).replaceAll('-', '_');
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${value}`);
    result[key] = next;
    index += 1;
  }
  return result;
}

function boundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return parsed;
}

function boundedRatio(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${name} must be 0..1`);
  return parsed;
}

function cleanRevision() {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((line) => !line.endsWith('.claude/scheduled_tasks.lock'));
  if (status.length > 0)
    throw new Error('refusing to attribute chaos evidence to a dirty worktree');
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}
