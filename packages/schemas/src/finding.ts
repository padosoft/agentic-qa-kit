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

export const FindingVerification = z
  .object({
    schema_version: z.literal('1'),
    verification_id: LongSlug,
    observed_at: IsoDateTime,
    outcome: z.enum(['fixed', 'reproduced', 'inconclusive']),
    attempts: z.number().int().min(1).max(10),
    successes: z.number().int().min(0).max(10),
    deterministic: z.boolean(),
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    expected_fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    evidence_path: z.string().min(1).max(512),
    actor: z.string().min(1).max(128),
  })
  .superRefine((v, ctx) => {
    if (v.successes > v.attempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['successes'],
        message: 'successes cannot exceed attempts',
      });
    }
    if (v.deterministic && v.successes !== v.attempts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deterministic'],
        message: 'deterministic=true requires every verification attempt to succeed',
      });
    }
    if (v.outcome === 'reproduced' && !v.fingerprint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fingerprint'],
        message: 'reproduced verification requires a failure fingerprint',
      });
    }
    if (v.outcome === 'reproduced' && !v.expected_fingerprint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expected_fingerprint'],
        message: 'reproduced verification requires the original failure fingerprint',
      });
    }
  });
export type FindingVerification = z.infer<typeof FindingVerification>;

export function statusAfterVerification(
  current: Status,
  verification: FindingVerification,
): Status | null {
  if (!verification.deterministic) return null;
  if (verification.outcome === 'fixed' && current !== 'fixed') return 'fixed';
  if (verification.outcome === 'reproduced' && current === 'fixed') return 'regressed';
  return null;
}

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
    /** Stable digest of the failed oracle set that produced this occurrence. */
    failure_fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    reproducibility: Reproducibility.default({}),
    verification_floor: VerificationFloor,
    last_verification: FindingVerification.optional(),
    evidence: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    duplicate_of: FindingId.optional(),
    root_cause_id: Slug.optional(),
    blast_radius: z.number().positive().finite().max(1_000_000).optional(),
    cost_to_fix_estimate: z.number().positive().finite().max(1_000_000).optional(),
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

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<Finding['status'], readonly Finding['status'][]>
> = {
  draft: ['verified', 'rejected', 'duplicate', 'fixed'],
  verified: ['rejected', 'duplicate', 'fixed'],
  rejected: ['draft', 'fixed'],
  duplicate: ['draft', 'fixed'],
  fixed: ['draft', 'regressed'],
  regressed: ['draft', 'verified', 'fixed'],
};

/** Validate a status transition at the write boundary, not only in the API. */
export function validateStatusTransition(
  from: Finding['status'],
  to: Finding['status'],
): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `finding is already ${to}` };
  if (!ALLOWED_STATUS_TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `status transition ${from} → ${to} is not allowed` };
  }
  return { ok: true };
}
