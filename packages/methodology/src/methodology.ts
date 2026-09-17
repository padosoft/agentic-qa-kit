import type { RiskMap } from '@aqa/schemas';

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'InformationDisclosure'
  | 'DenialOfService'
  | 'ElevationOfPrivilege';

const RISK_CATEGORY_TO_STRIDE: Record<RiskMap.Risk['category'], StrideCategory[]> = {
  auth: ['Spoofing', 'ElevationOfPrivilege'],
  data: ['Tampering', 'InformationDisclosure'],
  integrity: ['Tampering'],
  availability: ['DenialOfService'],
  confidentiality: ['InformationDisclosure'],
  integration: ['Tampering', 'DenialOfService'],
  business_logic: ['ElevationOfPrivilege', 'Repudiation'],
  ui_ux: [],
  compliance: ['Repudiation'],
  agentic: ['ElevationOfPrivilege', 'InformationDisclosure'],
};

export function strideOf(risk: RiskMap.Risk): StrideCategory[] {
  return [...RISK_CATEGORY_TO_STRIDE[risk.category]];
}

/**
 * FMEA Risk Priority Number = severity * occurrence * detection.
 *
 * - severity maps 1 (info) … 5 (critical)
 * - occurrence maps 1 (rare) … 5 (almost_certain) from likelihood
 * - detection defaults to 3 (medium) — calibrated by historical false-positive
 *   rate in v0.7 when we have enough data.
 */
const SEV_TO_NUM: Record<RiskMap.Risk['severity'], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const LIKELIHOOD_TO_NUM: Record<RiskMap.Risk['likelihood'], number> = {
  almost_certain: 5,
  likely: 4,
  possible: 3,
  unlikely: 2,
  rare: 1,
};

export interface FmeaScore {
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
}

export function fmeaScore(risk: RiskMap.Risk, detection = 3): FmeaScore {
  const severity = SEV_TO_NUM[risk.severity];
  const occurrence = LIKELIHOOD_TO_NUM[risk.likelihood];
  return { severity, occurrence, detection, rpn: severity * occurrence * detection };
}

/**
 * Extract the OWASP mapping from the risk's tag list. Tags like
 * `owasp:a07`, `owasp-agentic:a01` are recognised.
 */
export function owaspOf(risk: RiskMap.Risk): { web: string[]; agentic: string[] } {
  const web: string[] = [];
  const agentic: string[] = [];
  for (const tag of risk.tags) {
    if (tag.startsWith('owasp-agentic:')) agentic.push(tag.replace('owasp-agentic:', ''));
    else if (tag.startsWith('owasp:')) web.push(tag.replace('owasp:', ''));
  }
  return { web, agentic };
}

export interface MethodologyReport {
  risk_id: string;
  stride: StrideCategory[];
  fmea: FmeaScore;
  owasp: { web: string[]; agentic: string[] };
  /** True if the risk has at least one of (STRIDE category, OWASP mapping). */
  has_framework_anchor: boolean;
}

/**
 * Validate that every risk in the map has at least one external-framework
 * anchor (STRIDE or OWASP). A risk with no anchor is a smell — auditors
 * cannot trace it back to a standard threat catalog.
 */
export function methodologyCheck(map: RiskMap.RiskMap): MethodologyReport[] {
  return map.risks.map((risk) => {
    const stride = strideOf(risk);
    const owasp = owaspOf(risk);
    return {
      risk_id: risk.id,
      stride,
      fmea: fmeaScore(risk),
      owasp,
      has_framework_anchor: stride.length > 0 || owasp.web.length > 0 || owasp.agentic.length > 0,
    };
  });
}

export type AttackTreeOperator = 'all' | 'any';

export interface AttackTreeLeaf {
  id: string;
  kind: 'leaf';
  statement: string;
  risk_refs?: string[];
}

export interface AttackTreeNode {
  id: string;
  kind: 'node';
  operator: AttackTreeOperator;
  children: AttackTree[];
}

export type AttackTree = AttackTreeLeaf | AttackTreeNode;

const ATTACK_TREE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ATTACK_TREE_NODES = 64;
const MAX_ATTACK_TREE_DEPTH = 16;

/** Validate a bounded AND/OR attack tree before it enters evidence storage. */
export function validateAttackTree(tree: AttackTree): void {
  const ids = new Set<string>();
  let count = 0;
  const visit = (current: AttackTree, depth: number): void => {
    count += 1;
    if (count > MAX_ATTACK_TREE_NODES) throw new Error('attack tree exceeds node limit');
    if (depth > MAX_ATTACK_TREE_DEPTH) throw new Error('attack tree exceeds depth limit');
    if (!ATTACK_TREE_ID.test(current.id)) throw new Error(`invalid attack tree id: ${current.id}`);
    if (ids.has(current.id)) throw new Error(`duplicate attack tree id: ${current.id}`);
    ids.add(current.id);
    if (current.kind === 'leaf') {
      if (current.statement.trim().length < 8)
        throw new Error(`attack leaf statement is too short: ${current.id}`);
      return;
    }
    if (current.children.length < 1 || current.children.length > 16)
      throw new Error(`attack tree node must have 1..16 children: ${current.id}`);
    for (const child of current.children) visit(child, depth + 1);
  };
  visit(tree, 0);
}

/** Evaluate whether the supplied compromised leaves satisfy the attack tree. */
export function evaluateAttackTree(
  tree: AttackTree,
  compromisedLeaves: ReadonlySet<string>,
): boolean {
  validateAttackTree(tree);
  const evaluate = (current: AttackTree): boolean =>
    current.kind === 'leaf'
      ? compromisedLeaves.has(current.id)
      : current.operator === 'all'
        ? current.children.every(evaluate)
        : current.children.some(evaluate);
  return evaluate(tree);
}

/** Create a conservative attack-tree skeleton from a risk's declared invariants. */
export function attackTreeForRisk(risk: RiskMap.Risk): AttackTreeNode {
  const rootId = `attack-${risk.id}`.slice(0, 64);
  const leaves = (
    risk.invariants.length ? risk.invariants : [{ id: 'risk', statement: risk.title }]
  ).map((invariant) => ({
    id: `${rootId}-${invariant.id}`.slice(0, 64),
    kind: 'leaf' as const,
    statement: invariant.statement,
    risk_refs: [risk.id],
  }));
  const tree: AttackTreeNode = { id: rootId, kind: 'node', operator: 'any', children: leaves };
  validateAttackTree(tree);
  return tree;
}

export type CoverageStatus = 'covered' | 'partial' | 'gap' | 'stale';

export interface RiskCoverageObservation {
  risk_id: string;
  invariants_count: number;
  invariants_with_scenarios: number;
  scenarios_count: number;
  scenarios_with_oracles: number;
  scenarios_with_deterministic_replay: number;
  last_run_at?: string;
  pass_rate_30d: number;
  flaky_count: number;
}

export interface RiskCoverageReport extends RiskCoverageObservation {
  coverage_score: number;
  status: CoverageStatus;
  drift_alerts: string[];
}

export interface CoverageRunObservation {
  scenario_id: string;
  executed_at: string;
  passed: boolean;
  deterministic_replay?: boolean;
}

export interface RiskCoverageInput {
  risk_map: RiskMap.RiskMap;
  scenarios: ReadonlyArray<{
    id: string;
    risk_refs: ReadonlyArray<string>;
    invariant_refs: ReadonlyArray<string>;
    oracles: ReadonlyArray<unknown>;
  }>;
  runs: ReadonlyArray<CoverageRunObservation>;
  now?: Date;
}

/** Derive coverage observations from declarations and run evidence. */
export function measureRiskCoverage(input: RiskCoverageInput): RiskCoverageReport[] {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - 30 * 86_400_000;
  return input.risk_map.risks.map((risk) => {
    const scenarios = input.scenarios.filter((scenario) => scenario.risk_refs.includes(risk.id));
    const linkedInvariants = new Set(scenarios.flatMap((scenario) => scenario.invariant_refs));
    const runs = input.runs.filter(
      (run) =>
        scenarios.some((scenario) => scenario.id === run.scenario_id) &&
        Number.isFinite(Date.parse(run.executed_at)),
    );
    const recentRuns = runs.filter((run) => Date.parse(run.executed_at) >= cutoff);
    const byScenario = new Map<string, CoverageRunObservation[]>();
    for (const run of runs) {
      const history = byScenario.get(run.scenario_id) ?? [];
      history.push(run);
      byScenario.set(run.scenario_id, history);
    }
    let flakyCount = 0;
    let deterministicReplayCount = 0;
    let lastRunAt: string | undefined;
    for (const history of byScenario.values()) {
      if (history.some((run) => run.passed) && history.some((run) => !run.passed)) flakyCount += 1;
      if (history.some((run) => run.deterministic_replay === true)) deterministicReplayCount += 1;
      for (const run of history) {
        if (lastRunAt === undefined || Date.parse(run.executed_at) > Date.parse(lastRunAt))
          lastRunAt = run.executed_at;
      }
    }
    return riskCoverage(
      {
        risk_id: risk.id,
        invariants_count: risk.invariants.length,
        invariants_with_scenarios: risk.invariants.filter((invariant) =>
          linkedInvariants.has(invariant.id),
        ).length,
        scenarios_count: scenarios.length,
        scenarios_with_oracles: scenarios.filter((scenario) => scenario.oracles.length > 0).length,
        scenarios_with_deterministic_replay: deterministicReplayCount,
        ...(lastRunAt ? { last_run_at: lastRunAt } : {}),
        pass_rate_30d:
          recentRuns.length === 0
            ? 0
            : recentRuns.filter((run) => run.passed).length / recentRuns.length,
        flaky_count: flakyCount,
      },
      now,
    );
  });
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function validateCoverageObservation(observation: RiskCoverageObservation): void {
  const counts = [
    observation.invariants_count,
    observation.invariants_with_scenarios,
    observation.scenarios_count,
    observation.scenarios_with_oracles,
    observation.scenarios_with_deterministic_replay,
    observation.flaky_count,
  ];
  if (counts.some((value) => !Number.isInteger(value) || value < 0))
    throw new Error('coverage counts must be non-negative integers');
  if (
    observation.invariants_with_scenarios > observation.invariants_count ||
    observation.scenarios_with_oracles > observation.scenarios_count ||
    observation.scenarios_with_deterministic_replay > observation.scenarios_count
  )
    throw new Error('coverage numerator cannot exceed denominator');
  if (!Number.isFinite(observation.pass_rate_30d)) throw new Error('pass_rate_30d must be finite');
}

/**
 * Compute the documented coverage score for a risk:
 *
 *   35% invariant mapping + 25% oracle-backed scenarios
 *   + 20% deterministic replay + 10% 30-day pass rate
 *   + 10% flake health (1 when flaky_count is zero).
 *
 * Inputs are observations, not guesses. Missing runs are therefore a gap;
 * callers can persist the result and render it consistently in admin/API.
 */
export function riskCoverage(
  observation: RiskCoverageObservation,
  now = new Date(),
): RiskCoverageReport {
  validateCoverageObservation(observation);
  const invariantCoverage = ratio(
    observation.invariants_with_scenarios,
    observation.invariants_count,
  );
  const oracleCoverage = ratio(observation.scenarios_with_oracles, observation.scenarios_count);
  const replayCoverage = ratio(
    observation.scenarios_with_deterministic_replay,
    observation.scenarios_count,
  );
  const passRate = Math.max(0, Math.min(1, observation.pass_rate_30d));
  const flakeHealth = observation.flaky_count === 0 ? 1 : 0;
  const coverage_score = Number(
    (
      invariantCoverage * 0.35 +
      oracleCoverage * 0.25 +
      replayCoverage * 0.2 +
      passRate * 0.1 +
      flakeHealth * 0.1
    ).toFixed(4),
  );
  const drift_alerts: string[] = [];
  if (observation.invariants_with_scenarios < observation.invariants_count)
    drift_alerts.push('one or more invariants have no linked scenario');
  if (observation.scenarios_with_oracles < observation.scenarios_count)
    drift_alerts.push('one or more scenarios have no oracle');
  if (observation.scenarios_with_deterministic_replay < observation.scenarios_count)
    drift_alerts.push('one or more scenarios lack deterministic replay');
  if (observation.flaky_count > 0)
    drift_alerts.push(`${observation.flaky_count} flaky scenario(s) observed`);

  const lastRun = observation.last_run_at ? Date.parse(observation.last_run_at) : Number.NaN;
  const stale = !Number.isFinite(lastRun) || now.getTime() - lastRun > 30 * 86_400_000;
  if (stale) drift_alerts.push('last successful coverage run is older than 30 days or missing');
  const status: CoverageStatus = stale
    ? 'stale'
    : coverage_score >= 0.9
      ? 'covered'
      : coverage_score > 0
        ? 'partial'
        : 'gap';
  return { ...observation, coverage_score, status, drift_alerts };
}
