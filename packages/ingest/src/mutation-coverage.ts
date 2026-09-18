import type { MutationReport } from './index.js';

export interface MutationCoverageLink {
  mutation_id: string;
  risk_ids: ReadonlyArray<string>;
  scenario_ids: ReadonlyArray<string>;
}

export interface MutationCoverageManifest {
  schema_version: '1';
  links: ReadonlyArray<MutationCoverageLink>;
}

export interface MutationCoveragePolicy {
  min_mapped_rate: number;
  min_killed_rate: number;
}

export interface MutationRiskCoverage {
  risk_id: string;
  evaluated_mutants: number;
  killed_mutants: number;
  mutation_score: number;
  scenario_ids: ReadonlyArray<string>;
}

export interface MutationCoverageResult {
  passed: boolean;
  evaluated_mutants: number;
  mapped_mutants: number;
  unmapped_mutant_ids: ReadonlyArray<string>;
  mapped_rate: number;
  killed_rate: number;
  risk_coverage: ReadonlyArray<MutationRiskCoverage>;
  violations: ReadonlyArray<string>;
}

const MAX_LINKS = 100_000;

function boundedId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value))
    throw new Error(`${field} must be a bounded identifier`);
  return value;
}

function ids(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128)
    throw new Error(`${field} must contain 1..128 identifiers`);
  const output = value.map((item, index) => boundedId(item, `${field}[${index}]`));
  if (new Set(output).size !== output.length) throw new Error(`${field} contains duplicates`);
  return output;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

/** Validate a reviewed mapping from mutations to the regressions that kill them. */
export function parseMutationCoverageManifest(value: unknown): MutationCoverageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('mutation coverage manifest must be an object');
  const root = value as Record<string, unknown>;
  if (root.schema_version !== '1') throw new Error('mutation coverage schema_version must be "1"');
  if (!Array.isArray(root.links) || root.links.length === 0 || root.links.length > MAX_LINKS)
    throw new Error(`mutation coverage links must contain 1..${MAX_LINKS} links`);
  const seen = new Set<string>();
  const links = root.links.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error(`mutation coverage link ${index} must be an object`);
    const link = raw as Record<string, unknown>;
    const mutationId = boundedId(link.mutation_id, `mutation coverage link ${index} mutation_id`);
    if (seen.has(mutationId)) throw new Error(`duplicate mutation coverage link: ${mutationId}`);
    seen.add(mutationId);
    return {
      mutation_id: mutationId,
      risk_ids: ids(link.risk_ids, `mutation coverage link ${index} risk_ids`),
      scenario_ids: ids(link.scenario_ids, `mutation coverage link ${index} scenario_ids`),
    };
  });
  return { schema_version: '1', links };
}

/** Apply explicit mapping and kill-rate policy to an external mutation report. */
export function evaluateMutationCoverage(
  report: MutationReport,
  manifest: MutationCoverageManifest,
  policy: MutationCoveragePolicy,
): MutationCoverageResult {
  if (
    !Number.isFinite(policy.min_mapped_rate) ||
    !Number.isFinite(policy.min_killed_rate) ||
    policy.min_mapped_rate < 0 ||
    policy.min_mapped_rate > 1 ||
    policy.min_killed_rate < 0 ||
    policy.min_killed_rate > 1
  )
    throw new Error('mutation coverage policy values must be between 0 and 1');
  const records = report.records.filter((record) => record.status !== 'ignored');
  const reportIds = new Set(records.map((record) => record.id));
  const links = new Map<string, MutationCoverageLink>();
  for (const link of manifest.links) {
    if (!reportIds.has(link.mutation_id))
      throw new Error(`mutation coverage references unknown mutant: ${link.mutation_id}`);
    links.set(link.mutation_id, link);
  }
  const unmapped = records.filter((record) => !links.has(record.id)).map((record) => record.id);
  const mapped = records.filter((record) => links.has(record.id));
  const killed = mapped.filter((record) => record.status === 'killed').length;
  const riskMap = new Map<string, { total: number; killed: number; scenarios: Set<string> }>();
  for (const record of mapped) {
    const link = links.get(record.id) as MutationCoverageLink;
    for (const riskId of link.risk_ids) {
      const current = riskMap.get(riskId) ?? { total: 0, killed: 0, scenarios: new Set<string>() };
      current.total += 1;
      if (record.status === 'killed') current.killed += 1;
      for (const scenarioId of link.scenario_ids) current.scenarios.add(scenarioId);
      riskMap.set(riskId, current);
    }
  }
  const mappedRate = ratio(mapped.length, records.length);
  const killedRate = ratio(killed, mapped.length);
  const violations: string[] = [];
  if (mappedRate < policy.min_mapped_rate)
    violations.push('mutation mapping rate is below the configured minimum');
  if (killedRate < policy.min_killed_rate)
    violations.push('mapped mutation kill rate is below the configured minimum');
  return {
    passed: violations.length === 0 && records.length > 0,
    evaluated_mutants: records.length,
    mapped_mutants: mapped.length,
    unmapped_mutant_ids: unmapped,
    mapped_rate: mappedRate,
    killed_rate: killedRate,
    risk_coverage: [...riskMap.entries()].map(([riskId, value]) => ({
      risk_id: riskId,
      evaluated_mutants: value.total,
      killed_mutants: value.killed,
      mutation_score: ratio(value.killed, value.total),
      scenario_ids: [...value.scenarios].sort(),
    })),
    violations,
  };
}
