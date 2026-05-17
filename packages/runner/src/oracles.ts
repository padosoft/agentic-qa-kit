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
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  error?: string;
}

export type OracleEvaluator = (
  oracle: Scenario.Oracle,
  ctx: { probes: readonly ProbeRunResult[] },
) => OracleResult;

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
  ctx: { probes: readonly ProbeRunResult[] },
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
  return ev(oracle, ctx);
}
