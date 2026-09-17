import { z } from 'zod';
import { Slug } from './common.js';

/** Public queue request; tenant scope is supplied by the authenticated API. */
export const RunRequest = z
  .object({
    profile: Slug.optional(),
    seed: z.string().min(1).max(200).optional(),
    /** Queue scheduling hint; higher values run first within a tenant queue. */
    priority: z.number().int().min(-10).max(10).optional(),
  })
  .strict();
export type RunRequest = z.infer<typeof RunRequest>;
