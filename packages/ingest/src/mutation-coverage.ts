import { createHash } from 'node:crypto';
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

export interface MutationHoldoutSplitOptions {
  holdout_rate: number;
  split_key: string;
  min_train_links?: number;
  min_holdout_links?: number;
}

export interface MutationHoldoutSplit {
  schema_version: '1';
  split_key: string;
  plan_digest: string;
  train: MutationCoverageManifest;
  holdout: MutationCoverageManifest;
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

export interface MutationRegressionObservation {
  mutation_id: string;
  scenario_id: string;
  run_id: string;
  outcome: 'killed' | 'survived';
}

export interface MutationRegressionEvidence {
  schema_version: '1';
  source_revision: string;
  observations: ReadonlyArray<MutationRegressionObservation>;
}

export interface MutationRegressionCoverageResult {
  passed: boolean;
  expected_pairs: number;
  observed_pairs: number;
  killed_mutants: number;
  evaluated_mutants: number;
  missing_pairs: ReadonlyArray<string>;
  mismatched_mutant_ids: ReadonlyArray<string>;
  kill_rate: number;
  violations: ReadonlyArray<string>;
}

const MAX_LINKS = 100_000;
const MAX_OBSERVATIONS = 100_000;

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

function boundedRevision(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw new Error('mutation regression source_revision must be bounded');
  return value;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

/** Create a reproducible, digest-bound split without executing mutations. */
export function splitMutationCoverageHoldout(
  manifest: MutationCoverageManifest,
  options: MutationHoldoutSplitOptions,
): MutationHoldoutSplit {
  if (
    !Number.isFinite(options.holdout_rate) ||
    options.holdout_rate < 0 ||
    options.holdout_rate > 1 ||
    !options.split_key.trim()
  )
    throw new Error('mutation holdout options are invalid');
  const minTrain = boundedCount(options.min_train_links ?? 1, 'min_train_links');
  const minHoldout = boundedCount(options.min_holdout_links ?? 1, 'min_holdout_links');
  const links = [...manifest.links];
  if (links.length < minTrain + (options.holdout_rate > 0 ? minHoldout : 0))
    throw new Error('mutation holdout manifest is too small for requested minimums');
  const ranked = links
    .map((link) => ({
      link,
      hash: createHash('sha256').update(`${options.split_key}\0${link.mutation_id}`).digest('hex'),
    }))
    .sort(
      (a, b) =>
        a.hash.localeCompare(b.hash) || a.link.mutation_id.localeCompare(b.link.mutation_id),
    );
  const requested = Math.round(links.length * options.holdout_rate);
  const holdoutCount = Math.min(
    links.length - minTrain,
    options.holdout_rate > 0 ? Math.max(minHoldout, requested) : 0,
  );
  const holdoutIds = new Set(ranked.slice(0, holdoutCount).map((item) => item.link.mutation_id));
  const train = links.filter((link) => !holdoutIds.has(link.mutation_id));
  const holdout = links.filter((link) => holdoutIds.has(link.mutation_id));
  const planDigest = createHash('sha256')
    .update(
      JSON.stringify({
        schema_version: '1',
        split_key: options.split_key,
        train: train.map((link) => link.mutation_id),
        holdout: holdout.map((link) => link.mutation_id),
      }),
    )
    .digest('hex');
  return {
    schema_version: '1',
    split_key: options.split_key,
    plan_digest: planDigest,
    train: { schema_version: '1', links: train },
    holdout: { schema_version: '1', links: holdout },
  };
}

function boundedCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_LINKS)
    throw new Error(`${field} must be a bounded non-negative integer`);
  return value;
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

/** Parse metadata-only evidence produced by an actual regression execution. */
export function parseMutationRegressionEvidence(value: unknown): MutationRegressionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('mutation regression evidence must be an object');
  const root = value as Record<string, unknown>;
  if (root.schema_version !== '1')
    throw new Error('mutation regression evidence schema_version must be "1"');
  if (
    !Array.isArray(root.observations) ||
    root.observations.length === 0 ||
    root.observations.length > MAX_OBSERVATIONS
  )
    throw new Error(`mutation regression observations must contain 1..${MAX_OBSERVATIONS} items`);
  const seen = new Set<string>();
  const observations = root.observations.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error(`mutation regression observation ${index} must be an object`);
    const item = raw as Record<string, unknown>;
    const mutationId = boundedId(
      item.mutation_id,
      `mutation regression observation ${index} mutation_id`,
    );
    const scenarioId = boundedId(
      item.scenario_id,
      `mutation regression observation ${index} scenario_id`,
    );
    const key = `${mutationId}:${scenarioId}`;
    if (seen.has(key)) throw new Error(`duplicate mutation regression observation: ${key}`);
    seen.add(key);
    if (item.outcome !== 'killed' && item.outcome !== 'survived')
      throw new Error(
        `mutation regression observation ${index} outcome must be killed or survived`,
      );
    const runId = boundedId(item.run_id, `mutation regression observation ${index} run_id`);
    return {
      mutation_id: mutationId,
      scenario_id: scenarioId,
      run_id: runId,
      outcome: item.outcome as 'killed' | 'survived',
    };
  });
  return {
    schema_version: '1',
    source_revision: boundedRevision(root.source_revision),
    observations,
  };
}

/** Require every reviewed mutant/scenario pair to have an execution result. */
export function evaluateMutationRegressionEvidence(
  report: MutationReport,
  manifest: MutationCoverageManifest,
  evidence: MutationRegressionEvidence,
  minKillRate: number,
): MutationRegressionCoverageResult {
  if (!Number.isFinite(minKillRate) || minKillRate < 0 || minKillRate > 1)
    throw new Error('mutation regression minimum kill rate must be between 0 and 1');
  const records = report.records.filter((record) => record.status !== 'ignored');
  const recordMap = new Map(records.map((record) => [record.id, record]));
  const links = new Map(manifest.links.map((link) => [link.mutation_id, link]));
  for (const link of manifest.links) {
    if (!recordMap.has(link.mutation_id))
      throw new Error(`mutation coverage references unknown mutant: ${link.mutation_id}`);
  }
  const observed = new Map(
    evidence.observations.map((item) => [`${item.mutation_id}:${item.scenario_id}`, item]),
  );
  for (const item of evidence.observations) {
    const link = links.get(item.mutation_id);
    if (!link || !link.scenario_ids.includes(item.scenario_id))
      throw new Error(
        `mutation regression evidence references an unreviewed pair: ${item.mutation_id}:${item.scenario_id}`,
      );
  }
  const expected: string[] = [];
  const missing: string[] = [];
  const mismatched = new Set<string>();
  let killed = 0;
  for (const record of records) {
    const link = links.get(record.id);
    if (!link) continue;
    let mutantKilled = false;
    for (const scenarioId of link.scenario_ids) {
      const key = `${record.id}:${scenarioId}`;
      expected.push(key);
      const item = observed.get(key);
      if (!item) missing.push(key);
      else if (item.outcome === 'killed') mutantKilled = true;
    }
    if (mutantKilled) killed += 1;
    if ((record.status === 'killed') !== mutantKilled) mismatched.add(record.id);
  }
  const killRate = ratio(killed, records.length);
  const violations: string[] = [];
  if (missing.length > 0)
    violations.push('mutation regression evidence is missing expected scenario executions');
  if (mismatched.size > 0)
    violations.push('mutation report outcomes disagree with regression evidence');
  if (killRate < minKillRate)
    violations.push('mutation regression kill rate is below the configured minimum');
  if (records.length === 0) violations.push('no mutants were evaluated');
  return {
    passed: violations.length === 0,
    expected_pairs: expected.length,
    observed_pairs: expected.length - missing.length,
    killed_mutants: killed,
    evaluated_mutants: records.length,
    missing_pairs: missing,
    mismatched_mutant_ids: [...mismatched].sort(),
    kill_rate: killRate,
    violations,
  };
}
