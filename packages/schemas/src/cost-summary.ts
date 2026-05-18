import { z } from 'zod';
import { IsoDateTime, Slug } from './common.js';

/**
 * Pre-aggregated cost summary for the Cost screen. The server computes
 * this from runs + token-pricing at query time so the admin doesn't have
 * to scan every run client-side.
 */
export const CostSummaryEntry = z.object({
  profile: Slug,
  llm_tokens_in: z.number().int().nonnegative(),
  llm_tokens_out: z.number().int().nonnegative(),
  llm_cost_usd: z.number().nonnegative(),
  runs: z.number().int().nonnegative(),
});

export const CostSummary = z.object({
  schema_version: z.literal('1'),
  org: Slug,
  project: Slug,
  from: IsoDateTime,
  to: IsoDateTime,
  total_usd: z.number().nonnegative(),
  budget_usd: z.number().nonnegative().optional(),
  by_profile: z.array(CostSummaryEntry).default([]),
  /** Daily series for charts: ISO date (yyyy-mm-dd) → usd. */
  daily: z.record(z.string(), z.number().nonnegative()).default({}),
});
export type CostSummary = z.infer<typeof CostSummary>;
export type CostSummaryEntry = z.infer<typeof CostSummaryEntry>;
