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
    const price = this.pricing[call.model];
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

  /** Snapshot of the current accumulated state. */
  snapshot(): BudgetState {
    return { ...this.state };
  }

  /** Convenience: would the next call of (tokens_in, tokens_out, model) exhaust the budget? */
  wouldExhaust(call: LlmCall): boolean {
    if (this.state.budget_usd === null) return false;
    const price = this.pricing[call.model];
    if (!price) return false;
    const next =
      (call.tokens_in / 1_000_000) * price.input_per_mtok +
      (call.tokens_out / 1_000_000) * price.output_per_mtok;
    return this.state.spent_usd + next >= this.state.budget_usd;
  }
}
