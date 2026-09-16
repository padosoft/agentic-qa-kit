import { randomUUID } from 'node:crypto';
import { Finding, type Scenario } from '@aqa/schemas';
import type { EventChainWriter } from './events.js';
import type { FindingsWriter } from './findings.js';
import { RunLifecycle } from './lifecycle.js';
import { type OracleResult, type ProbeRunResult, evaluateOracle } from './oracles.js';

export interface ScenarioRunResult {
  scenario_id: string;
  probes: readonly ProbeRunResult[];
  cleanup: readonly ProbeRunResult[];
  oracles: readonly OracleResult[];
  finding: Finding.Finding | null;
}

export type ProbeRunner = (probe: Scenario.Probe) => Promise<ProbeRunResult>;

export interface RunScenarioOptions {
  scenario: Scenario.Scenario;
  run_id: string;
  /** Inject the probe runner. Omitting it is an explicit failed execution. */
  probeRunner?: ProbeRunner;
  events?: EventChainWriter;
  findings?: FindingsWriter;
  /** Used to seed Finding.id when oracles fail. */
  findingIdSeed?: number;
}

const MISSING_PROBE_RUNNER: ProbeRunner = async (p) => ({
  probe_id: p.id,
  error: 'no probe runner configured',
});

export interface HttpProbeRunnerOptions {
  baseUrl: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function makeHttpProbeRunner(opts: HttpProbeRunnerOptions): ProbeRunner {
  const base = opts.baseUrl.replace(/\/+$/, '');
  return async (probe) => {
    if (probe.kind !== 'http') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    const withCfg = asRecord(probe.with);
    const rawUrl = typeof withCfg.url === 'string' ? withCfg.url : '';
    if (!rawUrl) return { probe_id: probe.id, error: 'http probe missing with.url' };
    const method = typeof withCfg.method === 'string' ? withCfg.method.toUpperCase() : 'GET';
    const headers =
      withCfg.headers && typeof withCfg.headers === 'object'
        ? (withCfg.headers as Record<string, string>)
        : {};
    const body =
      withCfg.body === undefined
        ? undefined
        : typeof withCfg.body === 'string'
          ? withCfg.body
          : JSON.stringify(withCfg.body);
    const url = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probe.timeout_ms);
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const rawBody = await res.text();
      let parsedBody: unknown = rawBody;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : rawBody;
      } catch {
        // keep text body
      }
      return {
        probe_id: probe.id,
        status: res.status,
        body: parsedBody,
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (e) {
      return {
        probe_id: probe.id,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioRunResult> {
  const runner = opts.probeRunner ?? MISSING_PROBE_RUNNER;
  const probeResults: ProbeRunResult[] = [];
  const execute = async (probe: Scenario.Probe): Promise<ProbeRunResult> => {
    try {
      return await runner(probe);
    } catch (error) {
      return {
        probe_id: probe.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const recordProbe = (probe: Scenario.Probe, r: ProbeRunResult, cleanup: boolean) => {
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'probe_executed',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      payload: { probe_id: probe.id, status: r.status, error: r.error, cleanup },
    });
  };
  for (const probe of opts.scenario.steps) {
    const r = await execute(probe);
    probeResults.push(r);
    recordProbe(probe, r, false);
  }
  const cleanupResults: ProbeRunResult[] = [];
  for (const probe of opts.scenario.cleanup) {
    const r = await execute(probe);
    cleanupResults.push(r);
    recordProbe(probe, r, true);
  }
  const oracleResults: OracleResult[] = [];
  for (const oracle of opts.scenario.oracles) {
    const r = evaluateOracle(oracle, { probes: probeResults });
    oracleResults.push(r);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'oracle_evaluated',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      payload: { oracle_id: oracle.id, passed: r.passed, reason: r.reason },
    });
  }
  const failed = oracleResults.filter((o) => !o.passed);
  let finding: Finding.Finding | null = null;
  if (failed.length > 0) {
    const year = new Date().getUTCFullYear();
    // The human-readable code must remain schema-compatible, but it cannot
    // be based on the scenario position: that value repeats on every run and
    // causes a durable store keyed by finding.id to overwrite findings.
    // UUID entropy gives each occurrence a globally unique code while the
    // legacy four-digit prefix remains accepted for imported fixtures.
    const seed = randomUUID().replace(/\D/g, '').slice(0, 20).padEnd(20, '0');
    const agreement = oracleResults.length
      ? oracleResults.reduce((s, o) => s + o.agreement, 0) / oracleResults.length
      : 0;
    finding = Finding.Finding.parse({
      schema_version: '1',
      id: `AQA-${year}-${seed}`,
      run_id: opts.run_id,
      scenario_id: opts.scenario.id,
      risk_id: opts.scenario.risk_refs[0],
      title: `${opts.scenario.title} — oracle(s) failed`,
      summary: failed.map((f) => `[${f.oracle_id}] ${f.reason}`).join('; '),
      severity: 'high',
      status: 'draft',
      execution_mode: 'orchestrator',
      discovered_at: new Date().toISOString(),
      confidence: agreement,
      confidence_components: { oracle_agreement: agreement },
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
    });
    opts.findings?.append(finding);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'finding_emitted',
      actor: { type: 'orchestrator', id: 'runner' },
      scenario_id: opts.scenario.id,
      finding_id: finding.id,
      payload: { severity: finding.severity },
    });
  }
  return {
    scenario_id: opts.scenario.id,
    probes: probeResults,
    cleanup: cleanupResults,
    oracles: oracleResults,
    finding,
  };
}

export { RunLifecycle };
