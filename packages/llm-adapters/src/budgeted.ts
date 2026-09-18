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
  /** Bounded, prompt-free usage/deny events for the host audit/metrics sink. */
  onEvent?: (event: BudgetAdapterEvent) => void;
}

export interface BudgetAdapterEvent {
  kind: 'llm_call' | 'budget_exceeded';
  ts: string;
  provider: LlmAdapter['provider'];
  model: string;
  status: 'completed' | 'denied';
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  reason?: string;
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
    this.onEvent = opts.onEvent;
  }

  private readonly ledger: BudgetLedger | undefined;
  private readonly ledgerKey: string | undefined;
  private readonly budgetUsd: number | null;
  private readonly onEvent: ((event: BudgetAdapterEvent) => void) | undefined;

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    try {
      this.tracker.assertCanDispatch(this.estimate(input));
    } catch (error) {
      this.emitDenied(input, error);
      throw error;
    }
    const estimate = this.estimate(input);
    let reservation: string | undefined;
    try {
      reservation = this.ledger
        ? await this.ledger.reserve(
            this.ledgerKey as string,
            this.budgetUsd,
            this.tracker.costOf(estimate),
          )
        : undefined;
    } catch (error) {
      this.emitDenied(input, error);
      throw error;
    }
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
    this.emit({
      kind: 'llm_call',
      ts: new Date().toISOString(),
      provider: this.provider,
      model: input.model,
      status: 'completed',
      tokens_in: output.tokens_in,
      tokens_out: output.tokens_out,
      cost_usd: this.tracker.costOf({
        model: input.model,
        tokens_in: output.tokens_in,
        tokens_out: output.tokens_out,
      }),
    });
    if (state.exhausted)
      throw new BudgetDispatchBlockedError(state.halted_reason ?? 'budget exhausted after call');
    return output;
  }

  snapshot(): BudgetState {
    return this.tracker.snapshot();
  }

  private emitDenied(input: LlmCallInput, error: unknown): void {
    this.emit({
      kind: 'budget_exceeded',
      ts: new Date().toISOString(),
      provider: this.provider,
      model: input.model,
      status: 'denied',
      reason: (error instanceof Error ? error.message : 'budget dispatch denied').slice(0, 200),
    });
  }

  private emit(event: BudgetAdapterEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // Audit/metrics observers must not turn an already governed provider
      // call into an ungoverned retry or a false application failure.
    }
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
