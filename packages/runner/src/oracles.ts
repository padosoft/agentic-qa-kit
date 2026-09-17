import type { Scenario } from '@aqa/schemas';

export interface OracleResult {
  oracle_id: string;
  passed: boolean;
  reason: string;
  /** A score in [0,1] used to weight contributions to confidence_components. */
  agreement: number;
}

export interface ProbeRunResult {
  probe_id: string;
  /** Transport/execution outcome; assertion status is represented separately by OracleResult. */
  execution_status?: 'completed' | 'failed';
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  error?: string;
}

export type OracleEvaluator = (
  oracle: Scenario.Oracle,
  ctx: { probes: readonly ProbeRunResult[]; allProbes?: readonly ProbeRunResult[] },
) => OracleResult;

function transportError(ctx: { probes: readonly ProbeRunResult[] }): string | null {
  const failed = ctx.probes.find((probe) => probe.error);
  return failed?.error ? `transport error on probe "${failed.probe_id}": ${failed.error}` : null;
}

function readJsonPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  if (!path.startsWith('$.')) return { found: false };
  const segments = path
    .slice(2)
    .split('.')
    .filter(Boolean)
    .flatMap((segment) => segment.replace(/\[(\d+)\]$/u, '.$1').split('.'));
  let current: unknown = value;
  for (const segment of segments) {
    if (
      current === null ||
      current === undefined ||
      (typeof current !== 'object' && !Array.isArray(current))
    ) {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function referenceValue(
  value: unknown,
  probes: readonly ProbeRunResult[],
): { found: boolean; value?: unknown } {
  if (typeof value !== 'string' || !value.startsWith('@')) return { found: true, value };
  const match = /^@([^\.]+)\.(body|status)(?:\.(.*))?$/u.exec(value);
  if (!match) return { found: false };
  const probe = probes.find((candidate) => candidate.probe_id === match[1]);
  if (!probe) return { found: false };
  const base = match[2] === 'status' ? probe.status : probe.body;
  return match[3] ? readJsonPath(base, `$.${match[3]}`) : { found: true, value: base };
}

const httpStatus: OracleEvaluator = (oracle, ctx) => {
  const expected = Number(oracle.with.expected);
  const last = ctx.probes[ctx.probes.length - 1];
  const passed = last?.status === expected;
  return {
    oracle_id: oracle.id,
    passed,
    reason: passed
      ? `status=${last?.status} matches expected ${expected}`
      : `expected status ${expected}, got ${last?.status ?? 'no probe response'}`,
    agreement: passed ? 1 : 0,
  };
};

const responseContains: OracleEvaluator = (oracle, ctx) => {
  const error = transportError(ctx);
  if (error) {
    return { oracle_id: oracle.id, passed: false, reason: error, agreement: 0 };
  }
  if (typeof oracle.with.jsonpath === 'string') {
    const path = oracle.with.jsonpath;
    const expected = referenceValue(oracle.with.equals, ctx.allProbes ?? ctx.probes);
    const observations = ctx.probes
      .map((probe) => readJsonPath(probe.body, path))
      .filter((item) => item.found);
    const passed =
      expected.found && observations.some((item) => Object.is(item.value, expected.value));
    return {
      oracle_id: oracle.id,
      passed,
      reason: passed
        ? `jsonpath ${path} equals the expected value`
        : `jsonpath ${path} did not equal the expected value`,
      agreement: passed ? 1 : 0,
    };
  }
  if ('equals' in oracle.with) {
    return {
      oracle_id: oracle.id,
      passed: false,
      reason: 'response_contains with.equals requires a valid with.jsonpath',
      agreement: 0,
    };
  }
  const needle = String(oracle.with.value ?? '');
  const haystack = ctx.probes.map((p) => JSON.stringify(p.body ?? '')).join(' ');
  const passed = haystack.includes(needle);
  return {
    oracle_id: oracle.id,
    passed,
    reason: passed ? `body contains "${needle}"` : `body does not contain "${needle}"`,
    agreement: passed ? 1 : 0,
  };
};

const responseNotContains: OracleEvaluator = (oracle, ctx) => {
  const error = transportError(ctx);
  if (error) {
    return { oracle_id: oracle.id, passed: false, reason: error, agreement: 0 };
  }
  const needle = String(oracle.with.value ?? '');
  const haystack = ctx.probes.map((p) => JSON.stringify(p.body ?? '')).join(' ');
  const passed = !haystack.includes(needle);
  return {
    oracle_id: oracle.id,
    passed,
    reason: passed
      ? `body correctly omits "${needle}"`
      : `body contains forbidden value "${needle}"`,
    agreement: passed ? 1 : 0,
  };
};

export const builtInOracles: Record<string, OracleEvaluator> = {
  http_status: httpStatus,
  response_contains: responseContains,
  response_not_contains: responseNotContains,
};

export function evaluateOracle(
  oracle: Scenario.Oracle,
  ctx: { probes: readonly ProbeRunResult[]; allProbes?: readonly ProbeRunResult[] },
  registry: Record<string, OracleEvaluator> = builtInOracles,
): OracleResult {
  const ev = registry[oracle.kind];
  if (!ev) {
    return {
      oracle_id: oracle.id,
      passed: false,
      reason: `unknown oracle kind "${oracle.kind}"`,
      agreement: 0,
    };
  }
  if (!oracle.probe_id) return ev(oracle, ctx);
  const probe = ctx.probes.find((candidate) => candidate.probe_id === oracle.probe_id);
  if (!probe) {
    return {
      oracle_id: oracle.id,
      passed: false,
      reason: `oracle references missing probe "${oracle.probe_id}"`,
      agreement: 0,
    };
  }
  return ev(oracle, { probes: [probe], allProbes: ctx.probes });
}
