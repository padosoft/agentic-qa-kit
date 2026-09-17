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
