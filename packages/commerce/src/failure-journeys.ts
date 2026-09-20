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
    const race = new AsyncInventoryRaceModel(1);
    const outcomes = await Promise.allSettled([race.checkout('race-a'), race.checkout('race-b')]);
    if (outcomes.filter((item) => item.status === 'fulfilled').length !== 1)
      throw new Error('inventory race did not produce exactly one winner');
    if (outcomes.filter((item) => item.status === 'rejected').length !== 1)
      throw new Error('inventory race did not reject the losing checkout');
    const winner = outcomes.find((item) => item.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('race winner missing');
    const retried = await race.checkout('race-a');
    if (JSON.stringify(retried) !== JSON.stringify(winner.value))
      throw new Error('idempotent retry returned a different checkout result');
    if (race.committed !== 1) throw new Error('inventory committed more than once');
    // Exercise the real reference boundary with two carts as well as the async
    // barrier model used to expose the check/commit overlap.
    const product = {
      sku: 'failure-race-sku',
      price: { currency: 'EUR', amount_minor: '1000' },
      on_hand: 1,
    } as const;
    merchant.seedProduct(product);
    const firstIdentity: CommerceIdentity = {
      tenant: 'failure-shop',
      customer_id: 'reference-customer-a',
    };
    const secondIdentity: CommerceIdentity = {
      tenant: 'failure-shop',
      customer_id: 'reference-customer-b',
    };
    const firstCart = merchant.addLine(
      firstIdentity,
      merchant.createCart(firstIdentity).id,
      product.sku,
      1,
    );
    const secondCart = merchant.addLine(
      secondIdentity,
      merchant.createCart(secondIdentity).id,
      product.sku,
      1,
    );
    const referenceOutcomes = await Promise.allSettled([
      Promise.resolve().then(() =>
        merchant.checkout(firstIdentity, firstCart.id, 'reference-race-a'),
      ),
      Promise.resolve().then(() =>
        merchant.checkout(secondIdentity, secondCart.id, 'reference-race-b'),
      ),
    ]);
    if (referenceOutcomes.filter((item) => item.status === 'fulfilled').length !== 1)
      throw new Error('reference inventory race did not produce exactly one winner');
    const first = merchant.checkout(firstIdentity, firstCart.id, 'reference-race-a');
    const referenceRetry = merchant.checkout(firstIdentity, firstCart.id, 'reference-race-a');
    if (JSON.stringify(first) !== JSON.stringify(referenceRetry))
      throw new Error('reference idempotent retry returned a different result');
    return 'async barrier produced one winner; loser rejected; reference retry was exactly once';
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
    let committed = false;
    const result = await gate.execute(call, approval, async () => {
      committed = true;
      throw new Error('injected transport timeout after provider write boundary');
    });
    if (result.status !== 'unknown') throw new Error('ambiguous mutation did not remain unknown');
    if (!committed) throw new Error('observable mutation did not occur before timeout');
    return 'observable mutation occurred; transport ambiguity remained unknown for reconciliation';
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

/** Local async double with a barrier between availability check and commit. */
class AsyncInventoryRaceModel {
  committed = 0;
  private checks = 0;
  private release!: () => void;
  private readonly barrier: Promise<void>;
  private readonly idempotency = new Map<string, { order: string }>();

  constructor(private readonly onHand: number) {
    this.barrier = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  async checkout(key: string): Promise<{ order: string }> {
    const previous = this.idempotency.get(key);
    if (previous) return previous;
    const hadStock = this.onHand - this.committed > 0;
    this.checks += 1;
    if (this.checks === 2) this.release();
    await this.barrier;
    if (!hadStock || this.committed >= this.onHand) throw new Error('insufficient inventory');
    this.committed += 1;
    const result = { order: `order-${key}` };
    this.idempotency.set(key, result);
    return result;
  }
}
