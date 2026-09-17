import type { Role } from './types.js';

export interface SamlAssertion {
  assertion_id: string;
  issuer: string;
  audience: string;
  subject: string;
  email: string;
  display_name?: string;
  roles?: string[];
  issued_at: string;
  expires_at: string;
  not_before?: string;
}

export interface SamlPrincipal {
  subject: string;
  email: string;
  display_name: string;
  roles: Role[];
  assertion_id: string;
  issuer: string;
  audience: string;
}

/** Signature/XML parser boundary; implementations must validate the XML signature before returning claims. */
export type SamlSignatureVerifier = (rawAssertion: string) => Promise<unknown>;

/** The claim operation must be atomic in a durable implementation. */
export interface SamlReplayGuard {
  claim(assertionId: string, expiresAt: string): Promise<boolean>;
}

export class SamlValidationError extends Error {
  constructor(message: string) {
    super(`[auth/saml] ${message}`);
    this.name = 'SamlValidationError';
  }
}

export interface SamlLoginOptions {
  issuer: string;
  audience: string;
  verifySignature: SamlSignatureVerifier;
  replayGuard: SamlReplayGuard;
  now?: () => Date;
}

/** Validates signed, already-parsed SAML claims at the identity boundary. */
export class SamlLoginBoundary {
  private readonly now: () => Date;

  constructor(private readonly options: SamlLoginOptions) {
    if (!options.issuer.trim() || !options.audience.trim())
      throw new SamlValidationError('issuer and audience are required');
    this.now = options.now ?? (() => new Date());
  }

  async authenticate(rawAssertion: string): Promise<SamlPrincipal> {
    if (!rawAssertion.trim()) throw new SamlValidationError('assertion is required');
    const assertion = parseAssertion(await this.options.verifySignature(rawAssertion));
    if (assertion.issuer !== this.options.issuer) throw new SamlValidationError('issuer mismatch');
    if (assertion.audience !== this.options.audience)
      throw new SamlValidationError('audience mismatch');
    const now = this.now().getTime();
    const issued = Date.parse(assertion.issued_at);
    const expires = Date.parse(assertion.expires_at);
    const notBefore = assertion.not_before ? Date.parse(assertion.not_before) : undefined;
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued)
      throw new SamlValidationError('invalid assertion time window');
    if (expires <= now) throw new SamlValidationError('assertion expired');
    if (notBefore !== undefined && (!Number.isFinite(notBefore) || notBefore > now))
      throw new SamlValidationError('assertion is not active');
    if (!(await this.options.replayGuard.claim(assertion.assertion_id, assertion.expires_at)))
      throw new SamlValidationError('assertion replay detected');
    const roles = (assertion.roles ?? []).filter(isRole);
    return {
      subject: assertion.subject,
      email: assertion.email,
      display_name: assertion.display_name?.trim() || assertion.email,
      roles: roles.length > 0 ? roles : ['viewer'],
      assertion_id: assertion.assertion_id,
      issuer: assertion.issuer,
      audience: assertion.audience,
    };
  }
}

function parseAssertion(value: unknown): SamlAssertion {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SamlValidationError('signature verifier returned no assertion');
  const item = value as Record<string, unknown>;
  for (const field of [
    'assertion_id',
    'issuer',
    'audience',
    'subject',
    'email',
    'issued_at',
    'expires_at',
  ]) {
    if (typeof item[field] !== 'string' || !item[field].trim())
      throw new SamlValidationError(`${field} is required`);
  }
  if (!/^\S+@\S+\.\S+$/.test(item.email as string))
    throw new SamlValidationError('a valid email is required');
  if (
    item.roles !== undefined &&
    (!Array.isArray(item.roles) || item.roles.some((role) => typeof role !== 'string'))
  )
    throw new SamlValidationError('roles must be strings');
  return item as unknown as SamlAssertion;
}

function isRole(value: string): value is Role {
  return value === 'viewer' || value === 'developer' || value === 'maintainer' || value === 'admin';
}
