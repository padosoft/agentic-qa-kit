import { z } from 'zod';
import { ExecutionMode, IsoDateTime, Sha256, Slug } from './common.js';

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

export const Run = z.object({
  schema_version: z.literal('1'),
  id: Slug,
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
});
export type Run = z.infer<typeof Run>;
