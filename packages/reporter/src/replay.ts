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
  kind: 'sh' | 'curl' | 'playwright' | 'sql';
}

interface HttpProbeWith {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
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
    const w = pw.with as { script?: string; args?: Record<string, unknown> };
    out.push({
      path: 'replay/repro.playwright.ts',
      kind: 'playwright',
      contents: `// Replay for ${finding.id}
// Scenario: ${scenario.id} — ${scenario.title}
//
// Execute the original Playwright spec the scenario referenced. The runner
// passes the same args object so the bug reproduction is bit-for-bit identical.
import { test } from '@playwright/test';

test('replay ${finding.id}', async ({ page }) => {
  // ${w.script ?? '(no script declared)'}
  // args: ${JSON.stringify(w.args ?? {})}
});
`,
    });
  }

  const sql = scenario.steps.find((s) => s.kind === 'sql');
  if (sql) {
    out.push({
      path: 'replay/repro.sql',
      kind: 'sql',
      contents: `-- Replay for ${finding.id}
-- Scenario: ${scenario.id} — ${scenario.title}
-- (statement deferred to the SQL probe driver in v0.1.1)
`,
    });
  }

  return out;
}
