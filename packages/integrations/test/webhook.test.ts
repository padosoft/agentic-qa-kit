import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HttpWebhookTransport,
  MemoryWebhookQueue,
  PostgresWebhookQueue,
  VaultSecretResolver,
  WebhookDestinationPolicy,
  type WebhookTransport,
  signWebhook,
} from '../dist/index.js';
import { renderIntegrationPayload } from '../dist/index.js';

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
    const audit: string[] = [];
    const queue = new PostgresWebhookQueue(
      dsn,
      { resolve: async () => 'test-secret' },
      new WebhookDestinationPolicy(['https://example.test']),
      async (event) => {
        audit.push(`${event.kind}:${event.outcome ?? 'started'}:${event.delivery_id}`);
      },
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
      assert.deepEqual(audit, [`attempt:started:${id}`, `outcome:delivered:${id}`]);
    } finally {
      await queue.close();
    }
  });

  it('renders provider payloads without credentials', () => {
    const notification = {
      event: 'finding.created',
      title: 'Critical finding',
      text: 'Checkout authorization bypass detected',
      severity: 'critical' as const,
      finding_id: 'f-1',
      run_id: 'r-1',
    };
    for (const provider of ['slack', 'teams', 'jira', 'pagerduty'] as const) {
      const payload = renderIntegrationPayload(provider, notification);
      assert.equal(JSON.stringify(payload).includes('routing_key'), false);
      assert.equal(JSON.stringify(payload).includes('secret'), false);
    }
    assert.equal(
      (renderIntegrationPayload('pagerduty', notification) as { event_action: string })
        .event_action,
      'trigger',
    );
    assert.throws(
      () => renderIntegrationPayload('slack', { ...notification, title: '' }),
      /required/,
    );
  });

  it('uses a bounded, no-redirect HTTP transport and parses retry-after', async () => {
    const calls: RequestInit[] = [];
    const transport = new HttpWebhookTransport({
      destinationPolicy: new WebhookDestinationPolicy(['https://hooks.example.test']),
      fetcher: async (_url, init) => {
        calls.push(init);
        return new Response('queued', { status: 429, headers: { 'retry-after': '2' } });
      },
    });
    assert.deepEqual(
      await transport.send({ url: 'https://hooks.example.test/hook', body: '{}', headers: {} }),
      {
        status: 429,
        retry_after_ms: 2_000,
      },
    );
    assert.equal(calls[0]?.redirect, 'error');
    assert.throws(
      () =>
        new HttpWebhookTransport({
          destinationPolicy: new WebhookDestinationPolicy(['https://hooks.example.test']),
          timeout_ms: 0,
        }),
      /timeout_ms/,
    );
    const bounded = new HttpWebhookTransport({
      destinationPolicy: new WebhookDestinationPolicy(['https://hooks.example.test']),
      max_response_bytes: 1_000,
      fetcher: async () => new Response('x'.repeat(1_001), { status: 200 }),
    });
    await assert.rejects(
      () => bounded.send({ url: 'https://hooks.example.test/hook', body: '{}', headers: {} }),
      /response exceeds configured limit/,
    );
  });

  it('resolves Vault KV-v2 secrets without exposing token or response diagnostics', async () => {
    let requested = '';
    let requestHeaders: HeadersInit | undefined;
    const resolver = new VaultSecretResolver({
      endpoint: 'https://vault.example.test/',
      mount: 'secret',
      token: async () => 'vault-token-only-in-memory',
      fetcher: async (url, init) => {
        requested = String(url);
        requestHeaders = init?.headers;
        return new Response(JSON.stringify({ data: { data: { value: 'webhook-secret' } } }), {
          status: 200,
        });
      },
    });
    assert.equal(await resolver.resolve('integrations/pagerduty'), 'webhook-secret');
    assert.equal(requested, 'https://vault.example.test/v1/secret/data/integrations/pagerduty');
    assert.equal(
      (requestHeaders as Record<string, string>)['x-vault-token'],
      'vault-token-only-in-memory',
    );
    assert.throws(
      () =>
        new VaultSecretResolver({ endpoint: 'http://vault.example.test', token: async () => 'x' }),
      /HTTPS/,
    );
  });
});
