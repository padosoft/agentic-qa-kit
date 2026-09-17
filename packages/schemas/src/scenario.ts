import { z } from 'zod';
import { Slug } from './common.js';

export const ProbeKind = z.enum(['http', 'shell', 'sql', 'playwright', 'llm_eval', 'fs', 'custom']);
export type ProbeKind = z.infer<typeof ProbeKind>;

export const Probe = z.object({
  id: Slug,
  kind: ProbeKind,
  with: z.record(z.string(), z.unknown()).default({}),
  timeout_ms: z.number().int().positive().max(600_000).default(30_000),
});
export type Probe = z.infer<typeof Probe>;

export const OracleKind = z.enum([
  'http_status',
  'response_contains',
  'response_not_contains',
  'json_schema',
  'db_query',
  'semantic_llm_judge',
  'custom',
]);
export type OracleKind = z.infer<typeof OracleKind>;

export const Oracle = z.object({
  id: Slug,
  kind: OracleKind,
  /** Explicit step output consumed by this oracle; omitted means legacy last/all semantics. */
  probe_id: Slug.optional(),
  with: z.record(z.string(), z.unknown()).default({}),
  weight: z.number().min(0).max(1).default(1),
});
export type Oracle = z.infer<typeof Oracle>;

export const Scenario = z
  .object({
    schema_version: z.literal('1'),
    id: Slug,
    title: z.string().min(4).max(200),
    risk_refs: z.array(Slug).min(1, 'a scenario must reference at least one risk id'),
    invariant_refs: z.array(Slug).default([]),
    preconditions: z.array(z.string()).default([]),
    steps: z.array(Probe).min(1, 'a scenario must have at least one probe step'),
    oracles: z.array(Oracle).min(1, 'a scenario must have at least one oracle'),
    cleanup: z.array(Probe).default([]),
    tags: z.array(z.string()).default([]),
    seed: z.string().optional(),
  })
  .superRefine((scenario, ctx) => {
    const stepIds = new Set<string>();
    for (const [index, step] of scenario.steps.entries()) {
      if (stepIds.has(step.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'id'],
          message: 'step ids must be unique',
        });
      stepIds.add(step.id);
    }
    for (const [index, oracle] of scenario.oracles.entries()) {
      if (oracle.probe_id && !stepIds.has(oracle.probe_id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oracles', index, 'probe_id'],
          message: `oracle references unknown probe "${oracle.probe_id}"`,
        });
    }
  });
export type Scenario = z.infer<typeof Scenario>;
