import { z } from 'zod';
import { Slug } from './common.js';

/** Public queue request; tenant scope is supplied by the authenticated API. */
export const RunRequest = z
  .object({
    profile: Slug.optional(),
    seed: z.string().min(1).max(200).optional(),
  })
  .strict();
export type RunRequest = z.infer<typeof RunRequest>;
