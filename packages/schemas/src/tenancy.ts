import { z } from 'zod';
import { IsoDateTime, Slug } from './common.js';

export const Org = z.object({
  schema_version: z.literal('1'),
  slug: Slug,
  display_name: z.string().min(1).max(120),
  created_at: IsoDateTime,
  default_project: Slug.optional(),
});
export type Org = z.infer<typeof Org>;

export const ProjectRef = z.object({
  schema_version: z.literal('1'),
  org: Slug,
  slug: Slug,
  display_name: z.string().min(1).max(120),
  created_at: IsoDateTime,
  archived_at: IsoDateTime.optional(),
});
export type ProjectRef = z.infer<typeof ProjectRef>;
