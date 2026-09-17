import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { BudgetDispatchBlockedError } from './budget.js';

export interface BudgetLedger {
  reserve(
    key: string,
    budgetUsd: number | null,
    estimatedUsd: number,
    ttlMs?: number,
  ): Promise<string>;
  settle(reservationId: string, actualUsd: number, usage?: BudgetUsage): Promise<void>;
  reapExpired(now?: Date): Promise<number>;
  close?(): Promise<void>;
}

/** Optional operator control plane for ledgers that support HA kill-switches. */
export interface BudgetHaltController {
  halt(key: string, reason: string): Promise<void>;
  getHaltReason(key: string): Promise<string | null>;
}

/** Auditable provider usage attached to a settled reservation. */
export interface BudgetUsage {
  model: string;
  tokens_in: number;
  tokens_out: number;
  pricing_version?: string;
  pricing_sha256?: string;
}

type MemoryBudget = { budgetUsd: number | null; reservedUsd: number; spentUsd: number };
type MemoryReservation = {
  key: string;
  estimatedUsd: number;
  expiresAt: number;
  settled: boolean;
  actualUsd?: number;
  usage?: BudgetUsage;
};

export class MemoryBudgetLedger implements BudgetLedger, BudgetHaltController {
  private readonly budgets = new Map<string, MemoryBudget>();
  private readonly reservations = new Map<string, MemoryReservation>();
  private readonly halts = new Map<string, string>();

  async reserve(
    key: string,
    budgetUsd: number | null,
    estimatedUsd: number,
    ttlMs = 300_000,
  ): Promise<string> {
    validateKey(key);
    validateAmount(estimatedUsd);
    validateTtl(ttlMs);
    const haltReason = this.halts.get(key);
    if (haltReason) throw new BudgetDispatchBlockedError(`halted: ${haltReason}`);
    const current = this.budgets.get(key) ?? { budgetUsd, reservedUsd: 0, spentUsd: 0 };
    if (current.budgetUsd !== budgetUsd && this.budgets.has(key))
      throw new Error('[cost] budget configuration changed for active ledger key');
    if (budgetUsd !== null && current.spentUsd + current.reservedUsd + estimatedUsd >= budgetUsd)
      throw new BudgetDispatchBlockedError('distributed budget exhausted');
    current.budgetUsd = budgetUsd;
    current.reservedUsd += estimatedUsd;
    this.budgets.set(key, current);
    const id = randomUUID();
    this.reservations.set(id, { key, estimatedUsd, expiresAt: Date.now() + ttlMs, settled: false });
    return id;
  }

  async settle(reservationId: string, actualUsd: number, usage?: BudgetUsage): Promise<void> {
    validateAmount(actualUsd);
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.settled) return;
    const budget = this.budgets.get(reservation.key);
    if (!budget) throw new Error('[cost] budget reservation ledger entry missing');
    budget.reservedUsd = Math.max(0, budget.reservedUsd - reservation.estimatedUsd);
    budget.spentUsd += actualUsd;
    reservation.settled = true;
    reservation.actualUsd = actualUsd;
    if (usage) reservation.usage = usage;
  }

  async halt(key: string, reason: string): Promise<void> {
    validateKey(key);
    this.halts.set(key, validateHaltReason(reason));
  }

  async getHaltReason(key: string): Promise<string | null> {
    validateKey(key);
    return this.halts.get(key) ?? null;
  }

  async reapExpired(now = new Date()): Promise<number> {
    let count = 0;
    for (const [id, reservation] of this.reservations) {
      if (!reservation.settled && reservation.expiresAt <= now.getTime()) {
        await this.settle(id, 0);
        count += 1;
      }
    }
    return count;
  }
}

export class PostgresBudgetLedger implements BudgetLedger, BudgetHaltController {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[cost] budget ledger DSN is empty');
    this.sql = postgres(dsn, { max: 5, connect_timeout: 10, idle_timeout: 20 });
    this.ready = this.migrate();
  }

  private async q<T>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await (this.sql.unsafe as unknown as (q: string, v: unknown[]) => Promise<unknown>)(
      text,
      values,
    )) as T[];
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (q: string, v?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_llm_budget_ledger_migration'))");
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_llm_budgets (key text PRIMARY KEY, budget_usd numeric NULL, reserved_usd numeric NOT NULL DEFAULT 0, spent_usd numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now())',
      );
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_llm_budget_reservations (id uuid PRIMARY KEY, budget_key text NOT NULL REFERENCES aqa_llm_budgets(key), estimated_usd numeric NOT NULL, actual_usd numeric NULL, model text NULL, tokens_in bigint NULL, tokens_out bigint NULL, pricing_version text NULL, pricing_sha256 text NULL, settled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())',
      );
      await query(
        'ALTER TABLE aqa_llm_budget_reservations ADD COLUMN IF NOT EXISTS actual_usd numeric NULL, ADD COLUMN IF NOT EXISTS model text NULL, ADD COLUMN IF NOT EXISTS tokens_in bigint NULL, ADD COLUMN IF NOT EXISTS tokens_out bigint NULL, ADD COLUMN IF NOT EXISTS pricing_version text NULL, ADD COLUMN IF NOT EXISTS pricing_sha256 text NULL',
      );
      await query(
        "ALTER TABLE aqa_llm_budget_reservations ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')",
      );
      await query(
        'CREATE TABLE IF NOT EXISTS aqa_llm_budget_halts (budget_key text PRIMARY KEY, reason text NOT NULL, halted_at timestamptz NOT NULL DEFAULT now())',
      );
    });
  }

  async reserve(
    key: string,
    budgetUsd: number | null,
    estimatedUsd: number,
    ttlMs = 300_000,
  ): Promise<string> {
    validateKey(key);
    validateAmount(estimatedUsd);
    validateTtl(ttlMs);
    await this.ready;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (q: string, v?: unknown[]) => Promise<unknown>;
      const haltRows = (await query(
        'SELECT reason FROM aqa_llm_budget_halts WHERE budget_key = $1',
        [key],
      )) as Array<{ reason: string }>;
      if (haltRows[0]) throw new BudgetDispatchBlockedError(`halted: ${haltRows[0].reason}`);
      const rows = (await query(
        'INSERT INTO aqa_llm_budgets (key, budget_usd) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET updated_at = now() RETURNING key',
        [key, budgetUsd],
      )) as Array<{ key: string }>;
      if (!rows[0]) throw new Error('[cost] budget ledger initialization failed');
      const current = (await query(
        'SELECT budget_usd::float8 AS budget_usd, reserved_usd::float8 AS reserved_usd, spent_usd::float8 AS spent_usd FROM aqa_llm_budgets WHERE key = $1 FOR UPDATE',
        [key],
      )) as Array<{ budget_usd: number | null; reserved_usd: number; spent_usd: number }>;
      const row = current[0];
      if (!row) throw new Error('[cost] budget ledger row missing');
      if (row.budget_usd !== budgetUsd)
        throw new Error('[cost] budget configuration changed for active ledger key');
      if (
        row.budget_usd !== null &&
        row.spent_usd + row.reserved_usd + estimatedUsd >= row.budget_usd
      )
        throw new BudgetDispatchBlockedError('distributed budget exhausted');
      const id = randomUUID();
      await query(
        'UPDATE aqa_llm_budgets SET reserved_usd = reserved_usd + $2, updated_at = now() WHERE key = $1',
        [key, estimatedUsd],
      );
      await query(
        "INSERT INTO aqa_llm_budget_reservations (id, budget_key, estimated_usd, expires_at) VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))",
        [id, key, estimatedUsd, ttlMs],
      );
      return id;
    });
  }

  async reapExpired(now = new Date()): Promise<number> {
    await this.ready;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (q: string, v?: unknown[]) => Promise<unknown>;
      const rows = (await query(
        'SELECT id, budget_key, estimated_usd::float8 AS estimated_usd FROM aqa_llm_budget_reservations WHERE settled = false AND expires_at <= $1 FOR UPDATE SKIP LOCKED',
        [now.toISOString()],
      )) as Array<{ id: string; budget_key: string; estimated_usd: number }>;
      for (const row of rows) {
        await query(
          'UPDATE aqa_llm_budgets SET reserved_usd = GREATEST(0, reserved_usd - $2), updated_at = now() WHERE key = $1',
          [row.budget_key, row.estimated_usd],
        );
        await query('UPDATE aqa_llm_budget_reservations SET settled = true WHERE id = $1', [
          row.id,
        ]);
      }
      return rows.length;
    });
  }

  async halt(key: string, reason: string): Promise<void> {
    validateKey(key);
    const normalized = validateHaltReason(reason);
    await this.ready;
    await this.q(
      'INSERT INTO aqa_llm_budget_halts (budget_key, reason) VALUES ($1, $2) ON CONFLICT (budget_key) DO UPDATE SET reason = EXCLUDED.reason, halted_at = now()',
      [key, normalized],
    );
  }

  async getHaltReason(key: string): Promise<string | null> {
    validateKey(key);
    await this.ready;
    const rows = await this.q<{ reason: string }>(
      'SELECT reason FROM aqa_llm_budget_halts WHERE budget_key = $1',
      [key],
    );
    return rows[0]?.reason ?? null;
  }

  async settle(reservationId: string, actualUsd: number, usage?: BudgetUsage): Promise<void> {
    validateAmount(actualUsd);
    await this.ready;
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (q: string, v?: unknown[]) => Promise<unknown>;
      const rows = (await query(
        'SELECT budget_key, estimated_usd::float8 AS estimated_usd FROM aqa_llm_budget_reservations WHERE id = $1 AND settled = false FOR UPDATE',
        [reservationId],
      )) as Array<{ budget_key: string; estimated_usd: number }>;
      const row = rows[0];
      if (!row) return;
      await query(
        'UPDATE aqa_llm_budgets SET reserved_usd = GREATEST(0, reserved_usd - $2), spent_usd = spent_usd + $3, updated_at = now() WHERE key = $1',
        [row.budget_key, row.estimated_usd, actualUsd],
      );
      await query(
        'UPDATE aqa_llm_budget_reservations SET settled = true, actual_usd = $2, model = $3, tokens_in = $4, tokens_out = $5, pricing_version = $6, pricing_sha256 = $7 WHERE id = $1',
        [
          reservationId,
          actualUsd,
          usage?.model ?? null,
          usage?.tokens_in ?? null,
          usage?.tokens_out ?? null,
          usage?.pricing_version ?? null,
          usage?.pricing_sha256 ?? null,
        ],
      );
    });
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }
}

function validateAmount(value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error('[cost] ledger amount must be finite and non-negative');
}

function validateTtl(value: number): void {
  if (!Number.isInteger(value) || value < 1)
    throw new Error('[cost] ledger ttl must be a positive integer');
}

function validateKey(value: string): void {
  if (!value.trim() || value.length > 256) throw new Error('[cost] ledger key is invalid');
}

function validateHaltReason(value: string): string {
  const normalized = value.trim().slice(0, 200);
  if (!normalized) throw new Error('[cost] halt reason is required');
  return normalized;
}
