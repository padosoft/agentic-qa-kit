import type { Scenario } from '@aqa/schemas';
import type { ProbeRunner } from './run.js';

interface BrowserPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  click(selector: string, options: { timeout: number }): Promise<void>;
  fill(selector: string, value: string, options: { timeout: number }): Promise<void>;
  press(selector: string, key: string, options: { timeout: number }): Promise<void>;
  locator(selector: string): {
    waitFor(options: { state: 'visible'; timeout: number }): Promise<void>;
  };
  title(): Promise<string>;
  url(): string;
  innerText(selector: string, options: { timeout: number }): Promise<string>;
  close?: () => Promise<void>;
}

interface BrowserContext {
  route(url: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface BrowserRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserLike {
  newContext(options: { baseURL: string }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserFactory {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

export interface PlaywrightProbeRunnerOptions {
  baseUrl: string;
  allowedOrigins?: readonly string[];
  headless?: boolean;
  browserFactory?: BrowserFactory;
  maxTextBytes?: number;
}

export interface PlaywrightProbeRunner extends ProbeRunner {
  close(): Promise<void>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED-JWT]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]');
}

function resolveAllowedUrl(
  raw: string,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): string {
  const url = new URL(raw, baseUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('playwright URL must use http or https');
  if (!allowedOrigins.has(url.origin))
    throw new Error(`playwright origin is not allowlisted: ${url.origin}`);
  return url.toString();
}

function normalizeAllowedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const raw of origins) {
    const origin = new URL(raw);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      throw new Error(
        `playwright allowlist entry must be an origin without credentials or path: ${raw}`,
      );
    }
    normalized.add(origin.origin);
  }
  if (normalized.size === 0) throw new Error('playwright origin allowlist must not be empty');
  return normalized;
}

async function loadDefaultBrowserFactory(): Promise<BrowserFactory> {
  // Keep Playwright out of the CLI bundle. The host installs it only when a
  // browser journey is enabled at runtime.
  const load = new Function('moduleName', 'return import(moduleName)') as (
    moduleName: string,
  ) => Promise<{ chromium: BrowserFactory }>;
  const module = await load('playwright');
  return module.chromium;
}

/** Run structured browser actions through a persistent, origin-scoped page. */
export function makePlaywrightProbeRunner(
  opts: PlaywrightProbeRunnerOptions,
): PlaywrightProbeRunner {
  const parsedBaseUrl = new URL(opts.baseUrl);
  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error('playwright baseUrl must not contain credentials');
  }
  const baseUrl = parsedBaseUrl.toString();
  const allowedOrigins = normalizeAllowedOrigins(opts.allowedOrigins ?? [parsedBaseUrl.origin]);
  const maxTextBytes = opts.maxTextBytes ?? 256 * 1024;
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 1) {
    throw new Error('playwright maxTextBytes must be a positive integer');
  }
  const factoryPromise = opts.browserFactory
    ? Promise.resolve(opts.browserFactory)
    : loadDefaultBrowserFactory();
  let contextPromise: Promise<BrowserContext> | undefined;
  let browser: BrowserLike | undefined;
  const context = async (): Promise<BrowserContext> => {
    if (!contextPromise) {
      contextPromise = factoryPromise
        .then((factory) => factory.launch({ headless: opts.headless ?? true }))
        .then(async (launched) => {
          browser = launched;
          const browserContext = await launched.newContext({ baseURL: baseUrl });
          await browserContext.route('**/*', async (route) => {
            try {
              const requestUrl = new URL(route.request().url());
              if (
                !/^https?:$/.test(requestUrl.protocol) ||
                requestUrl.username ||
                requestUrl.password ||
                !allowedOrigins.has(requestUrl.origin)
              ) {
                await route.abort();
                return;
              }
              await route.continue();
            } catch {
              await route.abort();
            }
          });
          return browserContext;
        });
    }
    return contextPromise;
  };
  const runner = (async (probe: Scenario.Probe, externalSignal?: AbortSignal) => {
    if (probe.kind !== 'playwright') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    if (externalSignal?.aborted)
      return { probe_id: probe.id, error: 'playwright probe cancelled before dispatch' };
    let page: BrowserPage | undefined;
    const abort = () => {
      void page?.close?.();
    };
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      page = await (await context()).newPage();
      const withConfig = probe.with;
      const rawUrl = asString(withConfig.url);
      if (rawUrl)
        await page.goto(resolveAllowedUrl(rawUrl, baseUrl, allowedOrigins), {
          waitUntil: 'domcontentloaded',
          timeout: probe.timeout_ms,
        });
      const actions = withConfig.actions;
      if (
        actions !== undefined &&
        (!Array.isArray(actions) || actions.some((action) => !action || typeof action !== 'object'))
      ) {
        return { probe_id: probe.id, error: 'playwright with.actions must be an object[]' };
      }
      for (const action of (actions ?? []) as Array<Record<string, unknown>>) {
        const type = action.type;
        const selector = asString(action.selector);
        const timeout = probe.timeout_ms;
        if (type === 'goto') {
          const target = asString(action.url);
          if (!target) throw new Error('playwright goto action requires url');
          await page.goto(resolveAllowedUrl(target, baseUrl, allowedOrigins), {
            waitUntil: 'domcontentloaded',
            timeout,
          });
        } else if (type === 'click' && selector) await page.click(selector, { timeout });
        else if (type === 'fill' && selector && typeof action.value === 'string')
          await page.fill(selector, action.value, { timeout });
        else if (type === 'press' && selector && typeof action.key === 'string')
          await page.press(selector, action.key, { timeout });
        else if (type === 'wait_for' && selector)
          await page.locator(selector).waitFor({ state: 'visible', timeout });
        else throw new Error(`unsupported or malformed playwright action: ${String(type)}`);
      }
      if (externalSignal?.aborted) throw new Error('playwright probe cancelled');
      const text = await page.innerText('body', { timeout: probe.timeout_ms });
      if (externalSignal?.aborted) throw new Error('playwright probe cancelled');
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > maxTextBytes)
        return { probe_id: probe.id, error: `page text exceeds ${maxTextBytes} bytes` };
      return {
        probe_id: probe.id,
        body: { url: page.url(), title: await page.title(), text: redact(text) },
      };
    } catch (error) {
      if (externalSignal?.aborted)
        return { probe_id: probe.id, error: 'playwright probe cancelled' };
      return {
        probe_id: probe.id,
        error: redact(error instanceof Error ? error.message : String(error)),
      };
    } finally {
      externalSignal?.removeEventListener('abort', abort);
    }
  }) as unknown as PlaywrightProbeRunner;
  runner.close = async () => {
    const currentContext = contextPromise;
    if (currentContext) await (await currentContext).close();
    await browser?.close();
    browser = undefined;
    contextPromise = undefined;
  };
  return runner;
}
