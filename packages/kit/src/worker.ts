import { type RunnerQueueLike, RunnerWorker, type RunnerWorkerOptions } from '@aqa/server';
import type { RunProbeDrivers } from './commands/run.js';
import { makeRunJobHandler } from './worker-handler.js';

export interface KitWorkerOptions extends RunnerWorkerOptions {
  queue: RunnerQueueLike;
  root: string;
  packsRoot?: string[];
  probeDrivers?: RunProbeDrivers;
}

/** Compose the durable queue worker with the canonical `aqa run` lifecycle. */
export function makeKitWorker(opts: KitWorkerOptions): RunnerWorker {
  return new RunnerWorker(
    opts.queue,
    makeRunJobHandler({
      root: opts.root,
      ...(opts.packsRoot ? { packsRoot: opts.packsRoot } : {}),
      ...(opts.probeDrivers ? { probeDrivers: opts.probeDrivers } : {}),
    }),
    opts,
  );
}
