import { createHash } from 'node:crypto';
import type { LlmAdapter } from '@aqa/llm-adapters';
import { redactJson, redactText } from '@aqa/observability';
import { RiskMap } from '@aqa/schemas';
import type { RiskGenerationProvenance, RiskReviewQueue } from './risk-queue.js';

export interface ProposeRisksOptions {
  scope: string;
  llm: LlmAdapter;
  queue: RiskReviewQueue;
  model: string;
  id_seed?: string;
}

export interface ProposeRisksResult {
  count: number;
  enqueued_ids: ReadonlyArray<string>;
}

/** Propose review-only risk hypotheses; never mutates a project RiskMap. */
export async function proposeRisks(opts: ProposeRisksOptions): Promise<ProposeRisksResult> {
  const prompt = `Scope: ${opts.scope}`;
  const out = await opts.llm.call({
    provider: opts.llm.provider,
    model: opts.model,
    system:
      'Propose security and reliability Risk objects as a JSON array. Return hypotheses only; do not claim approval or certainty.',
    messages: [{ role: 'user', content: prompt }],
  });
  let parsed: unknown;
  try {
    parsed = redactJson(JSON.parse(out.text));
  } catch {
    return { count: 0, enqueued_ids: [] };
  }
  const provenance: RiskGenerationProvenance = {
    provider: opts.llm.provider,
    model: opts.model,
    ...(out.model_version_hash ? { model_version_hash: out.model_version_hash } : {}),
    prompt_sha256: sha256(prompt),
    response_sha256: sha256(out.text),
  };
  const safeScope = redactText(opts.scope);
  const enqueued: string[] = [];
  for (const [index, draft] of (Array.isArray(parsed) ? parsed : []).entries()) {
    const id = `${opts.id_seed ?? 'risk'}-hypothesis-${index + 1}`;
    const candidate = {
      category: 'business_logic' as const,
      severity: 'medium' as const,
      likelihood: 'possible' as const,
      invariants: [],
      owners: [],
      tags: ['generated', 'hypothesis', `scope:${safeScope}`],
      ...(isRecord(draft) ? draft : {}),
      id,
      title:
        isRecord(draft) && typeof draft.title === 'string' && draft.title.trim().length >= 4
          ? draft.title
          : `Generated risk hypothesis for ${safeScope}`,
    };
    const result = RiskMap.Risk.safeParse(candidate);
    if (!result.success) continue;
    opts.queue.enqueue(result.data, id, provenance);
    enqueued.push(id);
  }
  return { count: enqueued.length, enqueued_ids: enqueued };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
