import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { InMemoryWebhookEffectLedger, StripeWebhookProcessor } from '../dist/index.js';

describe('StripeWebhookProcessor', () => {
  it('verifies, applies once and rejects a conflicting event for the same business effect', async () => {
    const ledger = new InMemoryWebhookEffectLedger();
    const processor = new StripeWebhookProcessor({
      endpointSecret: 'whsec_test',
      ledger,
      now_ms: 1_700_000_000_000,
    });
    const firstBody = eventBody('evt_1', 'payment_intent.succeeded', 'pi_1');
    const first = await processor.process(firstBody, signature(firstBody), async () => undefined);
    assert.equal(first.status, 'applied');
    const duplicate = await processor.process(firstBody, signature(firstBody), async () => {
      throw new Error('duplicate effect must not run');
    });
    assert.equal(duplicate.status, 'duplicate');
    const conflictBody = eventBody('evt_2', 'payment_intent.succeeded', 'pi_2');
    const conflict = await processor.process(
      conflictBody,
      signature(conflictBody),
      async () => undefined,
    );
    assert.deepEqual(conflict, {
      status: 'rejected',
      reason: 'effect_conflict',
      event_id: 'evt_2',
    });
  });

  it('releases a failed claim so the provider retry can apply the effect', async () => {
    const ledger = new InMemoryWebhookEffectLedger();
    const processor = new StripeWebhookProcessor({
      endpointSecret: 'whsec_test',
      ledger,
      now_ms: 1_700_000_000_000,
    });
    const body = eventBody('evt_retry', 'payment_intent.payment_failed', 'pi_retry');
    const failed = await processor.process(body, signature(body), async () => {
      throw new Error('merchant temporarily unavailable');
    });
    assert.deepEqual(failed, {
      status: 'rejected',
      reason: 'effect_failed',
      event_id: 'evt_retry',
    });
    let applied = 0;
    const retried = await processor.process(body, signature(body), async () => {
      applied += 1;
    });
    assert.equal(retried.status, 'applied');
    assert.equal(applied, 1);
  });

  it('rejects stale or malformed events and reports unsupported provider types explicitly', async () => {
    const processor = new StripeWebhookProcessor({
      endpointSecret: 'whsec_test',
      ledger: new InMemoryWebhookEffectLedger(),
      now_ms: 1_700_000_000_000,
    });
    const body = eventBody('evt_3', 'charge.refunded', 're_1', 'pi_1');
    assert.deepEqual(await processor.process(body, 't=1,v1=bad', async () => undefined), {
      status: 'rejected',
      reason: 'stale',
    });
    const unsupported = eventBody('evt_4', 'customer.created', 'cus_1');
    const result = await processor.process(
      unsupported,
      signature(unsupported),
      async () => undefined,
    );
    assert.deepEqual(result, {
      status: 'unsupported',
      reason: 'customer.created',
      event_id: 'evt_4',
    });
  });

  function signature(body: string): string {
    const timestamp = 1_700_000_000;
    return `t=${timestamp},v1=${createHmac('sha256', 'whsec_test').update(`${timestamp}.${body}`).digest('hex')}`;
  }
});

function eventBody(id: string, type: string, objectId: string, paymentIntent?: string): string {
  return JSON.stringify({
    id,
    type,
    data: {
      object: {
        id: objectId,
        ...(paymentIntent ? { payment_intent: paymentIntent } : {}),
        metadata: { order_id: 'order-1' },
      },
    },
  });
}
