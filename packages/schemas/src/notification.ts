import { z } from 'zod';
import { IsoDateTime, LongSlug, Slug } from './common.js';

export const NotificationKind = z.enum([
  'run.failed',
  'finding.critical',
  'finding.verified',
  'budget.threshold',
  'audit.chain_broken',
  'pack.install_failed',
  'queue.stuck',
  'user.invited',
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const Notification = z.object({
  schema_version: z.literal('1'),
  id: LongSlug,
  kind: NotificationKind,
  at: IsoDateTime,
  org: Slug,
  project: Slug,
  actor: z.string().min(1),
  /** Free-form summary the UI renders directly. */
  summary: z.string().min(1),
  /** Optional structured detail. */
  payload: z.record(z.unknown()).default({}),
  read_by: z.array(z.string()).default([]),
});
export type Notification = z.infer<typeof Notification>;
