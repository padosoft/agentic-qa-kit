import { redactText } from '@aqa/observability';
import type { EventChainWriter } from './events.js';

const MAX_ACCOUNTING_COUNTER = 1_000_000_000_000;
const MAX_ACCOUNTING_COST_USD = 1_000_000_000;

/** The prompt-free event contract emitted by @aqa/llm-adapters. */
export interface BudgetAuditEvent {
  kind: 'llm_call' | 'budget_exceeded';
  ts: string;
  provider: string;
  model: string;
  status: 'completed' | 'denied' | 'exhausted';
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  reason?: string;
}

export interface BudgetEventSinkOptions {
  events: EventChainWriter;
  run_id: string;
  scenario_id?: string;
  actor?: { type: 'orchestrator' | 'agent' | 'system'; id: string; model?: string };
}

/**
 * Adapt governed LLM budget events to the run's tamper-evident audit chain.
 *
 * The adapter deliberately copies only bounded accounting metadata. Prompts,
 * completions and arbitrary provider payloads cannot cross this boundary.
 */
export function makeBudgetEventSink(
  opts: BudgetEventSinkOptions,
): (event: BudgetAuditEvent) => void {
  const actor = opts.actor ?? { type: 'system', id: 'llm-budget' };
  return (event) => {
    const payload: Record<string, unknown> = {
      provider: event.provider.slice(0, 80),
      model: event.model.slice(0, 160),
      status: event.status,
    };
    const tokensIn = boundedCounter(event.tokens_in);
    const tokensOut = boundedCounter(event.tokens_out);
    const costUsd = boundedCost(event.cost_usd);
    if (tokensIn !== undefined) payload.tokens_in = tokensIn;
    if (tokensOut !== undefined) payload.tokens_out = tokensOut;
    if (costUsd !== undefined) payload.cost_usd = costUsd;
    if (event.reason !== undefined) payload.reason = redactText(event.reason).slice(0, 200);
    opts.events.append({
      ts: event.ts,
      run_id: opts.run_id,
      kind: event.kind,
      actor: {
        ...actor,
        ...(actor.model === undefined ? { model: event.model.slice(0, 160) } : {}),
      },
      ...(opts.scenario_id ? { scenario_id: opts.scenario_id } : {}),
      payload,
    });
  };
}

function boundedCounter(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_ACCOUNTING_COUNTER)
    : undefined;
}

function boundedCost(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_ACCOUNTING_COST_USD)
    : undefined;
}
