import { createHash } from 'node:crypto';
import type { ScenarioRunResult } from './run.js';

/** Compute the identity of the observed defect, independent of finding IDs. */
export function failureFingerprint(result: ScenarioRunResult): string | undefined {
  const failed = result.oracles
    .filter((oracle) => !oracle.passed)
    .map((oracle) => ({ oracle_id: oracle.oracle_id, reason: oracle.reason }))
    .sort((a, b) => a.oracle_id.localeCompare(b.oracle_id));
  if (failed.length === 0) return undefined;
  return createHash('sha256')
    .update(JSON.stringify({ scenario_id: result.scenario_id, failed }))
    .digest('hex');
}
