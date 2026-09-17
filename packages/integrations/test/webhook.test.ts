import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryWebhookQueue,
  PostgresWebhookQueue,
  WebhookDestinationPolicy,
  type WebhookTransport,
  signWebhook,
} from '../dist/index.js';

const request = (id: string) => ({
  id,
  org: 'acme',
  integration: 'pagerduty',
  url: 'https://example.test/hook',
  payload: { event: 'finding.created' },
  secret: 'test-secret',
});

describe('outbound webhooks', () => {
  it('signs the exact body and delivers idempotently', async () => {
    const queue = new MemoryWebhookQueue();
    queue.enqueue(request('d-1'), 0);
    let seen = 0;
    const transport: WebhookTransport = {
      send: async ({ body, headers }) => {
        seen += 1;
        assert.equal(headers['x-aqa-signature'], signWebhook(body, 'test-secret'));
        assert.equal(headers['x-aqa-delivery-id'], 'd-1');
        return { status: 204 };
      },
    };
    assert.deepEqual(await queue.deliverDue(transport, 0), [{ id: 'd-1', state: 'delivered' }]);
    assert.equal(seen, 1);
    assert.equal(queue.pendingCount(), 0);
    assert.deepEqual(await queue.deliverDue(transport, 1), []);
  });

  it('retries with a bounded schedule and moves poison deliveries to DLQ', async () => {
    const queue = new MemoryWebhookQueue();
    queue.enqueue(request('d-2'), 0);
    const transport: WebhookTransport = {
      send: async () => ({ status: 503, retry_after_ms: 500 }),
    };
    for (const now of [0, 1_000, 3_000, 7_000, 15_000]) {
      await queue.deliverDue(transport, now);
    }
    assert.equal(queue.pendingCount(), 0);
    assert.equal(queue.deadLetters()[0]?.id, 'd-2');
  });

  it('does not flood one integration and rejects unsafe requests', async () => {
    const queue = new MemoryWebhookQueue();
    queue.enqueue(request('d-3'), 0);
    queue.enqueue(request('d-4'), 0);
    const transport: WebhookTransport = { send: async () => ({ status: 204 }) };
    assert.deepEqual(await queue.deliverDue(transport, 0, 1_000), [
      { id: 'd-3', state: 'delivered' },
      { id: 'd-4', state: 'rate_limited' },
    ]);
    assert.throws(
      () => queue.enqueue({ ...request('bad'), url: 'file:///secret' }, 0),
      /http or https/,
    );
    const policy = new WebhookDestinationPolicy(['https://hooks.example.test']);
    policy.assertAllowed('https://hooks.example.test/events');
    assert.throws(
      () => policy.assertAllowed('https://other.example.test/events'),
      /not allowlisted/,
    );
    assert.throws(() => new WebhookDestinationPolicy(['http://hooks.example.test']), /HTTPS/);
  });

  it('persists, claims and removes a delivery against PostgreSQL when configured', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the durable webhook contract');
      return;
    }
    const id = `pg-${Date.now()}`;
    const queue = new PostgresWebhookQueue(
      dsn,
      { resolve: async () => 'test-secret' },
      new WebhookDestinationPolicy(['https://example.test']),
    );
    const transport: WebhookTransport = {
      send: async ({ headers }) => {
        assert.equal(headers['x-aqa-delivery-id'], id);
        return { status: 204 };
      },
    };
    try {
      await queue.enqueue({ ...request(id), secret_ref: 'test/webhook' });
      assert.deepEqual(await queue.deliverDue(transport), [{ id, state: 'delivered' }]);
    } finally {
      await queue.close();
    }
  });
});
