import type { PackManifest } from '@aqa/schemas';

export interface AppliesContext {
  runtime?: string;
  framework?: string;
  db?: string[];
  sut_type?: string;
  tags?: string[];
}

/**
 * Evaluate a pack's `applies_when` predicate against a project context.
 *
 * Predicate semantics (all clauses AND together; a missing clause is "any"):
 *   runtime      — match if any element equals ctx.runtime
 *   framework    — match if any element equals ctx.framework
 *   db           — match if any element is contained in ctx.db
 *   sut_type     — match if any element equals ctx.sut_type
 *   tags_any     — match if any element is contained in ctx.tags
 *   tags_all     — match only if every element is contained in ctx.tags
 *
 * An empty `applies_when` (no clauses set) matches anything — useful for the
 * `core` pack that should be installed in every project by default.
 */
export function appliesWhen(manifest: PackManifest.PackManifest, ctx: AppliesContext): boolean {
  const w = manifest.applies_when;
  if (!w) return true;
  if (w.runtime && !valueIn(w.runtime, ctx.runtime)) return false;
  if (w.framework && !valueIn(w.framework, ctx.framework)) return false;
  if (w.sut_type && !valueIn(w.sut_type, ctx.sut_type)) return false;
  if (w.db && !arrayOverlap(w.db, ctx.db ?? [])) return false;
  if (w.tags_any && !arrayOverlap(w.tags_any, ctx.tags ?? [])) return false;
  if (w.tags_all && !w.tags_all.every((t) => (ctx.tags ?? []).includes(t))) return false;
  return true;
}

function valueIn(list: readonly string[], v: string | undefined): boolean {
  return v !== undefined && list.includes(v);
}

function arrayOverlap(needles: readonly string[], haystack: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}
