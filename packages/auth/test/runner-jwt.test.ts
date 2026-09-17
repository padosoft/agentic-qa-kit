import { strict as assert } from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'node:test';
import { RunnerJwtAuthorizer } from '../dist/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = 1_758_096_000;

function token(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const h = encoded({ alg: 'RS256', typ: 'JWT', ...header });
  const p = encoded(claims);
  const signature = sign('RSA-SHA256', Buffer.from(`${h}.${p}`, 'ascii'), privateKey).toString(
    'base64url',
  );
  return `${h}.${p}.${signature}`;
}

function authorizer() {
  return new RunnerJwtAuthorizer({
    public_key_pem: publicKeyPem,
    issuer: 'https://issuer.example.test',
    audience: 'aqa-runner',
    now: () => now,
    clock_skew_seconds: 0,
  });
}

describe('RunnerJwtAuthorizer', () => {
  it('verifies a short-lived scoped runner token', async () => {
    const result = await authorizer().authorize({
      authorization: `Bearer ${token({
        iss: 'https://issuer.example.test',
        aud: ['aqa-runner'],
        sub: 'runner-7',
        exp: now + 60,
        nbf: now - 1,
        scopes: ['shop/project-a', 'shop/project-b'],
      })}`,
    });
    assert.deepEqual(result, {
      runner_id: 'runner-7',
      scopes: [
        { org: 'shop', project: 'project-a' },
        { org: 'shop', project: 'project-b' },
      ],
    });
  });

  it('accepts an explicit organization wildcard and space-delimited scope claim', async () => {
    const result = await authorizer().authorize({
      Authorization: `Bearer ${token({
        iss: 'https://issuer.example.test',
        aud: 'aqa-runner',
        sub: 'runner-org',
        exp: now + 60,
        scope: 'shop/*',
      })}`,
    });
    assert.deepEqual(result, { runner_id: 'runner-org', scopes: [{ org: 'shop' }] });
  });

  it('fails closed for malformed, unsigned, wrong-issuer/audience and expired tokens', async () => {
    const verifier = authorizer();
    assert.equal(await verifier.authorize({}), false);
    assert.equal(await verifier.authorize({ authorization: 'Bearer nope' }), false);
    for (const claims of [
      { iss: 'wrong', aud: 'aqa-runner', sub: 'r', exp: now + 60, scopes: ['shop/*'] },
      {
        iss: 'https://issuer.example.test',
        aud: 'wrong',
        sub: 'r',
        exp: now + 60,
        scopes: ['shop/*'],
      },
      {
        iss: 'https://issuer.example.test',
        aud: 'aqa-runner',
        sub: 'r',
        exp: now - 1,
        scopes: ['shop/*'],
      },
      {
        iss: 'https://issuer.example.test',
        aud: 'aqa-runner',
        sub: 'r',
        exp: now + 60,
        scopes: ['shop/'],
      },
    ]) {
      assert.equal(await verifier.authorize({ authorization: `Bearer ${token(claims)}` }), false);
    }
    assert.equal(
      await verifier.authorize({
        authorization: `Bearer ${token(
          {
            iss: 'https://issuer.example.test',
            aud: 'aqa-runner',
            sub: 'r',
            exp: now + 60,
            scopes: ['shop/*'],
          },
          { alg: 'none' },
        )}`,
      }),
      false,
    );
  });
});
