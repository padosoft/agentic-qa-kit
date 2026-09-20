#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { RunnerQueue } from '../packages/server/dist/index.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token?.startsWith('--')) continue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
  args.set(token.slice(2), value);
  index += 1;
}

const jobs = positiveInteger(args.get('jobs') ?? '10000', 'jobs');
const runs = positiveInteger(args.get('runs') ?? '1', 'runs');
assertCleanWorkingTree();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const measurements = [];

for (let run = 0; run < runs; run += 1) {
  const queue = new RunnerQueue({ lease_ms: 60_000, max_attempts: 1 });
  const started = performance.now();
  for (let index = 0; index < jobs; index += 1) {
    queue.enqueue({
      id: `capacity-${run}-${index}`,
      enqueued_at: new Date(0).toISOString(),
      payload: { org: 'benchmark', project: 'capacity', scenario_count: 1 },
    });
  }
  let completed = 0;
  while (completed < jobs) {
    const job = queue.dequeue(
      undefined,
      [{ org: 'benchmark', project: 'capacity' }],
      'bench-runner',
    );
    if (!job || !queue.ack(job.id, job.lease_token, 'bench-runner'))
      throw new Error('capacity benchmark queue lifecycle failed');
    completed += 1;
  }
  const elapsedMs = performance.now() - started;
  measurements.push({
    run,
    jobs,
    elapsed_ms: Number(elapsedMs.toFixed(3)),
    operations_per_second: Number((jobs / (elapsedMs / 1000)).toFixed(3)),
  });
}

console.log(
  JSON.stringify(
    {
      schema_version: '1',
      scope: 'memory-runner-queue',
      source_revision: revision,
      jobs,
      runs,
      measurements,
    },
    null,
    2,
  ),
);

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000)
    throw new Error(`${name} must be an integer from 1 to 1000000`);
  return parsed;
}

function assertCleanWorkingTree() {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith('.claude/scheduled_tasks.lock'));
  if (status.length > 0)
    throw new Error('capacity benchmark requires a clean working tree for source attribution');
}
