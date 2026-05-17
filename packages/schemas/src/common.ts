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

export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, 'slug must be alphanumeric with dashes');

export const IsoDateTime = z.string().datetime({ offset: true });

export const Sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'sha256 hex digest expected (64 lowercase hex chars)');

export const Url = z.string().url();
