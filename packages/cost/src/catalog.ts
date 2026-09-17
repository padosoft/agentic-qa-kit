import { createHash } from 'node:crypto';
import type { ModelPricing } from './pricing.js';

export interface PricingCatalog {
  schema_version: '1';
  version: string;
  effective_at: string;
  models: Readonly<Record<string, ModelPricing>>;
  sha256: string;
}

/** Parse and hash a deterministic pricing catalog before it reaches a tracker. */
export function parsePricingCatalog(input: unknown): PricingCatalog {
  if (!input || typeof input !== 'object')
    throw new Error('[cost] pricing catalog must be an object');
  const raw = input as Record<string, unknown>;
  if (raw.schema_version !== '1' || typeof raw.version !== 'string' || !raw.version.trim())
    throw new Error('[cost] pricing catalog schema_version/version are required');
  if (typeof raw.effective_at !== 'string' || Number.isNaN(Date.parse(raw.effective_at)))
    throw new Error('[cost] pricing catalog effective_at must be an ISO date');
  if (!raw.models || typeof raw.models !== 'object' || Array.isArray(raw.models))
    throw new Error('[cost] pricing catalog models must be an object');
  const models: Record<string, ModelPricing> = {};
  for (const [model, value] of Object.entries(raw.models as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') throw new Error(`[cost] invalid pricing for ${model}`);
    const price = value as Record<string, unknown>;
    if (
      typeof price.input_per_mtok !== 'number' ||
      !Number.isFinite(price.input_per_mtok) ||
      price.input_per_mtok < 0 ||
      typeof price.output_per_mtok !== 'number' ||
      !Number.isFinite(price.output_per_mtok) ||
      price.output_per_mtok < 0
    )
      throw new Error(`[cost] invalid pricing for ${model}`);
    models[model] = {
      input_per_mtok: price.input_per_mtok,
      output_per_mtok: price.output_per_mtok,
    };
  }
  const canonical = JSON.stringify({
    schema_version: '1',
    version: raw.version,
    effective_at: raw.effective_at,
    models: sortModels(models),
  });
  const sha256 = createHash('sha256').update(canonical).digest('hex');
  if (raw.sha256 !== undefined && raw.sha256 !== sha256)
    throw new Error('[cost] pricing catalog sha256 mismatch');
  return {
    schema_version: '1',
    version: raw.version,
    effective_at: raw.effective_at,
    models: sortModels(models),
    sha256,
  };
}

function sortModels(models: Record<string, ModelPricing>): Record<string, ModelPricing> {
  return Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)));
}
