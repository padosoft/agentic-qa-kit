import { isIP } from 'node:net';

/** Network controls applied before an LLM adapter sends a request. */
export interface TransportPolicyOptions {
  /** Required for local models, private endpoints and plain HTTP. */
  allowPrivateNetwork?: boolean;
  /** Optional exact host allow-list. A `*.example.com` entry allows subdomains. */
  allowedHosts?: readonly string[];
}

/**
 * Fail closed on ambiguous endpoints. This is a synchronous guard against
 * configuration mistakes and literal-IP SSRF; a production DNS resolver or
 * egress proxy must still enforce the resolved-address policy at the network
 * boundary because DNS can change after this check.
 */
export function assertEndpointAllowed(endpoint: string, options: TransportPolicyOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('[llm-adapters] endpoint must be an absolute URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || url.username || url.password || url.search || url.hash)
    throw new Error('[llm-adapters] endpoint must not contain credentials, query or fragment');
  if (url.protocol !== 'https:' && !(options.allowPrivateNetwork && url.protocol === 'http:'))
    throw new Error('[llm-adapters] endpoint must use HTTPS (HTTP requires allowPrivateNetwork)');
  if (
    options.allowedHosts?.length &&
    !options.allowedHosts.some((entry) => hostMatches(hostname, entry))
  )
    throw new Error(
      `[llm-adapters] endpoint host is not in the configured allow-list: ${hostname}`,
    );
  if (!options.allowPrivateNetwork && isPrivateHostname(hostname))
    throw new Error(
      `[llm-adapters] private or local endpoint requires allowPrivateNetwork: ${hostname}`,
    );
  return url;
}

function hostMatches(hostname: string, entry: string): boolean {
  const normalized = entry.toLowerCase().replace(/^\*\./, '.');
  return normalized.startsWith('.')
    ? hostname.endsWith(normalized) && hostname !== normalized.slice(1)
    : hostname === normalized;
}

function isPrivateHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local'))
    return true;
  const version = isIP(hostname);
  if (version === 4) {
    const octets = hostname.split('.').map(Number);
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (version === 6) {
    const compact = hostname.toLowerCase();
    return (
      compact === '::1' ||
      compact.startsWith('fc') ||
      compact.startsWith('fd') ||
      compact.startsWith('fe8') ||
      compact.startsWith('fe9') ||
      compact.startsWith('fea') ||
      compact.startsWith('feb')
    );
  }
  return hostname.endsWith('.internal') || hostname.endsWith('.intranet');
}
