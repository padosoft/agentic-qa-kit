import {
  BudgetDispatchBlockedError,
  type BudgetState,
  type BudgetTracker,
  type LlmCall,
} from '@aqa/cost';
import type { LlmAdapter, LlmCallInput, LlmCallOutput } from './types.js';

export interface BudgetedLlmAdapterOptions {
  tracker: BudgetTracker;
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
    opts: Pick<BudgetedLlmAdapterOptions, 'estimate'> = {},
  ) {
    this.provider = inner.provider;
    this.estimate = opts.estimate ?? defaultEstimate;
  }

  async call(input: LlmCallInput): Promise<LlmCallOutput> {
    this.tracker.assertCanDispatch(this.estimate(input));
    const output = await this.inner.call(input);
    const state = this.tracker.charge({
      model: input.model,
      tokens_in: output.tokens_in,
      tokens_out: output.tokens_out,
    });
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
