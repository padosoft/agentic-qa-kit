/**
 * Shared helpers used across CLI commands.
 *
 * `lastPathSegment` + `slugify` were originally duplicated between
 * `init.ts` and `install-agent-files.ts`. Both commands derive the
 * project name from cwd when the user doesn't pass one, so they must
 * produce identical results — extracting them here removes the drift
 * risk if the Slug rules ever change.
 */

export function lastPathSegment(root: string): string {
  const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] ?? 'project';
}

/**
 * `@aqa/schemas` Slug has `.max(64)`. The slugifier feeds this value into
 * `Project.name` (project.yaml + risk-map.yaml) where the schema would
 * otherwise reject anything longer at `aqa validate` time. Cap to 64 *after*
 * normalization and re-trim trailing dashes so the truncated tail doesn't
 * become an illegal `-`-terminated slug.
 */
const SLUG_MAX_LEN = 64;

export function slugify(raw: string): string {
  const normalized =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  if (normalized.length <= SLUG_MAX_LEN) return normalized;
  // Re-strip leading/trailing dashes after the slice — a cap that lands
  // inside a `-` run would leave the slug ending in `-`, which the schema
  // rejects.
  return normalized.slice(0, SLUG_MAX_LEN).replace(/-+$/, '') || 'project';
}
