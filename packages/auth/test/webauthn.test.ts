import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  MemoryWebAuthnChallengeStore,
  MemoryWebAuthnCredentialStore,
  type WebAuthnAssertion,
  WebAuthnLifecycle,
} from '../dist/index.js';

const now = new Date('2026-09-17T12:00:00.000Z');

function lifecycle(options: { counter_supported?: boolean; verify?: boolean; ttl?: number } = {}) {
  const challenges = new MemoryWebAuthnChallengeStore();
  const credentials = new MemoryWebAuthnCredentialStore([
    {
      credential_id: 'cred-1',
      user_id: 'user-1',
      public_key: 'test-public-key',
      sign_count: 0,
      counter_supported: options.counter_supported,
    },
  ]);
  const instance = new WebAuthnLifecycle({
    origin: 'https://shop.example.test',
    rp_id: 'shop.example.test',
    challenges,
    credentials,
    challenge_ttl_ms: options.ttl,
    now: () => now,
    verifySignature: async (assertion, credential) => {
      assert.equal(credential.public_key, 'test-public-key');
      assert.equal(assertion.signature, 'valid-signature');
      return options.verify ?? true;
    },
  });
  return { instance, challenges, credentials };
}

describe('WebAuthnLifecycle', () => {
  it('requires a valid HTTPS origin and bounded challenge TTL', () => {
    assert.throws(() => lifecycle({ ttl: 0 }), /TTL/);
    assert.throws(
      () =>
        new WebAuthnLifecycle({
          origin: 'http://shop.example.test',
          rp_id: 'shop.example.test',
          challenges: new MemoryWebAuthnChallengeStore(),
          credentials: new MemoryWebAuthnCredentialStore(),
          verifySignature: async () => true,
        }),
      /HTTPS/,
    );
  });

  it('binds a signed assertion to the user, origin, RP and one-time challenge', async () => {
    const { instance } = lifecycle();
    const challenge = await instance.begin('user-1');
    const assertion: WebAuthnAssertion = {
      challenge_id: challenge.id,
      challenge: challenge.challenge,
      origin: 'https://shop.example.test',
      rp_id: 'shop.example.test',
      credential_id: 'cred-1',
      signature: 'valid-signature',
      sign_count: 1,
    };
    assert.equal(await instance.verify('user-1', assertion), true);
    assert.equal(await instance.verify('user-1', assertion), false);
  });

  it('rejects wrong users, origins, credentials, expired challenges and bad signatures', async () => {
    const cases = [
      { user: 'user-2', mutate: (a: WebAuthnAssertion) => a },
      {
        user: 'user-1',
        mutate: (a: WebAuthnAssertion) => ({ ...a, origin: 'https://evil.example.test' }),
      },
      { user: 'user-1', mutate: (a: WebAuthnAssertion) => ({ ...a, credential_id: 'missing' }) },
    ];
    for (const testCase of cases) {
      const { instance } = lifecycle();
      const challenge = await instance.begin('user-1');
      const assertion = testCase.mutate({
        challenge_id: challenge.id,
        challenge: challenge.challenge,
        origin: 'https://shop.example.test',
        rp_id: 'shop.example.test',
        credential_id: 'cred-1',
        signature: 'valid-signature',
        sign_count: 1,
      });
      assert.equal(await instance.verify(testCase.user, assertion), false);
    }

    const badSignature = lifecycle({ verify: false });
    const challenge = await badSignature.instance.begin('user-1');
    assert.equal(
      await badSignature.instance.verify('user-1', {
        challenge_id: challenge.id,
        challenge: challenge.challenge,
        origin: 'https://shop.example.test',
        rp_id: 'shop.example.test',
        credential_id: 'cred-1',
        signature: 'valid-signature',
        sign_count: 1,
      }),
      false,
    );
  });

  it('rejects a non-increasing counter for clone detection', async () => {
    const { instance } = lifecycle();
    const first = await instance.begin('user-1');
    assert.equal(
      await instance.verify('user-1', {
        challenge_id: first.id,
        challenge: first.challenge,
        origin: 'https://shop.example.test',
        rp_id: 'shop.example.test',
        credential_id: 'cred-1',
        signature: 'valid-signature',
        sign_count: 1,
      }),
      true,
    );
    const second = await instance.begin('user-1');
    assert.equal(
      await instance.verify('user-1', {
        challenge_id: second.id,
        challenge: second.challenge,
        origin: 'https://shop.example.test',
        rp_id: 'shop.example.test',
        credential_id: 'cred-1',
        signature: 'valid-signature',
        sign_count: 1,
      }),
      false,
    );
  });

  it('supports counterless authenticators without weakening one-time challenges', async () => {
    const { instance } = lifecycle({ counter_supported: false });
    const challenge = await instance.begin('user-1');
    assert.equal(
      await instance.verify('user-1', {
        challenge_id: challenge.id,
        challenge: challenge.challenge,
        origin: 'https://shop.example.test',
        rp_id: 'shop.example.test',
        credential_id: 'cred-1',
        signature: 'valid-signature',
        sign_count: 0,
      }),
      true,
    );
  });
});
