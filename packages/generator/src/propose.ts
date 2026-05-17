import type { LlmAdapter } from '@aqa/llm-adapters';
import { Scenario } from '@aqa/schemas';
import type { ReviewQueue } from './queue.js';

export interface ProposeOptions {
  risk_id: string;
  invariant_statement: string;
  llm: LlmAdapter;
  queue: ReviewQueue;
  /** Model name to record in the call for cost-rollup attribution. */
  model: string;
  /** Optional id base; defaults to risk_id + counter. */
  id_seed?: string;
}

export interface ProposeResult {
  count: number;
  enqueued_ids: ReadonlyArray<string>;
}

const SCENARIO_FALLBACK_SHAPE = {
  schema_version: '1' as const,
  steps: [{ id: 'probe-1', kind: 'http' as const, with: {}, timeout_ms: 30_000 }],
  oracles: [{ id: 'oracle-1', kind: 'http_status' as const, with: { expected: 200 }, weight: 1 }],
  cleanup: [],
  tags: ['generated'],
};

/**
 * Ask the LLM for one or more scenario drafts targeting the given risk +
 * invariant. The model's text is parsed as JSON; everything that validates
 * against the Scenario schema enters the queue in `pending` state. Anything
 * that fails validation is dropped with a console warning — we never enqueue
 * invalid scenarios because the runner would reject them anyway.
 */
export async function proposeScenarios(opts: ProposeOptions): Promise<ProposeResult> {
  const out = await opts.llm.call({
    provider: opts.llm.provider,
    model: opts.model,
    system:
      'Draft one or more Scenario YAMLs as JSON objects that exercise the given Risk + Invariant. Output a single JSON array.',
    messages: [
      {
        role: 'user',
        content: `Risk: ${opts.risk_id}\nInvariant: ${opts.invariant_statement}`,
      },
    ],
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.text);
  } catch {
    return { count: 0, enqueued_ids: [] };
  }
  const drafts = Array.isArray(parsed) ? parsed : [];
  const enqueued: string[] = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const candidate = {
      ...SCENARIO_FALLBACK_SHAPE,
      ...(drafts[i] as Record<string, unknown>),
      risk_refs: [opts.risk_id],
    };
    const result = Scenario.Scenario.safeParse(candidate);
    if (!result.success) continue;
    const id = `${opts.id_seed ?? opts.risk_id}-gen-${i + 1}`;
    opts.queue.enqueue(result.data, id);
    enqueued.push(id);
  }
  return { count: enqueued.length, enqueued_ids: enqueued };
}
