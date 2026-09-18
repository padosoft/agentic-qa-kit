import type { Scenario } from '@aqa/schemas';
import { failureFingerprint } from './fingerprint.js';
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
  const targetFingerprint = opts.expected_fingerprint;
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
    const expected = targetFingerprint ?? observedFingerprint;
    if (fingerprint !== undefined && expected !== undefined && fingerprint === expected) {
      successes += 1;
    }
  }
  const result: VerifyResult = {
    attempts: opts.attempts,
    successes,
    deterministic: successes === opts.attempts && opts.attempts >= 1,
    attempts_detail: detail,
  };
  const resultFingerprint = targetFingerprint ?? observedFingerprint;
  return resultFingerprint === undefined ? result : { ...result, fingerprint: resultFingerprint };
}
