import {
  type ShrinkOptions,
  type ShrinkableJson,
  shrinkJsonCounterexample,
} from '@aqa/methodology';
import { redactJson } from '@aqa/observability';
import type { Finding, Scenario } from '@aqa/schemas';
import type { ReplayArtifact } from './replay.js';

export type MinimizedCounterexampleInput<T extends ShrinkableJson> = {
  finding: Finding.Finding;
  scenario: Scenario.Scenario;
  counterexample: T;
  stillFails: (candidate: T) => boolean | Promise<boolean>;
  options?: ShrinkOptions;
};

export type MinimizedCounterexampleResult = {
  artifact: ReplayArtifact;
  finding_evidence: string;
  attempts: number;
  reductions: number;
  complete: boolean;
};

/**
 * Minimize a finding's JSON counterexample and bind the redacted artifact to
 * its replay identity. Execution remains caller-owned; this helper only runs
 * the supplied failure predicate and never sends a request or logs a value.
 */
export async function buildMinimizedCounterexampleReplay<T extends ShrinkableJson>(
  input: MinimizedCounterexampleInput<T>,
): Promise<MinimizedCounterexampleResult> {
  const result = await shrinkJsonCounterexample(
    input.counterexample,
    input.stillFails,
    input.options,
  );
  const payload = {
    schema_version: '1',
    finding_id: input.finding.id,
    run_id: input.finding.run_id,
    scenario_id: input.scenario.id,
    source: 'aqa-bounded-json-shrinker',
    attempts: result.attempts,
    reductions: result.reductions,
    complete: result.complete,
    counterexample: result.value,
  };
  const contents = `${JSON.stringify(redactJson(payload), null, 2)}\n`;
  const artifactPath = `replay/counterexample.${input.finding.id}.min.json`;
  return {
    artifact: { path: artifactPath, kind: 'json', contents },
    finding_evidence: artifactPath,
    attempts: result.attempts,
    reductions: result.reductions,
    complete: result.complete,
  };
}
