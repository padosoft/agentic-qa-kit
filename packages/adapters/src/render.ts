import { adapterByTarget } from './registry.js';
import type { AdapterTarget, RenderContext, RenderedFile } from './types.js';

export interface RenderForTargetsResult {
  byTarget: Record<AdapterTarget, RenderedFile[]>;
  all: RenderedFile[];
}

export function renderForTargets(
  targets: readonly AdapterTarget[],
  ctx: RenderContext,
): RenderForTargetsResult {
  const byTarget = {} as Record<AdapterTarget, RenderedFile[]>;
  const all: RenderedFile[] = [];
  for (const t of targets) {
    const files = adapterByTarget(t).render(ctx);
    byTarget[t] = files;
    all.push(...files);
  }
  return { byTarget, all };
}
