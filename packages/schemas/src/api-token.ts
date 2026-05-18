import { z } from 'zod';
import { IsoDateTime, LongSlug, Slug } from './common.js';

export const ApiTokenScope = z.enum([
  'runs:read',
  'runs:create',
  'findings:read',
  'findings:edit',
  'audit:read',
  'admin:everything',
]);
export type ApiTokenScope = z.infer<typeof ApiTokenScope>;

/**
 * Personal + service-account API token. The full secret is shown once at
 * creation; subsequent reads return the prefix only (e.g. `aqa_pat_abcd…`).
 */
export const ApiToken = z.object({
  schema_version: z.literal('1'),
  id: LongSlug,
  org: Slug,
  prefix: z.string().min(8).max(16),
  owner: z.string().min(1),
  display_name: z.string().min(1).max(80),
  scopes: z.array(ApiTokenScope).min(1),
  created_at: IsoDateTime,
  last_used_at: IsoDateTime.optional(),
  expires_at: IsoDateTime.optional(),
  revoked_at: IsoDateTime.optional(),
});
export type ApiToken = z.infer<typeof ApiToken>;
