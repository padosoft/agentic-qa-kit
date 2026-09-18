import { randomUUID } from 'node:crypto';
import { type TraceContext, formatTraceParent } from '@aqa/observability';
import { Finding, type RiskMap, type Scenario } from '@aqa/schemas';
import type { EventChainWriter } from './events.js';
import type { FindingsWriter } from './findings.js';
import { failureFingerprint } from './fingerprint.js';
import { RunLifecycle } from './lifecycle.js';
import { type OracleResult, type ProbeRunResult, evaluateOracle } from './oracles.js';

export interface ScenarioRunResult {
  scenario_id: string;
  outcome: 'pass' | 'fail' | 'error' | 'blocked' | 'not_run';
  execution_status: 'completed' | 'failed';
  execution_error?: string;
  probes: readonly ProbeRunResult[];
  cleanup: readonly ProbeRunResult[];
  oracles: readonly OracleResult[];
  finding: Finding.Finding | null;
}

export type ProbeRunner = (probe: Scenario.Probe, signal?: AbortSignal) => Promise<ProbeRunResult>;

export interface RunScenarioOptions {
  scenario: Scenario.Scenario;
  run_id: string;
  /** Execution identity used for audit events and finding provenance. */
  execution_mode?: 'orchestrator' | 'agent';
  /** Inject the probe runner. Omitting it is an explicit failed execution. */
  probeRunner?: ProbeRunner;
  /**
   * Optional capability declaration for the configured driver. When present,
   * unsupported steps fail in a preflight pass before any probe or cleanup can
   * cause side effects.
   */
  supportedProbeKinds?: ReadonlySet<Scenario.ProbeKind>;
  events?: EventChainWriter;
  findings?: FindingsWriter;
  /** Used to seed Finding.id when oracles fail. */
  findingIdSeed?: number;
  /** Resolved risk declaration used to derive finding severity and risk_id. */
  risk?: RiskMap.Risk;
  /** Cooperative cancellation signal owned by the worker/orchestrator. */
  signal?: AbortSignal;
}

const MISSING_PROBE_RUNNER: ProbeRunner = async (p) => ({
  probe_id: p.id,
  error: 'no probe runner configured',
});

export interface HttpProbeRunnerOptions {
  baseUrl: string;
  /** Origins allowed for absolute URLs; defaults to the base URL origin. */
  allowed_origins?: string[];
  /** Maximum response body size retained as evidence. */
  max_response_bytes?: number;
  /** Optional W3C context propagated to the target as `traceparent`. */
  trace_context?: TraceContext;
  /** Secret values injected by the host; never read from pack content or logged. */
  secrets?: Readonly<Record<string, string>>;
}

function normalizeAllowedOrigins(origins: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const raw of origins) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`invalid HTTP allowlist origin: ${raw}`);
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`HTTP allowlist entry must be an origin without credentials or path: ${raw}`);
    }
    normalized.add(parsed.origin);
  }
  if (normalized.size === 0) throw new Error('HTTP origin allowlist must not be empty');
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function makeHttpProbeRunner(opts: HttpProbeRunnerOptions): ProbeRunner {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const baseUrl = new URL(opts.baseUrl);
  if (baseUrl.username || baseUrl.password) {
    throw new Error('HTTP baseUrl must not contain credentials');
  }
  const allowedOrigins = normalizeAllowedOrigins(opts.allowed_origins ?? [baseUrl.origin]);
  const maxResponseBytes = opts.max_response_bytes ?? 1_048_576;
  const traceparent = opts.trace_context ? formatTraceParent(opts.trace_context) : undefined;
  return async (probe, externalSignal) => {
    if (probe.kind !== 'http') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    const withCfg = asRecord(probe.with);
    const supportedFields = new Set(['method', 'url', 'headers', 'body', 'auth']);
    const unsupportedField = Object.keys(withCfg).find((key) => !supportedFields.has(key));
    if (unsupportedField) {
      return {
        probe_id: probe.id,
        error: `unsupported HTTP probe field "${unsupportedField}"; use an explicit supported driver contract`,
      };
    }
    const rawUrl = typeof withCfg.url === 'string' ? withCfg.url : '';
    if (!rawUrl) return { probe_id: probe.id, error: 'http probe missing with.url' };
    const method = typeof withCfg.method === 'string' ? withCfg.method.toUpperCase() : 'GET';
    const probeHeaders =
      withCfg.headers && typeof withCfg.headers === 'object'
        ? (withCfg.headers as Record<string, string>)
        : {};
    const headers: Record<string, string> = {
      ...probeHeaders,
      ...(traceparent ? { traceparent } : {}),
    };
    if (withCfg.auth !== undefined) {
      if (
        typeof withCfg.auth !== 'string' ||
        !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(withCfg.auth)
      ) {
        return { probe_id: probe.id, error: 'http probe auth must be a named secret reference' };
      }
      const secretName = withCfg.auth.slice(2, -1);
      const token = opts.secrets?.[secretName];
      if (!token) {
        return { probe_id: probe.id, error: `http probe secret "${secretName}" is unavailable` };
      }
      headers.authorization = `Bearer ${token}`;
    }
    const body =
      withCfg.body === undefined
        ? undefined
        : typeof withCfg.body === 'string'
          ? withCfg.body
          : JSON.stringify(withCfg.body);
    const url = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : `${base}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    let origin: string;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.username || parsedUrl.password) {
        return { probe_id: probe.id, error: 'http probe URL must not contain credentials' };
      }
      origin = parsedUrl.origin;
    } catch {
      return { probe_id: probe.id, error: 'http probe URL is invalid' };
    }
    if (!allowedOrigins.has(origin)) {
      return { probe_id: probe.id, error: `http probe origin is not allowlisted: ${origin}` };
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
      return { probe_id: probe.id, error: 'max_response_bytes must be a positive integer' };
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) {
      return { probe_id: probe.id, error: 'HTTP probe cancelled before dispatch' };
    }
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), probe.timeout_ms);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) {
          try {
            const redirectUrl = new URL(location, url);
            if (
              redirectUrl.username ||
              redirectUrl.password ||
              !allowedOrigins.has(redirectUrl.origin)
            ) {
              return {
                probe_id: probe.id,
                status: res.status,
                headers: Object.fromEntries(res.headers.entries()),
                error: 'http redirect target is not allowlisted; automatic redirects are disabled',
              };
            }
          } catch {
            return {
              probe_id: probe.id,
              status: res.status,
              error: 'http redirect location is invalid',
            };
          }
        }
        return {
          probe_id: probe.id,
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          error: 'http redirects are disabled by policy',
        };
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > maxResponseBytes) {
            await reader.cancel();
            return { probe_id: probe.id, error: `response body exceeds ${maxResponseBytes} bytes` };
          }
          chunks.push(next.value);
        }
      }
      const rawBody = new TextDecoder().decode(
        chunks.length === 1
          ? chunks[0]
          : chunks.reduce((all, chunk) => {
              const joined = new Uint8Array(all.length + chunk.length);
              joined.set(all);
              joined.set(chunk, all.length);
              return joined;
            }, new Uint8Array()),
      );
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
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}

export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioRunResult> {
  const actor =
    opts.execution_mode === 'agent'
      ? { type: 'agent' as const, id: 'agent-driver' }
      : { type: 'orchestrator' as const, id: 'runner' };
  const runner = opts.probeRunner ?? MISSING_PROBE_RUNNER;
  const probeResults: ProbeRunResult[] = [];
  const execute = async (probe: Scenario.Probe): Promise<ProbeRunResult> => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    opts.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, probe.timeout_ms);
    try {
      const result = await runner(probe, controller.signal);
      if (timedOut) {
        return {
          probe_id: probe.id,
          execution_status: 'failed',
          error: `probe timed out after ${probe.timeout_ms}ms`,
        };
      }
      if (opts.signal?.aborted) {
        return { probe_id: probe.id, execution_status: 'failed', error: 'probe cancelled' };
      }
      return { ...result, execution_status: result.error ? 'failed' : 'completed' };
    } catch (error) {
      return {
        probe_id: probe.id,
        execution_status: 'failed',
        error: timedOut
          ? `probe timed out after ${probe.timeout_ms}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', abortFromCaller);
    }
  };
  const recordProbe = (probe: Scenario.Probe, r: ProbeRunResult, cleanup: boolean) => {
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'probe_executed',
      actor,
      scenario_id: opts.scenario.id,
      payload: {
        probe_id: probe.id,
        status: r.status,
        execution_status: r.execution_status,
        error: r.error,
        cleanup,
      },
    });
  };
  const unsupportedSteps = opts.supportedProbeKinds
    ? opts.scenario.steps.filter((probe) => !opts.supportedProbeKinds?.has(probe.kind))
    : [];
  const unsupportedCleanup = opts.supportedProbeKinds
    ? opts.scenario.cleanup.filter((probe) => !opts.supportedProbeKinds?.has(probe.kind))
    : [];
  if (unsupportedSteps.length > 0 || unsupportedCleanup.length > 0) {
    const preflight = (probe: Scenario.Probe) => ({
      probe_id: probe.id,
      execution_status: 'failed' as const,
      error: `probe kind "${probe.kind}" is not supported by the configured driver`,
    });
    const preflightResults = unsupportedSteps.map(preflight);
    const cleanupResults = unsupportedCleanup.map(preflight);
    for (const [index, probe] of unsupportedSteps.entries()) {
      const result = preflightResults[index];
      if (result) recordProbe(probe, result, false);
    }
    for (const [index, probe] of unsupportedCleanup.entries()) {
      const result = cleanupResults[index];
      if (result) recordProbe(probe, result, true);
    }
    const oracleResults = opts.scenario.oracles.map((oracle) => {
      const result = evaluateOracle(oracle, { probes: preflightResults });
      opts.events?.append({
        ts: new Date().toISOString(),
        run_id: opts.run_id,
        kind: 'oracle_evaluated',
        actor,
        scenario_id: opts.scenario.id,
        payload: { oracle_id: oracle.id, passed: result.passed, reason: result.reason },
      });
      return result;
    });
    const preflightError = preflightResults[0]?.error ?? cleanupResults[0]?.error;
    const preflightResult: ScenarioRunResult = {
      scenario_id: opts.scenario.id,
      outcome: 'blocked',
      execution_status: 'failed',
      probes: preflightResults,
      cleanup: cleanupResults,
      oracles: oracleResults,
      finding: null,
    };
    if (preflightError) preflightResult.execution_error = preflightError;
    return preflightResult;
  }
  let cancelled = false;
  for (const probe of opts.scenario.steps) {
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    const r = await execute(probe);
    probeResults.push(r);
    recordProbe(probe, r, false);
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
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
      actor,
      scenario_id: opts.scenario.id,
      payload: { oracle_id: oracle.id, passed: r.passed, reason: r.reason },
    });
  }
  const failed = oracleResults.filter((o) => !o.passed);
  const executionFailures = [...probeResults, ...cleanupResults].filter(
    (probe) => probe.execution_status === 'failed' || Boolean(probe.error),
  );
  const executionError = cancelled
    ? 'scenario cancelled before all steps completed'
    : executionFailures[0]?.error;
  let finding: Finding.Finding | null = null;
  if (failed.length > 0 && executionFailures.length === 0) {
    const year = new Date().getUTCFullYear();
    // The human-readable code must remain schema-compatible, but it cannot
    // be based on the scenario position: that value repeats on every run and
    // causes a durable store keyed by finding.id to overwrite findings.
    // UUID entropy gives each occurrence a globally unique code while the
    // legacy four-digit prefix remains accepted for imported fixtures.
    const seed = randomUUID().replace(/\D/g, '').slice(0, 20).padEnd(20, '0');
    const weighted = oracleResults.reduce(
      (total, oracle, index) => {
        const weight = opts.scenario.oracles[index]?.weight ?? 1;
        return { score: total.score + oracle.agreement * weight, weight: total.weight + weight };
      },
      { score: 0, weight: 0 },
    );
    const agreement = weighted.weight > 0 ? weighted.score / weighted.weight : 0;
    finding = Finding.Finding.parse({
      schema_version: '1',
      id: `AQA-${year}-${seed}`,
      run_id: opts.run_id,
      scenario_id: opts.scenario.id,
      risk_id: opts.risk?.id ?? opts.scenario.risk_refs[0],
      title: `${opts.scenario.title} — oracle(s) failed`,
      summary: failed.map((f) => `[${f.oracle_id}] ${f.reason}`).join('; '),
      severity: opts.risk?.severity ?? 'high',
      status: 'draft',
      execution_mode: opts.execution_mode ?? 'orchestrator',
      discovered_at: new Date().toISOString(),
      confidence: agreement,
      confidence_components: { oracle_agreement: agreement },
      failure_fingerprint: failureFingerprint({
        scenario_id: opts.scenario.id,
        outcome: 'fail',
        execution_status: 'completed',
        probes: probeResults,
        cleanup: cleanupResults,
        oracles: oracleResults,
        finding: null,
      }),
      reproducibility: {},
      verification_floor: 'scenario_level',
      evidence: [],
    });
    opts.findings?.append(finding);
    opts.events?.append({
      ts: new Date().toISOString(),
      run_id: opts.run_id,
      kind: 'finding_emitted',
      actor,
      scenario_id: opts.scenario.id,
      finding_id: finding.id,
      payload: { severity: finding.severity },
    });
  }
  return {
    scenario_id: opts.scenario.id,
    outcome: cancelled
      ? 'blocked'
      : executionFailures.length > 0
        ? 'error'
        : failed.length > 0
          ? 'fail'
          : 'pass',
    execution_status: cancelled || executionFailures.length > 0 ? 'failed' : 'completed',
    ...(executionError ? { execution_error: executionError } : {}),
    probes: probeResults,
    cleanup: cleanupResults,
    oracles: oracleResults,
    finding,
  };
}

export { RunLifecycle };
