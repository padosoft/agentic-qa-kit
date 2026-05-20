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

export function slugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}
