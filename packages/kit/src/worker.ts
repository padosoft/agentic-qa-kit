import {
  type RunnerQueueLike,
  RunnerWorker,
  type RunnerWorkerOptions,
  normalizeRunnerId as normalizeServerRunnerId,
} from '@aqa/server';
import type { RunProbeDrivers, StatefulJourneyBinding } from './commands/run.js';
import { makeRunJobHandler } from './worker-handler.js';

export interface KitWorkerOptions extends RunnerWorkerOptions {
  queue: RunnerQueueLike;
  root: string;
  packsRoot?: string[];
  probeDrivers?: RunProbeDrivers;
  statefulJourneys?: Readonly<Record<string, StatefulJourneyBinding>>;
}

/** Validate the host-owned identity before a worker can lease any job. */
export function normalizeRunnerId(value: string | undefined): string | undefined {
  return normalizeServerRunnerId(value);
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
