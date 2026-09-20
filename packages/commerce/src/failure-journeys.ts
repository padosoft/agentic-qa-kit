import { createHmac } from 'node:crypto';
import { CommerceToolPolicy, type HumanCommerceApproval } from './agent-security.js';
import type { CommerceIdentity, InMemoryCommerceReference } from './index.js';
import { CommerceMutationGate } from './mutation-gate.js';
import { StripeWebhookProcessor } from './stripe-webhook-processor.js';
import { InMemoryWebhookEffectLedger } from './webhook-ledger.js';

export type CommerceFailureJourneyEvidence = {
  scenario: 'inventory_idempotency_race' | 'webhook_replay' | 'unknown_outcome';
  status: 'pass' | 'fail';
  detail: string;
};

export type CommerceFailureJourneyResult = {
  status: 'pass' | 'fail';
  evidence: readonly CommerceFailureJourneyEvidence[];
  boundary: 'in_memory_reference_only';
};

/**
 * Exercise the high-risk ecommerce failure semantics against the deterministic
 * merchant reference. This is a complete local journey, not provider proof:
 * it intentionally makes ambiguity and duplicate delivery observable.
 */
export async function verifyCommerceFailureJourneys(
  merchant: InMemoryCommerceReference,
): Promise<CommerceFailureJourneyResult> {
  const evidence: CommerceFailureJourneyEvidence[] = [];
  await runScenario(evidence, 'inventory_idempotency_race', async () => {
    const product = {
      sku: 'failure-sku',
      price: { currency: 'EUR', amount_minor: '1000' },
      on_hand: 1,
    } as const;
    merchant.seedProduct(product);
    const first: CommerceIdentity = { tenant: 'failure-shop', customer_id: 'customer-a' };
    const second: CommerceIdentity = { tenant: 'failure-shop', customer_id: 'customer-b' };
    const firstCart = merchant.addLine(first, merchant.createCart(first).id, product.sku, 1);
    const secondCart = merchant.addLine(second, merchant.createCart(second).id, product.sku, 1);
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => merchant.checkout(first, firstCart.id, 'race-a')),
      Promise.resolve().then(() => merchant.checkout(second, secondCart.id, 'race-b')),
    ]);
    if (outcomes.filter((item) => item.status === 'fulfilled').length !== 1)
      throw new Error('inventory race did not produce exactly one winner');
    if (outcomes.filter((item) => item.status === 'rejected').length !== 1)
      throw new Error('inventory race did not reject the losing checkout');
    const winner = outcomes.find((item) => item.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('race winner missing');
    const retried = merchant.checkout(first, firstCart.id, 'race-a');
    if (JSON.stringify(retried) !== JSON.stringify(winner.value))
      throw new Error('idempotent retry returned a different checkout result');
    if (merchant.getInventory(product.sku).committed !== 1)
      throw new Error('inventory committed more than once');
    return 'one checkout committed; loser rejected; retry returned the same result';
  });

  await runScenario(evidence, 'webhook_replay', async () => {
    const ledger = new InMemoryWebhookEffectLedger();
    const processor = new StripeWebhookProcessor({
      endpointSecret: 'local_failure_journey_secret',
      ledger,
      now_ms: 1_700_000_000_000,
    });
    const body = JSON.stringify({
      id: 'evt_failure_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_failure_1', metadata: { order_id: 'order-failure-1' } } },
    });
    const signature = sign(body, 'local_failure_journey_secret');
    let effects = 0;
    const first = await processor.process(body, signature, () => {
      effects += 1;
    });
    const duplicate = await processor.process(body, signature, () => {
      effects += 1;
    });
    const conflictBody = body
      .replace('evt_failure_1', 'evt_failure_2')
      .replace('pi_failure_1', 'pi_failure_2');
    const conflict = await processor.process(
      conflictBody,
      sign(conflictBody, 'local_failure_journey_secret'),
      () => {
        effects += 1;
      },
    );
    if (
      first.status !== 'applied' ||
      duplicate.status !== 'duplicate' ||
      conflict.status !== 'rejected' ||
      effects !== 1
    )
      throw new Error('webhook replay was not deduplicated');
    return 'first delivery applied once; duplicate ignored; conflicting event rejected';
  });

  await runScenario(evidence, 'unknown_outcome', async () => {
    const now = new Date('2026-09-20T10:00:00.000Z');
    const policy = new CommerceToolPolicy({ read_tools: ['commerce.checkout'], now: () => now });
    const gate = new CommerceMutationGate(policy);
    const call = {
      schema_version: '1' as const,
      id: 'call-failure-1',
      tenant: 'failure-shop',
      customer_id: 'customer-a',
      tool: 'commerce.checkout',
      operation: 'financial' as const,
      target: { tenant: 'failure-shop', customer_id: 'customer-a' },
      cart_revision: 0,
      total: { currency: 'EUR', amount_minor: '1000' },
      requested_at: now.toISOString(),
    };
    const approval: HumanCommerceApproval = {
      schema_version: '1',
      approval_id: 'approval-failure-1',
      call_id: call.id,
      tenant: call.tenant,
      customer_id: call.customer_id,
      cart_revision: 0,
      total: call.total,
      approved_by: 'local-operator',
      source: 'human',
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
    };
    const result = await gate.execute(call, approval, async () => ({
      status: 'unknown' as const,
      reason: 'injected transport timeout after provider write boundary',
    }));
    if (result.status !== 'unknown') throw new Error('ambiguous mutation did not remain unknown');
    return 'transport ambiguity remained unknown and requires reconciliation';
  });

  return {
    status: evidence.every((item) => item.status === 'pass') ? 'pass' : 'fail',
    evidence,
    boundary: 'in_memory_reference_only',
  };
}

async function runScenario(
  evidence: CommerceFailureJourneyEvidence[],
  scenario: CommerceFailureJourneyEvidence['scenario'],
  run: () => string | Promise<string>,
): Promise<void> {
  try {
    evidence.push({ scenario, status: 'pass', detail: await run() });
  } catch (error) {
    evidence.push({
      scenario,
      status: 'fail',
      detail: error instanceof Error ? error.message : 'failure journey failed',
    });
  }
}

function sign(body: string, secret: string): string {
  const timestamp = 1_700_000_000;
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
