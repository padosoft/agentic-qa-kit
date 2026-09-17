import type { Scenario } from '@aqa/schemas';
import { type Browser, chromium } from 'playwright';
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
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface BrowserFactory {
  launch(options: { headless: boolean }): Promise<Browser>;
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

/** Run structured browser actions through a persistent, origin-scoped page. */
export function makePlaywrightProbeRunner(
  opts: PlaywrightProbeRunnerOptions,
): PlaywrightProbeRunner {
  const baseUrl = new URL(opts.baseUrl).toString();
  const allowedOrigins = new Set(opts.allowedOrigins ?? [new URL(baseUrl).origin]);
  const maxTextBytes = opts.maxTextBytes ?? 256 * 1024;
  if (!Number.isInteger(maxTextBytes) || maxTextBytes < 1) {
    throw new Error('playwright maxTextBytes must be a positive integer');
  }
  const factory = opts.browserFactory ?? (chromium as unknown as BrowserFactory);
  let contextPromise: Promise<BrowserContext> | undefined;
  let browser: Browser | undefined;
  const context = async (): Promise<BrowserContext> => {
    if (!contextPromise) {
      contextPromise = factory
        .launch({ headless: opts.headless ?? true })
        .then(async (launched) => {
          browser = launched;
          return launched.newContext({ baseURL: baseUrl }) as Promise<BrowserContext>;
        });
    }
    return contextPromise;
  };
  const runner = (async (probe: Scenario.Probe) => {
    if (probe.kind !== 'playwright') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    try {
      const page = await (await context()).newPage();
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
      const text = await page.innerText('body', { timeout: probe.timeout_ms });
      const bytes = Buffer.byteLength(text, 'utf8');
      if (bytes > maxTextBytes)
        return { probe_id: probe.id, error: `page text exceeds ${maxTextBytes} bytes` };
      return {
        probe_id: probe.id,
        body: { url: page.url(), title: await page.title(), text: redact(text) },
      };
    } catch (error) {
      return {
        probe_id: probe.id,
        error: redact(error instanceof Error ? error.message : String(error)),
      };
    }
  }) as unknown as PlaywrightProbeRunner;
  runner.close = async () => {
    const currentContext = contextPromise;
    if (currentContext) await (await currentContext).close();
    else await browser?.close();
    browser = undefined;
    contextPromise = undefined;
  };
  return runner;
}
