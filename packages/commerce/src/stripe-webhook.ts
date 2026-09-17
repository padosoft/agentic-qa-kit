import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StripeWebhookVerificationOptions {
  now_ms?: number;
  tolerance_seconds?: number;
}

export interface StripeWebhookVerification {
  ok: boolean;
  reason: 'verified' | 'invalid_header' | 'invalid_timestamp' | 'stale' | 'invalid_signature';
  timestamp?: number;
}

/** Verify Stripe's v1 signature against the untouched request body. */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  endpointSecret: string,
  options: StripeWebhookVerificationOptions = {},
): StripeWebhookVerification {
  if (!endpointSecret.trim()) throw new Error('[commerce/stripe] endpoint secret is required');
  const tolerance = options.tolerance_seconds ?? 300;
  const nowMs = options.now_ms ?? Date.now();
  if (!Number.isSafeInteger(tolerance) || tolerance <= 0)
    throw new Error('[commerce/stripe] tolerance must be a positive integer');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0)
    throw new Error('[commerce/stripe] clock must be a non-negative integer');
  const fields = signatureHeader
    ?.split(',')
    .map((part) => part.trim().split('='))
    .filter(
      (part): part is [string, string] => part.length === 2 && Boolean(part[0]) && Boolean(part[1]),
    );
  if (!fields || fields.length === 0) return { ok: false, reason: 'invalid_header' };
  const timestamps = fields.filter(([key]) => key === 't').map(([, value]) => Number(value));
  const timestampValue = timestamps[0];
  if (
    timestamps.length !== 1 ||
    typeof timestampValue !== 'number' ||
    !Number.isSafeInteger(timestampValue) ||
    timestampValue <= 0
  )
    return { ok: false, reason: 'invalid_timestamp' };
  const timestamp = timestampValue;
  if (Math.abs(nowMs - timestamp * 1_000) > tolerance * 1_000)
    return { ok: false, reason: 'stale', timestamp };
  const expected = createHmac('sha256', endpointSecret).update(`${timestamp}.${rawBody}`).digest();
  const valid = fields
    .filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value))
    .some(([, value]) => {
      const candidate = Buffer.from(value, 'hex');
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
  return valid
    ? { ok: true, reason: 'verified', timestamp }
    : { ok: false, reason: 'invalid_signature', timestamp };
}
