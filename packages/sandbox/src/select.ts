import { ContainerSandbox } from './container.js';
import type { ToolHandler } from './process.js';
import { ProcessSandbox } from './process.js';
import type { Sandbox, ToolCallBudget } from './types.js';

export interface SelectSandboxOptions {
  /** Profile name; `security` and `release-gate` switch to ContainerSandbox. */
  profile: string;
  handlers: Record<string, ToolHandler>;
  budget?: Partial<ToolCallBudget>;
}

const DEFAULT_BUDGET: ToolCallBudget = { max_calls: 50, per_call_timeout_ms: 30_000 };
const HARDENED_BUDGET: ToolCallBudget = { max_calls: 200, per_call_timeout_ms: 60_000 };

const HARDENED_PROFILES = new Set(['security', 'release-gate']);

/**
 * Pick the right Sandbox implementation for the given profile. Anything
 * declared `security` or `release-gate` runs in ContainerSandbox; everything
 * else runs in ProcessSandbox.
 */
export function selectSandbox(opts: SelectSandboxOptions): Sandbox {
  const hardened = HARDENED_PROFILES.has(opts.profile);
  const budget: ToolCallBudget = {
    ...((hardened ? HARDENED_BUDGET : DEFAULT_BUDGET) as ToolCallBudget),
    ...opts.budget,
  };
  if (hardened) return new ContainerSandbox({ budget });
  return new ProcessSandbox({ handlers: opts.handlers, budget });
}
