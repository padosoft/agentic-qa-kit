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
// No trailing dashes, no consecutive dashes — safe to use as a path segment,
// URL fragment, or anchor without normalisation.
const SlugPattern = /^[a-z0-9](?:-?[a-z0-9])*$/;
export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(SlugPattern, 'slug must be lowercase alphanumeric with dashes');

// Longer-form slug for identifiers that include timestamps, UUID/ULID, host
// names, or other composite parts (run ids, scenario instances). Same charset
// rules as Slug but generous on length so real-world conventions (UUIDv4 = 36,
// ULID = 26, `run-2026-05-17-<ts>-<host>-<rand>`) fit without hitting the cap.
export const LongSlug = z
  .string()
  .min(1)
  .max(256)
  .regex(SlugPattern, 'identifier must be lowercase alphanumeric with dashes');

export const FindingIdPattern = /^AQA-\d{4}-\d{4,}$/;
export const FindingId = z.string().regex(FindingIdPattern, 'finding id must match AQA-YYYY-NNNN');

export const IsoDateTime = z.string().datetime({ offset: true });

export const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'sha256 hex digest expected (64 lowercase hex chars)');

export const Url = z.string().url();
