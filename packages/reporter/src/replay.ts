import type { Finding, Scenario } from '@aqa/schemas';

export interface ReplayInput {
  finding: Finding.Finding;
  scenario: Scenario.Scenario;
  base_url?: string;
}

export interface ReplayArtifact {
  /** Path relative to the run's artifact_dir (e.g. `replay/repro.sh`). */
  path: string;
  contents: string;
  kind: 'sh' | 'curl' | 'playwright' | 'sql' | 'json';
}

interface HttpProbeWith {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface PlaywrightAction {
  type?: string;
  url?: string;
  selector?: string;
  value?: string;
  key?: string;
}

interface PlaywrightProbeWith {
  script?: string;
  url?: string;
  actions?: PlaywrightAction[];
  args?: Record<string, unknown>;
}

interface SqlProbeWith {
  query?: string;
  params?: unknown[];
}

function httpProbes(scenario: Scenario.Scenario): Scenario.Probe[] {
  return scenario.steps.filter((s) => s.kind === 'http');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function curlFor(probe: Scenario.Probe, baseUrl?: string): string {
  const w = probe.with as HttpProbeWith;
  const method = (w.method ?? 'GET').toUpperCase();
  const rawUrl = w.url ?? '/';
  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : baseUrl
      ? new URL(rawUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
      : rawUrl;
  const safeArgs = ['curl', '-sS', '-X', shellQuote(method), shellQuote(url)];
  for (const [k, v] of Object.entries(w.headers ?? {})) {
    safeArgs.push('-H', shellQuote(`${k}: ${v}`));
  }
  if (w.body !== undefined) safeArgs.push('--data-raw', shellQuote(JSON.stringify(w.body)));
  return safeArgs.join(' ');
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function resolveReplayUrl(raw: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return baseUrl ? new URL(raw, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString() : raw;
}

function playwrightActionLines(actions: PlaywrightAction[]): string[] {
  return actions.map((action) => {
    const selector = action.selector === undefined ? null : jsString(action.selector);
    switch (action.type) {
      case 'goto':
        if (!action.url) throw new Error('playwright goto replay action requires url');
        return `  await page.goto(${jsString(action.url)}, { waitUntil: 'domcontentloaded' });`;
      case 'click':
        if (!selector) throw new Error('playwright click replay action requires selector');
        return `  await page.click(${selector});`;
      case 'fill':
        if (!selector || typeof action.value !== 'string')
          throw new Error('playwright fill replay action requires selector and string value');
        return `  await page.fill(${selector}, ${jsString(action.value)});`;
      case 'press':
        if (!selector || typeof action.key !== 'string')
          throw new Error('playwright press replay action requires selector and key');
        return `  await page.press(${selector}, ${jsString(action.key)});`;
      case 'wait_for':
        if (!selector) throw new Error('playwright wait_for replay action requires selector');
        return `  await page.locator(${selector}).waitFor({ state: 'visible' });`;
      default:
        throw new Error(`unsupported playwright replay action: ${String(action.type)}`);
    }
  });
}

function sqlLiteral(value: unknown): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

/**
 * Build the three-level replay artifacts for a finding. Bug-level (`repro.sh`)
 * is the minimum needed for `aqa replay`; scenario-level (`scenario.yaml`)
 * lets the orchestrator re-execute the full sequence; agent-level support
 * lands when the runner gets LLM-driven discovery.
 */
export function buildReplayArtifacts(input: ReplayInput): ReplayArtifact[] {
  const { scenario, finding, base_url: baseUrl } = input;
  const out: ReplayArtifact[] = [];

  const http = httpProbes(scenario);
  if (http.length > 0) {
    const lines = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `# Replay for ${finding.id}`,
      `# Scenario: ${scenario.id} — ${scenario.title}`,
      '',
      ...http.map((p) => `${curlFor(p, baseUrl)}\n`),
    ];
    out.push({ path: 'replay/repro.sh', contents: `${lines.join('\n')}\n`, kind: 'sh' });

    out.push({
      path: 'replay/repro.curl',
      contents: `${http.map((p) => curlFor(p, baseUrl)).join('\n\n')}\n`,
      kind: 'curl',
    });
  }

  const pw = scenario.steps.find((s) => s.kind === 'playwright');
  if (pw) {
    const w = pw.with as PlaywrightProbeWith;
    const actions = Array.isArray(w.actions) ? w.actions : [];
    const initialUrl = w.url ? resolveReplayUrl(w.url, baseUrl) : undefined;
    const executable = Boolean(initialUrl || actions.length > 0);
    const actionLines = actions.length > 0 ? playwrightActionLines(actions) : [];
    out.push({
      path: 'replay/repro.playwright.ts',
      kind: 'playwright',
      contents: `// Replay for ${finding.id}
// Scenario: ${scenario.id} — ${scenario.title}
import { test } from '@playwright/test';

${
  executable
    ? `test('replay ${finding.id}', async ({ page }) => {
${initialUrl ? `  await page.goto(${jsString(initialUrl)}, { waitUntil: 'domcontentloaded' });\n` : ''}${actionLines.join('\n')}
});`
    : `test.skip('replay ${finding.id}', 'scenario references an external script; run the original spec directly');
// Original script: ${w.script ?? '(no script declared)'}
// Args: ${JSON.stringify(w.args ?? {})}`
}
`,
    });
  }

  const sql = scenario.steps.find((s) => s.kind === 'sql');
  if (sql) {
    const w = sql.with as SqlProbeWith;
    const query = w.query?.trim();
    const params = Array.isArray(w.params) ? w.params : [];
    const prepared = query
      ? `PREPARE aqa_replay AS\n${query};\nEXECUTE aqa_replay(${params.map(sqlLiteral).join(', ')});`
      : '-- Missing with.query: the original SQL probe was invalid.';
    out.push({
      path: 'replay/repro.sql',
      kind: 'sql',
      contents: `-- Replay for ${finding.id}
-- Scenario: ${scenario.id} — ${scenario.title}
-- Requires the same read-only database target as the SQL probe driver.
-- Parameters are rendered as SQL literals for an auditable local replay.
BEGIN;
SET TRANSACTION READ ONLY;
${prepared}
ROLLBACK;
`,
    });
  }

  return out;
}
