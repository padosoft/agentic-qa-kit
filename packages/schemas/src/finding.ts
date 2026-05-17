import { z } from 'zod';
import {
  ExecutionMode,
  FindingId,
  IsoDateTime,
  LongSlug,
  Severity,
  Slug,
  Status,
} from './common.js';

export const ReproLevel = z
  .object({
    deterministic: z.boolean(),
    attempts: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    artifact_path: z.string().optional(),
    seed: z.string().optional(),
    model_pinned: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.successes > v.attempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['successes'],
        message: 'successes cannot exceed attempts',
      });
    }
    if (v.deterministic && (v.attempts < 1 || v.successes !== v.attempts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deterministic'],
        message:
          'deterministic=true requires attempts >= 1 and successes === attempts (every retry must succeed)',
      });
    }
  });
export type ReproLevel = z.infer<typeof ReproLevel>;

export const Reproducibility = z.object({
  bug_level: ReproLevel.optional(),
  scenario_level: ReproLevel.optional(),
  agent_level: ReproLevel.optional(),
});
export type Reproducibility = z.infer<typeof Reproducibility>;

export const VerificationFloor = z.enum(['bug_level', 'scenario_level', 'agent_level']);

export const ConfidenceComponents = z.object({
  oracle_agreement: z.number().min(0).max(1).optional(),
  agent_self_reported: z.number().min(0).max(1).optional(),
  judge_ensemble: z.number().min(0).max(1).optional(),
  replay_success_rate: z.number().min(0).max(1).optional(),
  historical_fp_rate: z.number().min(0).max(1).optional(),
});
export type ConfidenceComponents = z.infer<typeof ConfidenceComponents>;

export const Finding = z
  .object({
    schema_version: z.literal('1'),
    id: FindingId,
    run_id: LongSlug,
    scenario_id: Slug,
    risk_id: Slug,
    title: z.string().min(4).max(200),
    summary: z.string().min(10),
    severity: Severity,
    status: Status,
    execution_mode: ExecutionMode,
    discovered_at: IsoDateTime,
    confidence: z.number().min(0).max(1),
    confidence_components: ConfidenceComponents.default({}),
    reproducibility: Reproducibility.default({}),
    verification_floor: VerificationFloor,
    evidence: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    duplicate_of: FindingId.optional(),
  })
  .superRefine((v, ctx) => {
    const floor = v.reproducibility[v.verification_floor];
    if (v.status === 'verified' && (!floor || !floor.deterministic)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reproducibility', v.verification_floor],
        message: `status=verified requires reproducibility.${v.verification_floor}.deterministic === true`,
      });
    }
    if (v.duplicate_of !== undefined && v.duplicate_of === v.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duplicate_of'],
        message: 'duplicate_of must not equal id (a finding cannot duplicate itself)',
      });
    }
    if (v.status === 'duplicate' && v.duplicate_of === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duplicate_of'],
        message: 'status="duplicate" requires duplicate_of to be set',
      });
    }
  });
export type Finding = z.infer<typeof Finding>;
