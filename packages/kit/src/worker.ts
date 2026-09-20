import { type RunnerQueueLike, RunnerWorker, type RunnerWorkerOptions } from '@aqa/server';
import type { RunProbeDrivers, StatefulJourneyBinding } from './commands/run.js';
import { makeRunJobHandler } from './worker-handler.js';

export interface KitWorkerOptions extends RunnerWorkerOptions {
  queue: RunnerQueueLike;
  root: string;
  packsRoot?: string[];
  probeDrivers?: RunProbeDrivers;
  statefulJourneys?: Readonly<Record<string, StatefulJourneyBinding>>;
}

const RUNNER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

/** Validate the host-owned identity before a worker can lease any job. */
export function normalizeRunnerId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!RUNNER_ID_PATTERN.test(normalized))
    throw new Error('[worker] runner_id must contain only bounded identifier characters');
  return normalized;
}

/** Compose the durable queue worker with the canonical `aqa run` lifecycle. */
export function makeKitWorker(opts: KitWorkerOptions): RunnerWorker {
  const runnerId = normalizeRunnerId(opts.runner_id);
  return new RunnerWorker(
    opts.queue,
    makeRunJobHandler({
      root: opts.root,
      ...(opts.packsRoot ? { packsRoot: opts.packsRoot } : {}),
      ...(opts.probeDrivers ? { probeDrivers: opts.probeDrivers } : {}),
      ...(opts.statefulJourneys ? { statefulJourneys: opts.statefulJourneys } : {}),
      ...(runnerId ? { runner_id: runnerId } : {}),
    }),
    { ...opts, ...(runnerId ? { runner_id: runnerId } : {}) },
  );
}
