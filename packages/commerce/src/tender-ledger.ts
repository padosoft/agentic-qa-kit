import postgres from 'postgres';
import type { Sql } from 'postgres';
import { Money, type Money as MoneyValue } from './index.js';

export type GiftCardCreditResult = 'credited' | 'duplicate' | 'conflict';
export type GiftCardRedeemResult = 'redeemed' | 'duplicate' | 'conflict' | 'insufficient_funds';

export type GiftCardBalance = {
  tenant: string;
  gift_card_id: string;
  balance: MoneyValue;
};

export interface GiftCardLedger {
  credit(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardCreditResult>;
  redeem(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardRedeemResult>;
  balance(tenant: string, giftCardId: string): Promise<GiftCardBalance | null>;
  close?(): Promise<void>;
}

type Entry = {
  operation_id: string;
  tenant: string;
  gift_card_id: string;
  currency: string;
  amount_minor: bigint;
  kind: 'credit' | 'redeem';
};

/** Deterministic ledger for contract tests; production must use a durable implementation. */
export class InMemoryGiftCardLedger implements GiftCardLedger {
  private readonly entries = new Map<string, Entry>();

  async credit(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardCreditResult> {
    const entry = validateEntry(tenant, giftCardId, operationId, amount, 'credit');
    this.currentBalance(entry.tenant, entry.gift_card_id, entry.currency);
    const prior = this.entries.get(operationKey(entry));
    if (prior) return sameEntry(prior, entry) ? 'duplicate' : 'conflict';
    this.entries.set(operationKey(entry), entry);
    return 'credited';
  }

  async redeem(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardRedeemResult> {
    const entry = validateEntry(tenant, giftCardId, operationId, amount, 'redeem');
    const prior = this.entries.get(operationKey(entry));
    if (prior) return sameEntry(prior, entry) ? 'duplicate' : 'conflict';
    if (this.currentBalance(entry.tenant, entry.gift_card_id, entry.currency) < entry.amount_minor)
      return 'insufficient_funds';
    this.entries.set(operationKey(entry), entry);
    return 'redeemed';
  }

  async balance(tenant: string, giftCardId: string): Promise<GiftCardBalance | null> {
    validateIdentity(tenant, giftCardId, 'balance');
    const entries = [...this.entries.values()].filter(
      (entry) => entry.tenant === tenant && entry.gift_card_id === giftCardId,
    );
    if (entries.length === 0) return null;
    const currency = entries[0]?.currency;
    if (!currency) return null;
    return {
      tenant,
      gift_card_id: giftCardId,
      balance: {
        currency,
        amount_minor: this.currentBalance(tenant, giftCardId, currency).toString(),
      },
    };
  }

  private currentBalance(tenant: string, giftCardId: string, currency: string): bigint {
    let total = 0n;
    for (const entry of this.entries.values()) {
      if (entry.tenant !== tenant || entry.gift_card_id !== giftCardId) continue;
      if (entry.currency !== currency) throw new Error('[commerce/gift-card] currency conflict');
      total += entry.kind === 'credit' ? entry.amount_minor : -entry.amount_minor;
    }
    return total;
  }
}

/** PostgreSQL ledger with transaction-scoped advisory locking per tenant/card. */
export class PostgresGiftCardLedger implements GiftCardLedger {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(dsn: string) {
    if (!dsn.trim()) throw new Error('[commerce/gift-card] DSN is empty');
    this.sql = postgres(dsn, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    this.ready = this.migrate();
  }

  async credit(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardCreditResult> {
    const entry = validateEntry(tenant, giftCardId, operationId, amount, 'credit');
    await this.ready;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await lockCard(query, entry);
      const prior = await findOperation(query, entry);
      if (prior) return sameEntry(prior, entry) ? 'duplicate' : 'conflict';
      const existing = (await query(
        'SELECT min(currency) AS currency FROM aqa_commerce_gift_card_entries WHERE tenant = $1 AND gift_card_id = $2',
        [entry.tenant, entry.gift_card_id],
      )) as Array<{ currency: string | null }>;
      if (existing[0]?.currency && existing[0].currency !== entry.currency)
        throw new Error('[commerce/gift-card] currency conflict');
      await insertEntry(query, entry);
      return 'credited';
    });
  }

  async redeem(
    tenant: string,
    giftCardId: string,
    operationId: string,
    amount: MoneyValue,
  ): Promise<GiftCardRedeemResult> {
    const entry = validateEntry(tenant, giftCardId, operationId, amount, 'redeem');
    await this.ready;
    return this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await lockCard(query, entry);
      const prior = await findOperation(query, entry);
      if (prior) return sameEntry(prior, entry) ? 'duplicate' : 'conflict';
      const rows = (await query(
        `SELECT COALESCE(sum(CASE WHEN kind = 'credit' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance,
                min(currency) AS currency
           FROM aqa_commerce_gift_card_entries
          WHERE tenant = $1 AND gift_card_id = $2`,
        [entry.tenant, entry.gift_card_id],
      )) as Array<{ balance: string; currency: string | null }>;
      const balance = BigInt(rows[0]?.balance ?? '0');
      if (rows[0]?.currency && rows[0].currency !== entry.currency)
        throw new Error('[commerce/gift-card] currency conflict');
      if (balance < entry.amount_minor) return 'insufficient_funds';
      await insertEntry(query, entry);
      return 'redeemed';
    });
  }

  async balance(tenant: string, giftCardId: string): Promise<GiftCardBalance | null> {
    validateIdentity(tenant, giftCardId, 'balance');
    await this.ready;
    const rows = (await this.sql.unsafe(
      `SELECT min(currency) AS currency,
              COALESCE(sum(CASE WHEN kind = 'credit' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance,
              count(*)::int AS entries
         FROM aqa_commerce_gift_card_entries
        WHERE tenant = $1 AND gift_card_id = $2`,
      [tenant, giftCardId],
    )) as Array<{ currency: string | null; balance: string; entries: number }>;
    const row = rows[0];
    if (!row || row.entries === 0 || !row.currency) return null;
    return {
      tenant,
      gift_card_id: giftCardId,
      balance: { currency: row.currency, amount_minor: row.balance },
    };
  }

  private async migrate(): Promise<void> {
    await this.sql.begin(async (tx) => {
      const query = tx.unsafe as unknown as (text: string, values?: unknown[]) => Promise<unknown>;
      await query("SELECT pg_advisory_xact_lock(hashtext('aqa_commerce_gift_card_schema'))");
      await query(
        `CREATE TABLE IF NOT EXISTS aqa_commerce_gift_card_entries (
          entry_id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          operation_id text NOT NULL,
          tenant text NOT NULL,
          gift_card_id text NOT NULL,
          currency char(3) NOT NULL,
          amount_minor numeric(30, 0) NOT NULL CHECK (amount_minor > 0),
          kind text NOT NULL CHECK (kind IN ('credit', 'redeem')),
          created_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await query(
        'ALTER TABLE aqa_commerce_gift_card_entries ADD COLUMN IF NOT EXISTS entry_id bigint GENERATED BY DEFAULT AS IDENTITY',
      );
      await query(
        'ALTER TABLE aqa_commerce_gift_card_entries DROP CONSTRAINT IF EXISTS aqa_commerce_gift_card_entries_pkey',
      );
      await query(
        'ALTER TABLE aqa_commerce_gift_card_entries DROP CONSTRAINT IF EXISTS aqa_commerce_gift_card_entries_entry_pkey',
      );
      await query(
        'ALTER TABLE aqa_commerce_gift_card_entries ADD CONSTRAINT aqa_commerce_gift_card_entries_entry_pkey PRIMARY KEY (entry_id)',
      );
      await query(
        'CREATE UNIQUE INDEX IF NOT EXISTS aqa_commerce_gift_card_operation_scope_idx ON aqa_commerce_gift_card_entries (tenant, gift_card_id, operation_id)',
      );
      await query(
        'CREATE INDEX IF NOT EXISTS aqa_commerce_gift_card_balance_idx ON aqa_commerce_gift_card_entries (tenant, gift_card_id)',
      );
    });
  }

  async close(): Promise<void> {
    await this.ready;
    await this.sql.end({ timeout: 5 });
  }
}

function validateEntry(
  tenant: string,
  giftCardId: string,
  operationId: string,
  amount: MoneyValue,
  kind: Entry['kind'],
): Entry {
  validateIdentity(tenant, giftCardId, operationId);
  if (!operationId.trim()) throw new Error('[commerce/gift-card] operation id is required');
  const parsed = Money.parse(amount);
  const amountMinor = BigInt(parsed.amount_minor);
  if (amountMinor <= 0n) throw new Error('[commerce/gift-card] amount must be positive');
  return {
    operation_id: operationId,
    tenant,
    gift_card_id: giftCardId,
    currency: parsed.currency,
    amount_minor: amountMinor,
    kind,
  };
}

function validateIdentity(tenant: string, giftCardId: string, operationId: string): void {
  if (!tenant.trim() || !giftCardId.trim() || !operationId.trim())
    throw new Error('[commerce/gift-card] tenant, gift card id and operation id are required');
}

function sameEntry(left: Entry, right: Entry): boolean {
  return (
    left.tenant === right.tenant &&
    left.gift_card_id === right.gift_card_id &&
    left.currency === right.currency &&
    left.amount_minor === right.amount_minor &&
    left.kind === right.kind
  );
}

function operationKey(entry: Pick<Entry, 'tenant' | 'gift_card_id' | 'operation_id'>): string {
  return `${entry.tenant}\u0000${entry.gift_card_id}\u0000${entry.operation_id}`;
}

async function lockCard(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
  entry: Entry,
): Promise<void> {
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${entry.tenant}\u0000${entry.gift_card_id}`,
  ]);
}

async function findOperation(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
  entry: Pick<Entry, 'tenant' | 'gift_card_id' | 'operation_id'>,
): Promise<Entry | null> {
  const rows = (await query(
    'SELECT tenant, gift_card_id, currency, amount_minor::text AS amount_minor, kind FROM aqa_commerce_gift_card_entries WHERE tenant = $1 AND gift_card_id = $2 AND operation_id = $3',
    [entry.tenant, entry.gift_card_id, entry.operation_id],
  )) as Array<{
    tenant: string;
    gift_card_id: string;
    currency: string;
    amount_minor: string;
    kind: Entry['kind'];
  }>;
  const row = rows[0];
  return row
    ? {
        operation_id: entry.operation_id,
        tenant: row.tenant,
        gift_card_id: row.gift_card_id,
        currency: row.currency,
        amount_minor: BigInt(row.amount_minor),
        kind: row.kind,
      }
    : null;
}

async function insertEntry(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
  entry: Entry,
): Promise<void> {
  await query(
    'INSERT INTO aqa_commerce_gift_card_entries (operation_id, tenant, gift_card_id, currency, amount_minor, kind) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      entry.operation_id,
      entry.tenant,
      entry.gift_card_id,
      entry.currency,
      entry.amount_minor.toString(),
      entry.kind,
    ],
  );
}
