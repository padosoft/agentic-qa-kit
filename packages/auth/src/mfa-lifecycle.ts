import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyTotp } from './mfa.js';

export interface MfaSecretProtector {
  protect(secret: string): Promise<string>;
  reveal(protectedSecret: string): Promise<string>;
}

export interface MfaCredential {
  user_id: string;
  protected_secret: string;
  recovery_code_hashes: readonly string[];
  enabled_at: string;
}

export interface MfaCredentialStore {
  get(userId: string): Promise<MfaCredential | undefined>;
  put(credential: MfaCredential): Promise<void>;
  delete(userId: string): Promise<void>;
}

export class InMemoryMfaCredentialStore implements MfaCredentialStore {
  private readonly records = new Map<string, MfaCredential>();

  async get(userId: string): Promise<MfaCredential | undefined> {
    const value = this.records.get(userId);
    return value ? { ...value, recovery_code_hashes: [...value.recovery_code_hashes] } : undefined;
  }

  async put(credential: MfaCredential): Promise<void> {
    this.records.set(credential.user_id, {
      ...credential,
      recovery_code_hashes: [...credential.recovery_code_hashes],
    });
  }

  async delete(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

export interface MfaEnrollment {
  user_id: string;
  secret_base32: string;
  otpauth_uri: string;
  recovery_codes: readonly string[];
}

export interface MfaLifecycleOptions {
  store: MfaCredentialStore;
  protector: MfaSecretProtector;
  issuer: string;
  now?: () => Date;
  recovery_code_count?: number;
}

/**
 * TOTP lifecycle boundary. Secret protection is mandatory and delegated to a
 * KMS/Vault-backed implementation in production; this class never persists a
 * raw secret or a recoverable recovery code.
 */
export class MfaLifecycle {
  private readonly now: () => Date;
  private readonly count: number;

  constructor(private readonly options: MfaLifecycleOptions) {
    if (!options.issuer.trim()) throw new Error('[auth/mfa] issuer is required');
    this.now = options.now ?? (() => new Date());
    this.count = options.recovery_code_count ?? 10;
    if (!Number.isInteger(this.count) || this.count < 5 || this.count > 20)
      throw new Error('[auth/mfa] recovery_code_count must be between 5 and 20');
  }

  async beginEnrollment(userId: string, accountName: string): Promise<MfaEnrollment> {
    if (!userId.trim() || !accountName.trim())
      throw new Error('[auth/mfa] user and account are required');
    const secret = encodeBase32(randomBytes(20));
    const recoveryCodes = Array.from({ length: this.count }, () => formatRecoveryCode());
    return {
      user_id: userId,
      secret_base32: secret,
      otpauth_uri: `otpauth://totp/${encodeURIComponent(this.options.issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(this.options.issuer)}`,
      recovery_codes: recoveryCodes,
    };
  }

  async confirmEnrollment(userId: string, enrollment: MfaEnrollment, code: string): Promise<void> {
    if (enrollment.user_id !== userId) throw new Error('[auth/mfa] enrollment user mismatch');
    if (
      !verifyTotp({ secret_base32: enrollment.secret_base32, code, now_ms: this.now().getTime() })
    )
      throw new Error('[auth/mfa] invalid enrollment code');
    const protectedSecret = await this.options.protector.protect(enrollment.secret_base32);
    if (!protectedSecret) throw new Error('[auth/mfa] secret protection returned empty data');
    await this.options.store.put({
      user_id: userId,
      protected_secret: protectedSecret,
      recovery_code_hashes: enrollment.recovery_codes.map(hashRecoveryCode),
      enabled_at: this.now().toISOString(),
    });
  }

  async verify(userId: string, code: string): Promise<boolean> {
    const credential = await this.options.store.get(userId);
    if (!credential) return false;
    const secret = await this.options.protector.reveal(credential.protected_secret);
    return verifyTotp({ secret_base32: secret, code, now_ms: this.now().getTime() });
  }

  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const credential = await this.options.store.get(userId);
    if (!credential) return false;
    const candidate = Buffer.from(hashRecoveryCode(code), 'hex');
    const remaining = credential.recovery_code_hashes.filter((stored) => {
      const expected = Buffer.from(stored, 'hex');
      return expected.length !== candidate.length || !timingSafeEqual(expected, candidate);
    });
    if (remaining.length === credential.recovery_code_hashes.length) return false;
    await this.options.store.put({ ...credential, recovery_code_hashes: remaining });
    return true;
  }
}

function formatRecoveryCode(): string {
  return (
    randomBytes(5)
      .toString('hex')
      .toUpperCase()
      .match(/.{1,5}/g)
      ?.join('-') ?? ''
  );
}

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}

function encodeBase32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
