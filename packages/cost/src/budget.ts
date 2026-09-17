import { type ModelPricing, defaultPricing } from './pricing.js';

export interface LlmCall {
  model: string;
  tokens_in: number;
  tokens_out: number;
}

export interface BudgetState {
  budget_usd: number | null;
  spent_usd: number;
  tokens_in: number;
  tokens_out: number;
  calls: number;
  exhausted: boolean;
  pricing_error?: string;
  halted_reason?: string;
}

export class BudgetDispatchBlockedError extends Error {
  constructor(reason: string) {
    super(`[cost] LLM dispatch blocked: ${reason}`);
    this.name = 'BudgetDispatchBlockedError';
  }
}

export interface BudgetTrackerOptions {
  budget_usd: number | null;
  pricing?: Record<string, ModelPricing>;
}

/**
 * Tracks per-run LLM spend. `budget_usd === null` means unlimited (used by
 * the developer-local `exploratory` profile where the user pays the vendor
 * directly). For `orchestrator` profiles the budget is hard: when
 * `exhausted` flips true, the runner is expected to stop dispatching new
 * LLM-bound work and emit a `budget_exceeded` event.
 */
export class BudgetTracker {
  private readonly pricing: Record<string, ModelPricing>;
  private state: BudgetState;

  constructor(opts: BudgetTrackerOptions) {
    if (opts.budget_usd !== null && (!Number.isFinite(opts.budget_usd) || opts.budget_usd < 0))
      throw new Error('[cost] budget_usd must be null or a non-negative finite number');
    this.pricing = opts.pricing ?? defaultPricing;
    this.state = {
      budget_usd: opts.budget_usd,
      spent_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      calls: 0,
      exhausted: false,
    };
  }

  /**
   * Charge an LLM call against the budget. Returns the new state. Does NOT
   * throw when over-budget — callers should check `exhausted` and stop
   * dispatching new work.
   */
  charge(call: LlmCall): BudgetState {
    this.validateCall(call);
    const price = this.pricing[call.model];
    if (!price) {
      this.state = {
        ...this.state,
        tokens_in: this.state.tokens_in + call.tokens_in,
        tokens_out: this.state.tokens_out + call.tokens_out,
        calls: this.state.calls + 1,
        exhausted: true,
        pricing_error: `no pricing configured for model "${call.model}"`,
      };
      return this.state;
    }
    const usd = price
      ? (call.tokens_in / 1_000_000) * price.input_per_mtok +
        (call.tokens_out / 1_000_000) * price.output_per_mtok
      : 0;
    this.state = {
      ...this.state,
      spent_usd: this.state.spent_usd + usd,
      tokens_in: this.state.tokens_in + call.tokens_in,
      tokens_out: this.state.tokens_out + call.tokens_out,
      calls: this.state.calls + 1,
      exhausted:
        this.state.budget_usd !== null && this.state.spent_usd + usd >= this.state.budget_usd,
    };
    return this.state;
  }

  /**
   * Hard admission boundary for callers that have not invoked the provider
   * yet. Unknown pricing and a call that reaches the limit fail closed.
   */
  assertCanDispatch(call: LlmCall): void {
    this.validateCall(call);
    if (this.state.halted_reason) throw new BudgetDispatchBlockedError(this.state.halted_reason);
    if (this.wouldExhaust(call)) throw new BudgetDispatchBlockedError('budget exhausted');
  }

  /** Permanently blocks new dispatches for this tracker instance. */
  halt(reason: string): BudgetState {
    const normalized = reason.trim().slice(0, 200);
    if (!normalized) throw new Error('[cost] halt reason is required');
    this.state = { ...this.state, exhausted: true, halted_reason: normalized };
    return this.snapshot();
  }

  /** Snapshot of the current accumulated state. */
  snapshot(): BudgetState {
    return { ...this.state };
  }

  /** Convenience: would the next call of (tokens_in, tokens_out, model) exhaust the budget? */
  wouldExhaust(call: LlmCall): boolean {
    this.validateCall(call);
    const price = this.pricing[call.model];
    if (!price) return true;
    if (this.state.budget_usd === null) return false;
    const next =
      (call.tokens_in / 1_000_000) * price.input_per_mtok +
      (call.tokens_out / 1_000_000) * price.output_per_mtok;
    return this.state.spent_usd + next >= this.state.budget_usd;
  }

  private validateCall(call: LlmCall): void {
    if (!call.model.trim()) throw new Error('[cost] model is required');
    if (
      !Number.isSafeInteger(call.tokens_in) ||
      call.tokens_in < 0 ||
      !Number.isSafeInteger(call.tokens_out) ||
      call.tokens_out < 0
    )
      throw new Error('[cost] token counts must be non-negative safe integers');
  }
}
