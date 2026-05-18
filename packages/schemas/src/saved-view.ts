import { z } from 'zod';
import { IsoDateTime, LongSlug, Slug } from './common.js';

export const SavedViewSurface = z.enum([
  'runs',
  'findings',
  'risk-map',
  'packs',
  'scenarios',
  'audit',
  'queue',
]);
export type SavedViewSurface = z.infer<typeof SavedViewSurface>;

/**
 * A bookmarked list/table view. Lives at `(org, project, surface, name)`.
 * Filters/sort/columns are opaque to the schema; the admin UI owns the
 * shape.
 */
export const SavedView = z.object({
  schema_version: z.literal('1'),
  id: LongSlug,
  org: Slug,
  project: Slug,
  surface: SavedViewSurface,
  name: z.string().min(1).max(80),
  owner: z.string().min(1),
  shared: z.boolean().default(false),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  state: z.record(z.unknown()).default({}),
});
export type SavedView = z.infer<typeof SavedView>;
