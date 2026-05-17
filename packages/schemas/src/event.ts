import { z } from 'zod';
import { FindingId, IsoDateTime, LongSlug, Sha256, Slug } from './common.js';

export const EventKind = z.enum([
  'run_started',
  'run_finished',
  'scenario_started',
  'scenario_finished',
  'probe_executed',
  'oracle_evaluated',
  'finding_emitted',
  'budget_exceeded',
  'sandbox_violation',
  'llm_call',
  'tool_call',
  'replay_started',
  'replay_finished',
  'error',
  'info',
]);
export type EventKind = z.infer<typeof EventKind>;

export const Event = z.object({
  schema_version: z.literal('1'),
  seq: z.number().int().nonnegative(),
  prev_hash: Sha256.nullable(),
  hash: Sha256,
  ts: IsoDateTime,
  run_id: LongSlug,
  kind: EventKind,
  actor: z.object({
    type: z.enum(['orchestrator', 'agent', 'system']),
    id: z.string(),
    model: z.string().optional(),
  }),
  scenario_id: Slug.optional(),
  finding_id: FindingId.optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type Event = z.infer<typeof Event>;
