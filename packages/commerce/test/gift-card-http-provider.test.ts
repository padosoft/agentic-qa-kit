import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpGiftCardProvider } from '../dist/index.js';

const snapshot = JSON.stringify({
  schema_version: '1',
  provider: 'issuer-test',
  tenant: 'shop-a',
  gift_card_id: 'gift/1',
  status: 'active',
  balance: { currency: 'EUR', amount_minor: '750' },
  observed_at: '2026-09-18T12:00:00Z',
});

describe('HttpGiftCardProvider', () => {
  it('sends a tenant-bound GET and parses the bounded provider snapshot', async () => {
    let request: Request | undefined;
    const provider = new HttpGiftCardProvider({
      baseUrl: 'https://issuer.example.test',
      headers: () => ({ Authorization: 'Bearer test-token' }),
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(snapshot, { status: 200 });
      },
    });
    const observed = await provider.observeGiftCard('shop-a', 'gift/1');
    assert.equal(observed.gift_card_id, 'gift/1');
    assert.equal(request?.method, 'GET');
    assert.equal(request?.headers.get('X-AQA-Tenant'), 'shop-a');
    assert.equal(request?.headers.get('Authorization'), 'Bearer test-token');
    assert.equal(new URL(request?.url ?? '').pathname, '/gift-cards/gift%2F1');
  });

  it('rejects external plaintext HTTP and credential-bearing URLs', () => {
    assert.throws(
      () => new HttpGiftCardProvider({ baseUrl: 'http://issuer.example.test' }),
      /requires HTTPS/,
    );
    assert.throws(
      () => new HttpGiftCardProvider({ baseUrl: 'https://user:pass@issuer.example.test' }),
      /must not contain credentials/,
    );
  });

  it('allows loopback HTTP only when explicitly enabled', async () => {
    const provider = new HttpGiftCardProvider({
      baseUrl: 'http://127.0.0.1:8080',
      allowInsecureLocalHttp: true,
      fetch: async () => new Response(snapshot, { status: 200 }),
    });
    assert.equal((await provider.observeGiftCard('shop-a', 'gift/1')).status, 'active');
  });

  it('fails closed on oversized, redirected or malformed provider responses', async () => {
    const redirected = new HttpGiftCardProvider({
      baseUrl: 'https://issuer.example.test',
      fetch: async () =>
        new Response('', { status: 302, headers: { Location: 'https://evil.test' } }),
    });
    await assert.rejects(() => redirected.observeGiftCard('shop-a', 'gift-1'), /HTTP 302/);

    const oversized = new HttpGiftCardProvider({
      baseUrl: 'https://issuer.example.test',
      maxResponseBytes: 4,
      fetch: async () => new Response('12345', { status: 200 }),
    });
    await assert.rejects(
      () => oversized.observeGiftCard('shop-a', 'gift-1'),
      /exceeds configured byte limit/,
    );

    const malformed = new HttpGiftCardProvider({
      baseUrl: 'https://issuer.example.test',
      fetch: async () => new Response('{"status":"active"}', { status: 200 }),
    });
    await assert.rejects(() => malformed.observeGiftCard('shop-a', 'gift-1'));

    const secretError = new HttpGiftCardProvider({
      baseUrl: 'https://issuer.example.test',
      fetch: async () => new Response('Authorization: Bearer provider-secret', { status: 401 }),
    });
    await assert.rejects(
      () => secretError.observeGiftCard('shop-a', 'gift-1'),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.doesNotMatch(error.message, /provider-secret/);
        return true;
      },
    );
  });
});
