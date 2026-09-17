import postgres from 'postgres';
import type { Sql } from 'postgres';

export type ApprovalClaim = 'claimed' | 'duplicate' | 'conflict';

export interface CommerceApprovalLedger {
  claim(approvalId: string, callId: string): Promise<ApprovalClaim>;
  close?(): Promise<void>;
}

export class InMemoryCommerceApprovalLedger implements CommerceApprovalLedger {
  private readonly claims = new Map<string, string>();

  async claim(approvalId: string, callId: string): Promise<ApprovalClaim> {
    validateKeys(approvalId, callId);
    const existing = this.claims.get(approvalId);
    if (!existing) {
      this.claims.set(approvalId, callId);
      return 'claimed';
    }
    return existing === callId ? 'duplicate' : 'conflict';
  }
}

export class PostgresCommerceApprovalLedger implements CommerceApprovalLedger {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[commerce/approval] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async claim(approvalId: string, callId: string): Promise<ApprovalClaim> {
    validateKeys(approvalId, callId);
    await this.ready;
    const inserted = await this.query<{ claimed: boolean }>(
      'INSERT INTO aqa_commerce_approvals (approval_id, call_id) VALUES ($1, $2) ON CONFLICT (approval_id) DO NOTHING RETURNING true AS claimed',
      [approvalId, callId],
    );
    if (inserted[0]?.claimed === true) return 'claimed';
    const existing = await this.query<{ call_id: string }>(
      'SELECT call_id FROM aqa_commerce_approvals WHERE approval_id = $1',
      [approvalId],
    );
    return existing[0]?.call_id === callId ? 'duplicate' : 'conflict';
  }

  private async query<T>(text: string, values: unknown[] = []): Promise<T[]> {
    const unsafe = this.sql.unsafe as unknown as (
      query: string,
      params: unknown[],
    ) => Promise<unknown>;
    return (await unsafe(text, values)) as T[];
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_commerce_approvals_schema'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_commerce_approvals (approval_id text PRIMARY KEY, call_id text NOT NULL, claimed_at timestamptz NOT NULL DEFAULT now())',
      );
    });
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }
}

function validateKeys(approvalId: string, callId: string): void {
  if (!approvalId.trim() || !callId.trim())
    throw new Error('[commerce/approval] keys are required');
}
