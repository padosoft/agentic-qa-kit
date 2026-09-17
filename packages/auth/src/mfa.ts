import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role, User } from './types.js';

export interface MfaPolicy {
  enabled: boolean;
  /** If omitted, every interactive user is subject to the policy. */
  required_roles?: ReadonlyArray<Role>;
}

export function mfaRequired(user: User, policy: MfaPolicy | undefined): boolean {
  if (!policy?.enabled) return false;
  if (!policy.required_roles || policy.required_roles.length === 0) return true;
  return user.roles.some((role) => policy.required_roles?.includes(role));
}

/** Fail closed when a policy-covered user lacks an IdP-asserted MFA factor. */
export function enforceMfa(user: User, policy: MfaPolicy | undefined): User {
  if (mfaRequired(user, policy) && user.mfa_verified !== true)
    throw new Error('[auth/mfa] multi-factor authentication is required');
  return user;
}

export interface TotpVerifyOptions {
  secret_base32: string;
  code: string;
  now_ms?: number;
  period_seconds?: number;
  digits?: number;
  window?: number;
}

/** Verify RFC 6238 TOTP without persisting or logging the shared secret. */
export function verifyTotp(options: TotpVerifyOptions): boolean {
  const period = options.period_seconds ?? 30;
  const digits = options.digits ?? 6;
  const window = options.window ?? 1;
  const nowMs = options.now_ms ?? Date.now();
  if (!Number.isInteger(period) || period < 1) throw new Error('[auth/mfa] invalid TOTP period');
  if (!Number.isInteger(digits) || digits < 6 || digits > 8)
    throw new Error('[auth/mfa] invalid TOTP digits');
  if (!Number.isInteger(window) || window < 0 || window > 10)
    throw new Error('[auth/mfa] invalid TOTP window');
  if (!Number.isInteger(nowMs) || nowMs < 0) throw new Error('[auth/mfa] invalid TOTP clock');
  if (!new RegExp(`^\\d{${digits}}$`).test(options.code)) return false;
  const secret = decodeBase32(options.secret_base32);
  const counter = Math.floor(nowMs / 1000 / period);
  const expected = Buffer.from(options.code, 'ascii');
  for (let offset = -window; offset <= window; offset += 1) {
    if (counter + offset < 0) continue;
    const candidate = Buffer.from(generateTotp(secret, counter + offset, digits), 'ascii');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

function generateTotp(secret: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigInt64BE(BigInt(counter), 0);
  const digest = createHmac('sha1', secret).update(message).digest();
  const byte = (index: number): number => digest[index] ?? 0;
  const offset = byte(digest.length - 1) & 0x0f;
  const binary =
    (byte(offset) & 0x7f) * 2 ** 24 +
    (byte(offset + 1) & 0xff) * 2 ** 16 +
    (byte(offset + 2) & 0xff) * 2 ** 8 +
    (byte(offset + 3) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function decodeBase32(value: string): Buffer {
  const normalized = value.replace(/[\s=-]/g, '').toUpperCase();
  if (!normalized || normalized.length > 128 || !/^[A-Z2-7]+$/.test(normalized))
    throw new Error('[auth/mfa] invalid TOTP secret');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    buffer = buffer * 32 + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(buffer / 2 ** bits) & 0xff);
      buffer %= 2 ** bits;
    }
  }
  if (bytes.length < 10) throw new Error('[auth/mfa] TOTP secret is too short');
  return Buffer.from(bytes);
}
