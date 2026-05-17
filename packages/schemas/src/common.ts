import { z } from 'zod';

export const ExecutionMode = z.enum(['orchestrator', 'agent']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof Severity>;

export const Status = z.enum(['draft', 'verified', 'rejected', 'duplicate', 'fixed']);
export type Status = z.infer<typeof Status>;

export const SemVer = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'invalid semver');

// Lowercase only: regex flags do not survive emission to JSON Schema, so the
// Zod and JSON-Schema validators stay equivalent only if the pattern itself is
// case-insensitive by construction. Uppercase identifiers should be rejected.
export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with dashes');

export const FindingIdPattern = /^AQA-\d{4}-\d{4,}$/;
export const FindingId = z.string().regex(FindingIdPattern, 'finding id must match AQA-YYYY-NNNN');

export const IsoDateTime = z.string().datetime({ offset: true });

export const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'sha256 hex digest expected (64 lowercase hex chars)');

export const Url = z.string().url();
