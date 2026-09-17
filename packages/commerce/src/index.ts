import { z } from 'zod';

/** Decimal minor units are strings so no binary floating point enters money math. */
export const Money = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO-4217 code'),
  amount_minor: z.string().regex(/^(0|[1-9]\d*)$/, 'amount_minor must be a non-negative integer'),
});
export type Money = z.infer<typeof Money>;

export const CommerceContext = z.object({
  schema_version: z.literal('1'),
  merchant: z.string().min(1),
  environment: z.enum(['sandbox', 'staging', 'production']),
  tenant: z.string().min(1),
  run_id: z.string().min(1),
  policy_revision: z.string().min(1),
  capabilities: z.record(z.boolean()).default({}),
});
export type CommerceContext = z.infer<typeof CommerceContext>;

export const OrderLine = z.object({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: Money,
  line_total: Money,
});
export type OrderLine = z.infer<typeof OrderLine>;

export const OrderSnapshot = z.object({
  schema_version: z.literal('1'),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  tenant: z.string().min(1),
  lines: z.array(OrderLine),
  subtotal: Money,
  tax: Money,
  discount: Money,
  total: Money,
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(['pending', 'authorized', 'paid', 'fulfilled', 'cancelled', 'refunded']),
});
export type OrderSnapshot = z.infer<typeof OrderSnapshot>;

export const PaymentSnapshot = z.object({
  schema_version: z.literal('1'),
  order_id: z.string().min(1),
  provider: z.string().min(1),
  payment_id: z.string().min(1),
  amount: Money,
  status: z.enum(['pending', 'authorized', 'captured', 'partially_refunded', 'refunded', 'failed']),
  observed_at: z.string().datetime({ offset: true }),
});
export type PaymentSnapshot = z.infer<typeof PaymentSnapshot>;

export const InventorySnapshot = z.object({
  schema_version: z.literal('1'),
  sku: z.string().min(1),
  location: z.string().min(1),
  on_hand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  backorder_allowed: z.boolean(),
});
export type InventorySnapshot = z.infer<typeof InventorySnapshot>;

export const JourneyOutcome = z.object({
  status: z.enum(['pass', 'fail', 'error', 'inconclusive', 'blocked', 'unsupported']),
  evidence_complete: z.boolean(),
  reason: z.string().min(1),
});
export type JourneyOutcome = z.infer<typeof JourneyOutcome>;

export function assertSameCurrency(...money: Money[]): string {
  const currency = money[0]?.currency;
  if (!currency || money.some((item) => item.currency !== currency)) {
    throw new Error('cross-currency arithmetic requires an explicit FX operation');
  }
  return currency;
}

export function assertNoOversell(snapshot: InventorySnapshot): void {
  if (!snapshot.backorder_allowed && snapshot.reserved + snapshot.committed > snapshot.on_hand) {
    throw new Error(`inventory oversell: ${snapshot.sku} exceeds on_hand`);
  }
}
