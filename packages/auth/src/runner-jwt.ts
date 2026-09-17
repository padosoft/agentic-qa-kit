import { createPublicKey, verify } from 'node:crypto';

export type RunnerJwtScope = { org: string; project?: string };
export type RunnerJwtAuthorization = { runner_id: string; scopes: readonly RunnerJwtScope[] };
export type RunnerJwtAuthorizationResult = boolean | RunnerJwtAuthorization;

type JwtHeader = { alg?: unknown; typ?: unknown };
type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  nbf?: unknown;
  scopes?: unknown;
  scope?: unknown;
};

export type RunnerJwtAuthorizerOptions = {
  public_key_pem: string;
  issuer: string;
  audience: string;
  clock_skew_seconds?: number;
  now?: () => number;
};

/**
 * Verifies a short-lived RS256 runner JWT and returns tenant/project scopes.
 * The implementation is deliberately narrow: no algorithm negotiation, no
 * unsigned tokens, no static-token fallback and no implicit wildcard scope.
 */
export class RunnerJwtAuthorizer {
  private readonly publicKey: ReturnType<typeof createPublicKey>;
  private readonly clockSkewSeconds: number;
  private readonly now: () => number;

  constructor(private readonly options: RunnerJwtAuthorizerOptions) {
    if (!options.public_key_pem.trim()) throw new Error('[auth/runner-jwt] public key is required');
    if (!options.issuer.trim() || !options.audience.trim())
      throw new Error('[auth/runner-jwt] issuer and audience are required');
    const skew = options.clock_skew_seconds ?? 30;
    if (!Number.isInteger(skew) || skew < 0 || skew > 300)
      throw new Error('[auth/runner-jwt] clock skew must be 0..300 seconds');
    this.publicKey = createPublicKey(options.public_key_pem);
    this.clockSkewSeconds = skew;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async authorize(headers: Record<string, string>): Promise<RunnerJwtAuthorizationResult> {
    const raw = headers.authorization ?? headers.Authorization ?? '';
    const match = /^Bearer[ ]+([^ ]+)$/.exec(raw);
    if (!match?.[1]) return false;
    try {
      return this.verifyToken(match[1]);
    } catch {
      return false;
    }
  }

  private verifyToken(token: string): RunnerJwtAuthorization {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed JWT');
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    if (!encodedHeader || !encodedClaims || !encodedSignature) throw new Error('malformed JWT');
    const header = parseJson<JwtHeader>(encodedHeader);
    if (header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT'))
      throw new Error('unsupported JWT algorithm or type');
    const claims = parseJson<JwtClaims>(encodedClaims);
    const signature = decodeBase64Url(encodedSignature);
    const signed = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii');
    if (!verify('RSA-SHA256', signed, this.publicKey, signature)) throw new Error('bad signature');
    if (claims.iss !== this.options.issuer) throw new Error('issuer mismatch');
    if (!audienceContains(claims.aud, this.options.audience)) throw new Error('audience mismatch');
    const now = this.now();
    if (!finiteNumericDate(claims.exp) || claims.exp <= now - this.clockSkewSeconds)
      throw new Error('expired token');
    if (
      claims.nbf !== undefined &&
      (!finiteNumericDate(claims.nbf) || claims.nbf > now + this.clockSkewSeconds)
    )
      throw new Error('token is not active');
    if (typeof claims.sub !== 'string' || !claims.sub.trim())
      throw new Error('runner subject required');
    const scopes = parseScopes(claims.scopes ?? claims.scope);
    return { runner_id: claims.sub, scopes };
  }
}

function parseJson<T>(encoded: string): T {
  const value: unknown = JSON.parse(decodeBase64Url(encoded).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('JWT JSON object required');
  return value as T;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  return Buffer.from(value, 'base64url');
}

function finiteNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function audienceContains(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function parseScopes(value: unknown): readonly RunnerJwtScope[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[ ,]+/) : [];
  if (raw.length === 0) throw new Error('runner scopes required');
  const seen = new Set<string>();
  const scopes: RunnerJwtScope[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) throw new Error('invalid runner scope');
    const match = /^([^/]+)\/(\*|[^/]+)$/.exec(item);
    if (!match?.[1] || !match[2] || seen.has(item)) throw new Error('invalid runner scope');
    seen.add(item);
    scopes.push(match[2] === '*' ? { org: match[1] } : { org: match[1], project: match[2] });
  }
  return scopes;
}

export function runnerJwtAuthorizer(options: RunnerJwtAuthorizerOptions) {
  const authorizer = new RunnerJwtAuthorizer(options);
  return (headers: Record<string, string>) => authorizer.authorize(headers);
}
