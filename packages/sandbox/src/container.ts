import type { Sandbox, ToolCall, ToolCallBudget } from './types.js';

/**
 * Container-backed sandbox — the v0.2 scaffold. The real implementation
 * dispatches each tool call into a short-lived container (rootless podman /
 * docker / firecracker) with fs/network capabilities revoked except for the
 * explicit allow-list. The v0.2 scaffold returns an explicit "not implemented"
 * for every call so a `security` or `release-gate` profile cannot accidentally
 * run as ProcessSandbox.
 *
 * Required behaviour (v0.3 implementation pass):
 * - rootless container per call
 * - read-only root fs with /tmp tmpfs
 * - default-deny network; allow-list per probe kind
 * - resource caps: CPU 0.5, memory 256MB, pids 64
 * - audit log of every container exit code + stderr in events.jsonl
 */
export class ContainerSandbox implements Sandbox {
  public readonly kind = 'container' as const;
  private calls = 0;
  private readonly budgetCfg: ToolCallBudget;

  constructor(opts: { budget: ToolCallBudget }) {
    this.budgetCfg = opts.budget;
  }

  async invoke(_call: ToolCall): Promise<{ ok: boolean; error: string }> {
    this.calls += 1;
    return {
      ok: false,
      error:
        '[sandbox] ContainerSandbox is a v0.2 scaffold; the container backend lands in v0.3. release-gate profiles must wait until then or run in ProcessSandbox with the operator accepting the audit trail caveat.',
    };
  }

  callCount(): number {
    return this.calls;
  }

  budget(): ToolCallBudget {
    return { ...this.budgetCfg };
  }
}
