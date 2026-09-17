import { z } from 'zod';
import { ExecutionMode, IsoDateTime, LongSlug, Sha256, Slug } from './common.js';

export const RunState = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'aborted',
  'budget_exceeded',
]);
export type RunState = z.infer<typeof RunState>;

export const ConfigSnapshot = z.object({
  profile: Slug,
  execution_mode: ExecutionMode,
  packs: z.array(Slug).default([]),
  llm: z
    .object({
      provider: z.string(),
      model_id: z.string(),
      model_version_hash: z.string().optional(),
      api_version: z.string().optional(),
      region: z.string().optional(),
    })
    .optional(),
  prompt_hash: Sha256.optional(),
  config_hash: Sha256,
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshot>;

const TERMINAL_STATES = ['succeeded', 'failed', 'aborted', 'budget_exceeded'] as const;

export const Run = z
  .object({
    schema_version: z.literal('1'),
    id: LongSlug,
    started_at: IsoDateTime,
    finished_at: IsoDateTime.optional(),
    state: RunState,
    /** Tenant organization; absent only for explicitly unscoped legacy runs. */
    org: Slug.optional(),
    project: Slug,
    profile: Slug,
    execution_mode: ExecutionMode,
    config_snapshot: ConfigSnapshot,
    totals: z
      .object({
        scenarios: z.number().int().nonnegative().default(0),
        findings: z.number().int().nonnegative().default(0),
        probes: z.number().int().nonnegative().default(0),
        llm_tokens_in: z.number().int().nonnegative().default(0),
        llm_tokens_out: z.number().int().nonnegative().default(0),
        llm_cost_usd: z.number().nonnegative().default(0),
      })
      .strict(), // align with JSON Schema's additionalProperties:false
    artifact_dir: z.string(),
  })
  .superRefine((v, ctx) => {
    const isTerminal = (TERMINAL_STATES as readonly string[]).includes(v.state);
    if (isTerminal && !v.finished_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finished_at'],
        message: `state=${v.state} is terminal — finished_at is required`,
      });
    }
    if (!isTerminal && v.finished_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finished_at'],
        message: `state=${v.state} is non-terminal — finished_at must not be set`,
      });
    }
    if (v.finished_at && v.finished_at < v.started_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['finished_at'],
        message: 'finished_at must be >= started_at',
      });
    }
  });
export type Run = z.infer<typeof Run>;

/**
 * Derive the persisted run state from the completion event counters.
 * Consumers must use the same fail-closed rule: a completion event alone is
 * not proof of success when it reports errors or zero executed scenarios.
 */
export function deriveStateFromCompletion(completion: unknown, scenariosRun: number): RunState {
  if (!completion || typeof completion !== 'object') return 'running';
  const candidate = completion as Record<string, unknown>;
  const payload =
    candidate.payload && typeof candidate.payload === 'object'
      ? (candidate.payload as Record<string, unknown>)
      : candidate;
  const errorKeys = [
    'pack_errors',
    'scenario_errors',
    'missing_scenarios',
    'unsafe_paths',
    'runtime_errors',
  ] as const;
  if (
    payload.release_gate_failed === true ||
    errorKeys.some((key) => typeof payload[key] === 'number' && payload[key] > 0)
  ) {
    return 'failed';
  }
  return scenariosRun === 0 ? 'failed' : 'succeeded';
}
