import type { Sandbox, ToolCall, ToolCallBudget } from './types.js';

export type ToolHandler = (call: ToolCall) => Promise<unknown>;

/**
 * In-process sandbox — tools run directly in the runner's process. Suitable for
 * developer-local smoke runs; NOT suitable for `release-gate` or `security`
 * profiles. Enforces the per-call timeout via Promise.race + AbortController
 * if the handler honors it.
 */
export class ProcessSandbox implements Sandbox {
  public readonly kind = 'process' as const;
  private calls = 0;
  private readonly handlers: Record<string, ToolHandler>;
  private readonly budgetCfg: ToolCallBudget;

  constructor(opts: { handlers: Record<string, ToolHandler>; budget: ToolCallBudget }) {
    this.handlers = opts.handlers;
    this.budgetCfg = opts.budget;
  }

  async invoke(call: ToolCall): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    this.calls += 1;
    if (this.calls > this.budgetCfg.max_calls) {
      return {
        ok: false,
        error: `tool-call budget exhausted (max_calls=${this.budgetCfg.max_calls})`,
      };
    }
    const handler = this.handlers[call.tool];
    if (!handler) return { ok: false, error: `no handler registered for tool "${call.tool}"` };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        handler(call),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `tool "${call.tool}" exceeded per-call timeout ${this.budgetCfg.per_call_timeout_ms}ms`,
                ),
              ),
            this.budgetCfg.per_call_timeout_ms,
          );
        }),
      ]);
      return { ok: true, output };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  callCount(): number {
    return this.calls;
  }

  budget(): ToolCallBudget {
    return { ...this.budgetCfg };
  }
}
