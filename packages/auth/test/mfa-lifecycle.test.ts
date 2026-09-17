import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { InMemoryMfaCredentialStore, MfaLifecycle, type MfaSecretProtector } from '../src/index.js';
import { verifyTotp } from '../src/mfa.js';

const protector: MfaSecretProtector = {
  async protect(secret) {
    return `wrapped:${secret}`;
  },
  async reveal(value) {
    return value.replace(/^wrapped:/, '');
  },
};

describe('MfaLifecycle', () => {
  it('enrolls only after a valid TOTP and never stores raw secrets or recovery codes', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const store = new InMemoryMfaCredentialStore();
    const lifecycle = new MfaLifecycle({ store, protector, issuer: 'AQA', now: () => now });
    const enrollment = await lifecycle.beginEnrollment('user-1', 'user@example.test');
    assert.match(enrollment.otpauth_uri, /^otpauth:\/\/totp\//);
    assert.equal(await lifecycle.verify('user-1', '000000'), false);
    const code = totpCode(enrollment.secret_base32, now.getTime());
    assert.equal(
      verifyTotp({ secret_base32: enrollment.secret_base32, code, now_ms: now.getTime() }),
      true,
    );
    await lifecycle.confirmEnrollment('user-1', enrollment, code);
    assert.equal(await lifecycle.verify('user-1', code), true);
    assert.equal((await store.get('user-1'))?.protected_secret.startsWith('wrapped:'), true);
    assert.equal(
      (await store.get('user-1'))?.recovery_code_hashes.includes(
        enrollment.recovery_codes[0] ?? '',
      ),
      false,
    );
    await assert.rejects(
      () => lifecycle.confirmEnrollment('user-1', enrollment, '000000'),
      /invalid enrollment/,
    );
  });

  it('consumes a recovery code once and preserves remaining recovery codes', async () => {
    const store = new InMemoryMfaCredentialStore();
    const lifecycle = new MfaLifecycle({ store, protector, issuer: 'AQA' });
    const enrollment = await lifecycle.beginEnrollment('user-2', 'user2@example.test');
    await lifecycle.confirmEnrollment(
      'user-2',
      enrollment,
      totpCode(enrollment.secret_base32, Date.now()),
    );
    const recovery = enrollment.recovery_codes[0] ?? '';
    assert.equal(await lifecycle.consumeRecoveryCode('user-2', recovery), true);
    assert.equal(await lifecycle.consumeRecoveryCode('user-2', recovery), false);
    assert.equal(
      (await store.get('user-2'))?.recovery_code_hashes.length,
      enrollment.recovery_codes.length - 1,
    );
  });
});

function totpCode(secretBase32: string, nowMs: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of secretBase32) {
    buffer = buffer * 32 + alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(buffer / 2 ** bits) & 0xff);
      buffer %= 2 ** bits;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)), 0);
  const digest = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const value =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    (digest[offset + 1] ?? 0) * 2 ** 16 +
    (digest[offset + 2] ?? 0) * 2 ** 8 +
    (digest[offset + 3] ?? 0);
  return String(value % 1_000_000).padStart(6, '0');
}
