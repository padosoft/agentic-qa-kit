import { z } from 'zod';
import { ExecutionMode, Slug } from './common.js';

export const LlmUsage = z.enum([
  'scenario_generation',
  'semantic_oracle',
  'bug_minimization',
  'agent_driven',
]);
export type LlmUsage = z.infer<typeof LlmUsage>;

export const Profile = z.object({
  schema_version: z.literal('1'),
  name: Slug,
  execution_mode: ExecutionMode,
  llm_usage: z.array(LlmUsage).default([]),
  llm_budget_usd: z.number().nonnegative().nullable().default(null),
  budget_minutes: z.number().int().positive().optional(),
  parallelism: z.number().int().positive().max(64).default(1),
  require_deterministic_replay: z.boolean().default(false),
  packs: z.array(Slug).default([]),
  tags: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof Profile>;

export const ProfilesFile = z
  .object({
    schema_version: z.literal('1'),
    profiles: z.record(Slug, Profile),
  })
  .superRefine((v, ctx) => {
    for (const [key, profile] of Object.entries(v.profiles)) {
      if (profile.name !== key) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', key, 'name'],
          message: `profile name "${profile.name}" must match its key "${key}"`,
        });
      }
    }
  });
export type ProfilesFile = z.infer<typeof ProfilesFile>;
