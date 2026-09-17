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
      const responseBody = await response.text();
      if (new TextEncoder().encode(responseBody).byteLength > this.maxResponseBytes)
        throw new Error('webhook response exceeds configured limit');
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
