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
    project: Slug,
    profile: Slug,
    execution_mode: ExecutionMode,
    config_snapshot: ConfigSnapshot,
    totals: z.object({
      scenarios: z.number().int().nonnegative().default(0),
      findings: z.number().int().nonnegative().default(0),
      probes: z.number().int().nonnegative().default(0),
      llm_tokens_in: z.number().int().nonnegative().default(0),
      llm_tokens_out: z.number().int().nonnegative().default(0),
      llm_cost_usd: z.number().nonnegative().default(0),
    }),
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
