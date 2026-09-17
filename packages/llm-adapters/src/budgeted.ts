import {
  BudgetDispatchBlockedError,
  type BudgetLedger,
  type BudgetState,
  type BudgetTracker,
  type LlmCall,
} from '@aqa/cost';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface BudgetedLlmAdapterOptions {
  tracker: BudgetTracker;
  ledger?: BudgetLedger;
  ledger_key?: string;
  budget_usd?: number | null;
  /** Admission estimate; production hosts should use model/tokenizer metadata. */
  estimate?: (input: LlmCallInput) => LlmCall;
}

/** Enforces per-run LLM admission and charges authoritative provider usage. */
export class BudgetedLlmAdapter implements LlmAdapter {
  readonly provider: LlmAdapter['provider'];
  private readonly estimate: (input: LlmCallInput) => LlmCall;

  constructor(
    private readonly inner: LlmAdapter,
    private readonly tracker: BudgetTracker,
    opts: Omit<BudgetedLlmAdapterOptions, 'tracker'> = {},
  ) {
    this.provider = inner.provider;
    this.estimate = opts.estimate ?? defaultEstimate;
    if ((opts.ledger && !opts.ledger_key) || (!opts.ledger && opts.ledger_key))
      throw new Error('[llm-adapters] ledger and ledger_key must be provided together');
    this.ledger = opts.ledger;
    this.ledgerKey = opts.ledger_key;
    this.budgetUsd = opts.budget_usd ?? null;
  }

  private readonly ledger: BudgetLedger | undefined;
  private readonly ledgerKey: string | undefined;
  private readonly budgetUsd: number | null;

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    this.tracker.assertCanDispatch(this.estimate(input));
    const estimate = this.estimate(input);
    const reservation = this.ledger
      ? await this.ledger.reserve(
          this.ledgerKey as string,
          this.budgetUsd,
          this.tracker.costOf(estimate),
        )
      : undefined;
    let output: LlmCallOutput;
    try {
      output = await this.inner.call(input);
    } catch (error) {
      if (reservation) await this.ledger?.settle(reservation, 0);
      throw error;
    }
    const state = this.tracker.charge({
      model: input.model,
      tokens_in: output.tokens_in,
      tokens_out: output.tokens_out,
    });
    if (reservation) {
      await this.ledger?.settle(
        reservation,
        this.tracker.costOf({
          model: input.model,
          tokens_in: output.tokens_in,
          tokens_out: output.tokens_out,
        }),
        {
          model: input.model,
          tokens_in: output.tokens_in,
          tokens_out: output.tokens_out,
          ...(state.pricing_version ? { pricing_version: state.pricing_version } : {}),
          ...(state.pricing_sha256 ? { pricing_sha256: state.pricing_sha256 } : {}),
        },
      );
    }
    if (state.exhausted)
      throw new BudgetDispatchBlockedError(state.halted_reason ?? 'budget exhausted after call');
    return output;
  }

  snapshot(): BudgetState {
    return this.tracker.snapshot();
  }
}

function defaultEstimate(input: LlmCallInput): LlmCall {
  const inputChars = [input.system ?? '', ...input.messages.map((message) => message.content)].join(
    '',
  ).length;
  return {
    model: input.model,
    tokens_in: Math.max(1, Math.ceil(inputChars / 4)),
    tokens_out: input.max_tokens ?? 4_096,
  };
}
