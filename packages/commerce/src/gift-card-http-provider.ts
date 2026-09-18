import {
  type GiftCardProviderAdapter,
  GiftCardProviderSnapshot,
  type GiftCardProviderSnapshot as GiftCardProviderSnapshotValue,
} from './gift-card-provider.js';

export interface HttpGiftCardProviderOptions {
  baseUrl: string;
  allowedOrigins?: readonly string[];
  allowInsecureLocalHttp?: boolean;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
  headers?: (tenant: string, giftCardId: string) => Readonly<Record<string, string>>;
  path?: string;
}

function pathTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/:([a-z_]+)/g, (_match, key: string) => {
    const value = values[key];
    if (!value) throw new Error(`missing gift-card path value: ${key}`);
    return encodeURIComponent(value);
  });
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

/** Bounded provider-neutral HTTP adapter for a live gift-card issuer. */
export class HttpGiftCardProvider implements GiftCardProviderAdapter {
  private readonly baseUrl: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowInsecureLocalHttp: boolean;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly headers: NonNullable<HttpGiftCardProviderOptions['headers']>;
  private readonly path: string;

  constructor(options: HttpGiftCardProviderOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.username || parsed.password)
      throw new Error('gift-card provider URL must not contain credentials');
    this.allowInsecureLocalHttp = options.allowInsecureLocalHttp ?? false;
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && this.allowInsecureLocalHttp && isLoopback(parsed.hostname))
    )
      throw new Error('gift-card provider requires HTTPS outside explicitly allowed loopback HTTP');
    this.baseUrl = parsed.toString().replace(/\/$/, '');
    this.allowedOrigins = new Set(options.allowedOrigins ?? [parsed.origin]);
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1)
      throw new Error('gift-card provider maxResponseBytes must be a positive integer');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('gift-card provider adapter requires fetch');
    this.headers = options.headers ?? (() => ({}));
    this.path = options.path ?? '/gift-cards/:gift_card_id';
  }

  async observeGiftCard(
    tenant: string,
    giftCardId: string,
  ): Promise<GiftCardProviderSnapshotValue> {
    if (!tenant.trim() || !giftCardId.trim())
      throw new Error('gift-card provider tenant and card ID are required');
    const url = new URL(pathTemplate(this.path, { gift_card_id: giftCardId }), this.baseUrl);
    if (!this.allowedOrigins.has(url.origin))
      throw new Error(`gift-card provider origin is not allowlisted: ${url.origin}`);
    if (url.protocol !== 'https:' && !(this.allowInsecureLocalHttp && isLoopback(url.hostname)))
      throw new Error('gift-card provider request requires HTTPS');
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-AQA-Tenant': tenant,
        ...this.headers(tenant, giftCardId),
      },
      redirect: 'manual',
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxResponseBytes)
      throw new Error('gift-card provider response exceeds configured byte limit');
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Preserve a bounded response for the diagnostic below without logging it.
    }
    if (!response.ok)
      throw new Error(
        `gift-card provider HTTP ${response.status}: ${typeof parsed === 'string' ? parsed : response.statusText}`,
      );
    return GiftCardProviderSnapshot.parse(parsed);
  }
}
