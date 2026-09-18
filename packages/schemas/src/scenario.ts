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

/**
 * An executable setup assertion. String preconditions remain supported as
 * human-readable context, while this shape gives the runner a verifiable
 * contract that must pass before scenario steps can have side effects.
 */
export const Precondition = z.object({
  id: Slug,
  probe: Probe,
  oracle: Oracle,
});
export type Precondition = z.infer<typeof Precondition>;

export const Scenario = z
  .object({
    schema_version: z.literal('1'),
    id: Slug,
    title: z.string().min(4).max(200),
    risk_refs: z.array(Slug).min(1, 'a scenario must reference at least one risk id'),
    invariant_refs: z.array(Slug).default([]),
    preconditions: z.array(z.union([z.string(), Precondition])).default([]),
    steps: z.array(Probe).min(1, 'a scenario must have at least one probe step'),
    oracles: z.array(Oracle).min(1, 'a scenario must have at least one oracle'),
    cleanup: z.array(Probe).default([]),
    /** Scenarios sharing this key are serialized when the profile uses grouped isolation. */
    isolation_group: Slug.optional(),
    tags: z.array(z.string()).default([]),
    seed: z.string().optional(),
  })
  .superRefine((scenario, ctx) => {
    const stepIds = new Set<string>();
    const validateHttpProbe = (step: Probe, path: (string | number)[]) => {
      if (step.kind !== 'http') return;
      const allowed = new Set(['method', 'url', 'headers', 'body', 'auth']);
      for (const key of Object.keys(step.with)) {
        if (!allowed.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, 'with', key],
            message: `unsupported HTTP probe field "${key}"`,
          });
        }
      }
      if (
        step.with.auth !== undefined &&
        (typeof step.with.auth !== 'string' ||
          !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(step.with.auth))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, 'with', 'auth'],
          message: 'auth must be a named secret reference such as ${TOKEN}',
        });
      }
      const headers = step.with.headers;
      if (
        headers !== undefined &&
        (!headers ||
          typeof headers !== 'object' ||
          Array.isArray(headers) ||
          Object.values(headers as Record<string, unknown>).some(
            (value) => typeof value !== 'string',
          ))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, 'with', 'headers'],
          message: 'headers must be an object of string values',
        });
      }
    };
    for (const [index, step] of scenario.steps.entries()) {
      if (stepIds.has(step.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'id'],
          message: 'step ids must be unique',
        });
      stepIds.add(step.id);
      validateHttpProbe(step, ['steps', index]);
    }
    for (const [index, step] of scenario.cleanup.entries()) {
      validateHttpProbe(step, ['cleanup', index]);
    }
    const preconditionIds = new Set<string>();
    for (const [index, precondition] of scenario.preconditions.entries()) {
      if (typeof precondition === 'string') continue;
      if (preconditionIds.has(precondition.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['preconditions', index, 'id'],
          message: 'precondition ids must be unique',
        });
      }
      preconditionIds.add(precondition.id);
      validateHttpProbe(precondition.probe, ['preconditions', index, 'probe']);
      if (precondition.oracle.probe_id && precondition.oracle.probe_id !== precondition.probe.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['preconditions', index, 'oracle', 'probe_id'],
          message: `precondition oracle must reference its probe "${precondition.probe.id}"`,
        });
      }
    }
    for (const [index, oracle] of scenario.oracles.entries()) {
      if (oracle.probe_id && !stepIds.has(oracle.probe_id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oracles', index, 'probe_id'],
          message: `oracle references unknown probe "${oracle.probe_id}"`,
        });
      if (oracle.kind === 'http_status' && typeof oracle.with.expected !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oracles', index, 'with', 'expected'],
          message: 'http_status expected must be a number',
        });
      }
      if (oracle.kind === 'response_contains') {
        const jsonpath = oracle.with.jsonpath;
        const hasPath = typeof jsonpath === 'string';
        const hasEquals = Object.prototype.hasOwnProperty.call(oracle.with, 'equals');
        if (hasPath && !jsonpath.startsWith('$.')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oracles', index, 'with', 'jsonpath'],
            message: 'jsonpath must be a bounded path beginning with $.',
          });
        }
        if (hasPath !== hasEquals) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oracles', index, 'with'],
            message: 'jsonpath and equals must be provided together',
          });
        }
        if (!hasPath && typeof oracle.with.value !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oracles', index, 'with', 'value'],
            message: 'response_contains requires a string value or jsonpath/equals',
          });
        }
      }
    }
  });
export type Scenario = z.infer<typeof Scenario>;
