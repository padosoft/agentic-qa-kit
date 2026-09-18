import { type RunOptions, type RunProbeDrivers, runRun } from './commands/run.js';

export interface RunJob {
  payload: Readonly<Record<string, unknown>>;
}

export interface RunJobHandlerOptions {
  /** Fixed project root; queue payloads cannot choose arbitrary filesystem paths. */
  root: string;
  packsRoot?: string[];
  /** Host-owned drivers shared by every queued run; never supplied by payloads. */
  probeDrivers?: RunProbeDrivers;
}

/** Adapt the durable server job contract to the canonical kit orchestrator. */
export function makeRunJobHandler(opts: RunJobHandlerOptions) {
  return async (job: RunJob, signal: AbortSignal): Promise<void> => {
    const profile = job.payload.profile;
    const seed = job.payload.seed;
    if (profile !== undefined && typeof profile !== 'string')
      throw new Error('run job profile must be a string');
    if (seed !== undefined && typeof seed !== 'string')
      throw new Error('run job seed must be a string');
    const runOptions: RunOptions = {
      root: opts.root,
      ...(profile ? { profile } : {}),
      ...(seed ? { seed } : {}),
      ...(opts.packsRoot ? { packsRoot: opts.packsRoot } : {}),
      ...(opts.probeDrivers ? { probeDrivers: opts.probeDrivers } : {}),
      signal,
    };
    const result = await runRun(runOptions);
    if (!result.ok) throw new Error(result.error ?? 'aqa run failed');
  };
}
