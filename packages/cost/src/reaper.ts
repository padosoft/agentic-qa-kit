import type { BudgetLedger } from './ledger.js';

export interface BudgetReaperOptions {
  interval_ms?: number;
  on_error?: (error: unknown) => void;
}

/** Long-lived scheduler for reclaiming reservations abandoned by dead workers. */
export class BudgetReaper {
  private readonly intervalMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly ledger: BudgetLedger,
    opts: BudgetReaperOptions = {},
  ) {
    this.intervalMs = opts.interval_ms ?? 60_000;
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 100)
      throw new Error('[cost] budget reaper interval_ms must be an integer >= 100');
    this.onError = opts.on_error;
  }

  async runOnce(now = new Date()): Promise<number> {
    return this.ledger.reapExpired(now);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.runOnce()
        .catch((error) => this.onError?.(error))
        .finally(() => {
          this.running = false;
        });
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
