import type { EventChainWriter } from './events.js';

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
    if (event.tokens_in !== undefined) payload.tokens_in = event.tokens_in;
    if (event.tokens_out !== undefined) payload.tokens_out = event.tokens_out;
    if (event.cost_usd !== undefined) payload.cost_usd = event.cost_usd;
    if (event.reason !== undefined) payload.reason = event.reason.slice(0, 200);
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
