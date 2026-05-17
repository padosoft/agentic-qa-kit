import { z } from 'zod';
import { Severity, Slug } from './common.js';

export const RiskCategory = z.enum([
  'auth',
  'data',
  'integrity',
  'availability',
  'confidentiality',
  'integration',
  'business_logic',
  'ui_ux',
  'compliance',
  'agentic',
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const Invariant = z.object({
  id: Slug,
  statement: z.string().min(8),
  must_hold: z.literal(true).default(true),
});
export type Invariant = z.infer<typeof Invariant>;

export const Risk = z.object({
  id: Slug,
  category: RiskCategory,
  title: z.string().min(4),
  description: z.string().optional(),
  severity: Severity,
  likelihood: z.enum(['rare', 'unlikely', 'possible', 'likely', 'almost_certain']),
  invariants: z.array(Invariant).default([]),
  owners: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type Risk = z.infer<typeof Risk>;

export const RiskMap = z.object({
  schema_version: z.literal('1'),
  project: Slug,
  generated_at: z.string().datetime({ offset: true }).optional(),
  risks: z.array(Risk).min(1),
});
export type RiskMap = z.infer<typeof RiskMap>;
