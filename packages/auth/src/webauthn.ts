import { randomBytes } from 'node:crypto';

export type WebAuthnChallenge = {
  id: string;
  user_id: string;
  challenge: string;
  expires_at: string;
};

export type WebAuthnAssertion = {
  challenge_id: string;
  challenge: string;
  origin: string;
  rp_id: string;
  credential_id: string;
  signature: string;
  sign_count: number;
};

export type WebAuthnCredential = {
  credential_id: string;
  user_id: string;
  public_key: string;
  sign_count: number;
  /** Some authenticators do not expose a usable monotonic counter. */
  counter_supported?: boolean;
};

export interface WebAuthnChallengeStore {
  put(challenge: WebAuthnChallenge): Promise<void>;
  consume(id: string): Promise<WebAuthnChallenge | null>;
}

export interface WebAuthnCredentialStore {
  get(userId: string, credentialId: string): Promise<WebAuthnCredential | null>;
  updateSignCount(credentialId: string, signCount: number): Promise<boolean>;
}

export type WebAuthnSignatureVerifier = (
  assertion: WebAuthnAssertion,
  credential: WebAuthnCredential,
) => Promise<boolean>;

export class MemoryWebAuthnChallengeStore implements WebAuthnChallengeStore {
  private readonly challenges = new Map<string, WebAuthnChallenge>();

  async put(challenge: WebAuthnChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async consume(id: string): Promise<WebAuthnChallenge | null> {
    const challenge = this.challenges.get(id) ?? null;
    this.challenges.delete(id);
    return challenge;
  }
}

export class MemoryWebAuthnCredentialStore implements WebAuthnCredentialStore {
  private readonly credentials = new Map<string, WebAuthnCredential>();

  constructor(credentials: readonly WebAuthnCredential[] = []) {
    for (const credential of credentials)
      this.credentials.set(credential.credential_id, credential);
  }

  async get(userId: string, credentialId: string): Promise<WebAuthnCredential | null> {
    const credential = this.credentials.get(credentialId);
    return credential?.user_id === userId ? { ...credential } : null;
  }

  async updateSignCount(credentialId: string, signCount: number): Promise<boolean> {
    const credential = this.credentials.get(credentialId);
    if (!credential) return false;
    if (credential.counter_supported === false) return true;
    if (signCount <= credential.sign_count) return false;
    credential.sign_count = signCount;
    return true;
  }
}

export class WebAuthnLifecycle {
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      origin: string;
      rp_id: string;
      challenges: WebAuthnChallengeStore;
      credentials: WebAuthnCredentialStore;
      verifySignature: WebAuthnSignatureVerifier;
      now?: () => Date;
      challenge_ttl_ms?: number;
    },
  ) {
    let origin: URL;
    try {
      origin = new URL(options.origin);
    } catch {
      throw new Error('[auth/webauthn] valid HTTPS origin required');
    }
    if (origin.protocol !== 'https:' || !origin.hostname)
      throw new Error('[auth/webauthn] valid HTTPS origin required');
    if (!options.rp_id.trim()) throw new Error('[auth/webauthn] rp_id is required');
    const ttl = options.challenge_ttl_ms ?? 120_000;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 600_000)
      throw new Error('[auth/webauthn] challenge TTL must be 1..600000ms');
    this.challengeTtlMs = ttl;
    this.now = options.now ?? (() => new Date());
  }

  private readonly challengeTtlMs: number;

  async begin(userId: string): Promise<WebAuthnChallenge> {
    if (!userId.trim()) throw new Error('[auth/webauthn] user_id is required');
    const challenge: WebAuthnChallenge = {
      id: randomBytes(18).toString('base64url'),
      user_id: userId,
      challenge: randomBytes(32).toString('base64url'),
      expires_at: new Date(this.now().getTime() + this.challengeTtlMs).toISOString(),
    };
    await this.options.challenges.put(challenge);
    return challenge;
  }

  async verify(userId: string, assertion: WebAuthnAssertion): Promise<boolean> {
    const challenge = await this.options.challenges.consume(assertion.challenge_id);
    if (
      !challenge ||
      challenge.user_id !== userId ||
      challenge.challenge !== assertion.challenge ||
      Date.parse(challenge.expires_at) <= this.now().getTime() ||
      assertion.origin !== this.options.origin ||
      assertion.rp_id !== this.options.rp_id ||
      !Number.isSafeInteger(assertion.sign_count) ||
      assertion.sign_count < 0
    )
      return false;
    const credential = await this.options.credentials.get(userId, assertion.credential_id);
    if (!credential || !(await this.options.verifySignature(assertion, credential))) return false;
    // A non-increasing counter indicates cloning/replay. Counterless
    // authenticators rely on the one-time challenge and signature instead.
    return this.options.credentials.updateSignCount(assertion.credential_id, assertion.sign_count);
  }
}
