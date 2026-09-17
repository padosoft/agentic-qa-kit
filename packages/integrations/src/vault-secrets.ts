import type { WebhookSecretResolver } from './webhook.js';

export interface VaultSecretResolverOptions {
  endpoint: string;
  mount?: string;
  token: () => Promise<string>;
  fetcher?: typeof fetch;
  timeout_ms?: number;
}

/** Resolve Vault KV-v2 values lazily without persisting token or secret data. */
export class VaultSecretResolver implements WebhookSecretResolver {
  private readonly endpoint: string;
  private readonly mount: string;
  private readonly token: () => Promise<string>;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: VaultSecretResolverOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password)
      throw new Error('Vault endpoint must be credential-free HTTPS');
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
    this.endpoint = endpoint.toString().replace(/\/$/, '');
    this.mount = safeSegment(options.mount ?? 'secret', 'Vault mount');
    this.token = options.token;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = boundedPositive(options.timeout_ms ?? 5_000, 60_000, 'timeout_ms');
  }

  async resolve(secretRef: string): Promise<string> {
    const parts = secretRef
      .split('/')
      .filter(Boolean)
      .map((part) => safeSegment(part, 'secret reference'));
    if (parts.length === 0) throw new Error('secret reference must not be empty');
    const token = (await this.token()).trim();
    if (!token) throw new Error('Vault token resolver returned an empty token');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        `${this.endpoint}/v1/${encodeURIComponent(this.mount)}/data/${parts.map(encodeURIComponent).join('/')}`,
        {
          method: 'GET',
          headers: { accept: 'application/json', 'x-vault-token': token },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`Vault secret lookup failed (${response.status})`);
      const body = (await response.json()) as unknown;
      const value = readVaultValue(body);
      if (!value) throw new Error('Vault secret response did not contain a non-empty value');
      return value;
    } catch (error) {
      if (error instanceof Error && /^Vault /.test(error.message)) throw error;
      throw new Error('Vault secret lookup failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

function readVaultValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const outer = (value as { data?: unknown }).data;
  if (!outer || typeof outer !== 'object') return undefined;
  const data = (outer as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  const secret = (data as { value?: unknown }).value;
  return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
}

function safeSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('\0') || value.includes('\\'))
    throw new Error(`${label} contains an unsafe segment`);
  return value;
}

function boundedPositive(value: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
}
