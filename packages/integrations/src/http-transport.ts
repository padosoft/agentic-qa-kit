import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { WebhookResponse, WebhookTransport } from './webhook.js';
import type { WebhookDestinationPolicy } from './webhook.js';

export interface HttpWebhookTransportOptions {
  destinationPolicy: WebhookDestinationPolicy;
  fetcher?: typeof fetch;
  timeout_ms?: number;
  max_response_bytes?: number;
}

/** HTTP transport with no redirects, bounded response handling and cancellation. */
export class HttpWebhookTransport implements WebhookTransport {
  private readonly policy: WebhookDestinationPolicy;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: HttpWebhookTransportOptions) {
    this.policy = options.destinationPolicy;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = boundedPositive(options.timeout_ms ?? 10_000, 60_000, 'timeout_ms');
    this.maxResponseBytes = boundedPositive(
      options.max_response_bytes ?? 64_000,
      1_000_000,
      'max_response_bytes',
    );
  }

  async send(request: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<WebhookResponse> {
    this.policy.assertAllowed(request.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > this.maxResponseBytes)
        throw new Error('webhook response exceeds configured limit');
      await readBoundedResponseBody(response, this.maxResponseBytes);
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      return {
        status: response.status,
        ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface NodePinnedHttpsTransportOptions {
  destinationPolicy: WebhookDestinationPolicy;
  timeout_ms?: number;
  max_response_bytes?: number;
  resolver?: (hostname: string) => Promise<readonly string[]>;
}

/**
 * Node transport that pins a single DNS answer to the TLS connection.
 * The normal fetch transport remains portable; this adapter is the production
 * choice when DNS rebinding and private-address egress must be enforced by the
 * client rather than delegated to an infrastructure proxy.
 */
export class NodePinnedHttpsWebhookTransport implements WebhookTransport {
  private readonly policy: WebhookDestinationPolicy;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly resolver: (hostname: string) => Promise<readonly string[]>;

  constructor(options: NodePinnedHttpsTransportOptions) {
    this.policy = options.destinationPolicy;
    this.timeoutMs = boundedPositive(options.timeout_ms ?? 10_000, 60_000, 'timeout_ms');
    this.maxResponseBytes = boundedPositive(
      options.max_response_bytes ?? 64_000,
      1_000_000,
      'max_response_bytes',
    );
    this.resolver =
      options.resolver ??
      (async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address));
  }

  async send(request: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<WebhookResponse> {
    this.policy.assertAllowed(request.url);
    const url = new URL(request.url);
    const addresses = await this.resolver(url.hostname);
    if (addresses.length === 0) throw new Error('webhook destination has no DNS address');
    for (const address of addresses) assertPublicAddress(address);
    const address = addresses[0];
    if (!address) throw new Error('webhook destination has no DNS address');

    return new Promise<WebhookResponse>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const finish = (response: WebhookResponse): void => {
        if (settled) return;
        settled = true;
        resolve(response);
      };
      const client = https.request(
        {
          hostname: address,
          port: url.port ? Number(url.port) : 443,
          method: 'POST',
          path: `${url.pathname}${url.search}`,
          servername: url.hostname,
          headers: { ...request.headers, host: url.host },
          rejectUnauthorized: true,
          timeout: this.timeoutMs,
        },
        (response) => {
          let total = 0;
          const contentLength = Number(response.headers['content-length'] ?? 0);
          if (contentLength > this.maxResponseBytes) {
            response.destroy();
            fail(new Error('webhook response exceeds configured limit'));
            return;
          }
          response.on('data', (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > this.maxResponseBytes) {
              response.destroy();
              fail(new Error('webhook response exceeds configured limit'));
            }
          });
          response.on('end', () => {
            const retryAfterHeader = response.headers['retry-after'];
            const retryAfter = parseRetryAfter(
              Array.isArray(retryAfterHeader)
                ? (retryAfterHeader[0] ?? null)
                : (retryAfterHeader ?? null),
            );
            finish({
              status: response.statusCode ?? 599,
              ...(retryAfter === undefined ? {} : { retry_after_ms: retryAfter }),
            });
          });
          response.on('error', (error) => fail(error));
        },
      );
      client.on('timeout', () => client.destroy(new Error('webhook request timed out')));
      client.on('error', (error) => fail(error));
      client.end(request.body);
    });
  }
}

async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('webhook response exceeds configured limit');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function boundedPositive(value: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return value;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 15 * 60_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), 15 * 60_000);
}

function assertPublicAddress(address: string): void {
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error('webhook destination has an invalid address');
  if (isPrivateOrLocal(address, family))
    throw new Error('webhook destination resolved to a private or local address');
}

function isPrivateOrLocal(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    const octets = address.split('.').map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1];
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  );
}
