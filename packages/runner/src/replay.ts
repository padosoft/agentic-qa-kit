import { createHash } from 'node:crypto';
import type { Scenario } from '@aqa/schemas';
import { type ProbeRunner, type ScenarioRunResult, runScenario } from './run.js';

export interface VerifyOptions {
  scenario: Scenario.Scenario;
  run_id: string;
  attempts: number;
  probeRunner: ProbeRunner;
  /** Fingerprint from the original finding, when replaying a persisted finding. */
  expected_fingerprint?: string;
}

export interface VerifyResult {
  attempts: number;
  successes: number;
  deterministic: boolean;
  /** Per-attempt summary used by the audit log. */
  attempts_detail: ReadonlyArray<{
    index: number;
    finding_present: boolean;
    failure_fingerprint?: string;
  }>;
  fingerprint?: string;
}

function failureFingerprint(result: ScenarioRunResult): string | undefined {
  const failed = result.oracles
    .filter((oracle) => !oracle.passed)
    .map((oracle) => ({ oracle_id: oracle.oracle_id, reason: oracle.reason }))
    .sort((a, b) => a.oracle_id.localeCompare(b.oracle_id));
  if (failed.length === 0) return undefined;
  return createHash('sha256')
    .update(JSON.stringify({ scenario_id: result.scenario_id, failed }))
    .digest('hex');
}

/**
 * Re-execute a scenario N times and decide whether the underlying bug
 * reproduces deterministically. The decision rule mirrors `Finding`'s
 * determinism contract: `successes === attempts && attempts >= 1`.
 *
 * "Success" here means "the same failing oracle fires" — i.e. the finding
 * reappears. Use this for `aqa verify <finding-id>`.
 */
export async function verifyScenario(opts: VerifyOptions): Promise<VerifyResult> {
  if (opts.attempts < 1) {
    throw new Error('[runner.verify] attempts must be >= 1');
  }
  const detail: Array<{
    index: number;
    finding_present: boolean;
    failure_fingerprint?: string;
  }> = [];
  let successes = 0;
  let observedFingerprint: string | undefined;
  for (let i = 0; i < opts.attempts; i += 1) {
    const result: ScenarioRunResult = await runScenario({
      scenario: opts.scenario,
      run_id: `${opts.run_id}-verify-${i}`,
      probeRunner: opts.probeRunner,
    });
    const present = result.finding !== null;
    const fingerprint = present ? failureFingerprint(result) : undefined;
    detail.push({
      index: i,
      finding_present: present,
      ...(fingerprint ? { failure_fingerprint: fingerprint } : {}),
    });
    if (fingerprint && observedFingerprint === undefined) observedFingerprint = fingerprint;
    if (
      fingerprint !== undefined &&
      fingerprint === observedFingerprint &&
      (opts.expected_fingerprint === undefined || fingerprint === opts.expected_fingerprint)
    ) {
      successes += 1;
    }
  }
  return {
    attempts: opts.attempts,
    successes,
    deterministic: successes === opts.attempts && opts.attempts >= 1,
    attempts_detail: detail,
    ...(observedFingerprint ? { fingerprint: observedFingerprint } : {}),
  };
}
