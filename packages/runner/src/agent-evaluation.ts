import { createHash } from 'node:crypto';
import type { AgentModelIdentity } from './trajectory.js';

export interface AgentJudgeVerdict {
  judge_id: string;
  model: AgentModelIdentity;
  passed: boolean;
  score: number;
  /** Hash of the private rationale, never the rationale itself. */
  rationale_sha256?: string;
}

export interface AgentTrial {
  trial_id: string;
  verdicts: readonly AgentJudgeVerdict[];
}

export interface AgentEvaluationPolicy {
  min_judges: number;
  min_trials: number;
  score_threshold?: number;
  min_agreement?: number;
  require_distinct_models?: boolean;
}

export interface AgentEvaluationResult {
  decision: 'pass' | 'fail' | 'inconclusive';
  score: number;
  agreement: number;
  trials_evaluated: number;
  verdicts_evaluated: number;
  model_ids: readonly string[];
  reason: string;
}

export interface CalibrationSample {
  predicted: number;
  expected: boolean;
}

export interface CalibrationReport {
  samples: number;
  brier_score: number;
  expected_calibration_error: number;
  bins: readonly {
    lower: number;
    upper: number;
    count: number;
    mean_predicted: number;
    observed_rate: number;
  }[];
}

function validProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validatePolicy(policy: AgentEvaluationPolicy): Required<AgentEvaluationPolicy> {
  const normalized = {
    min_judges: policy.min_judges,
    min_trials: policy.min_trials,
    score_threshold: policy.score_threshold ?? 0.5,
    min_agreement: policy.min_agreement ?? 2 / 3,
    require_distinct_models: policy.require_distinct_models ?? true,
  };
  if (!Number.isSafeInteger(normalized.min_judges) || normalized.min_judges < 1)
    throw new Error('min_judges must be a positive safe integer');
  if (!Number.isSafeInteger(normalized.min_trials) || normalized.min_trials < 1)
    throw new Error('min_trials must be a positive safe integer');
  if (!validProbability(normalized.score_threshold))
    throw new Error('score_threshold must be between 0 and 1');
  if (!validProbability(normalized.min_agreement) || normalized.min_agreement < 0.5)
    throw new Error('min_agreement must be between 0.5 and 1');
  return normalized;
}

function validateVerdict(verdict: AgentJudgeVerdict): void {
  if (!verdict.judge_id.trim() || !verdict.model.provider.trim() || !verdict.model.model_id.trim())
    throw new Error('judge identity is incomplete');
  if (!validProbability(verdict.score)) throw new Error('judge score must be between 0 and 1');
  if (verdict.rationale_sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(verdict.rationale_sha256))
    throw new Error('rationale_sha256 must be a lowercase SHA-256 digest');
}

/**
 * Evaluate already-produced, opaque judge verdicts without calling an LLM.
 * The evaluator intentionally fails closed when the ensemble is too small,
 * duplicate, or disagrees below the configured threshold.
 */
export function evaluateAgentTrials(
  trials: readonly AgentTrial[],
  policy: AgentEvaluationPolicy,
): AgentEvaluationResult {
  const normalized = validatePolicy(policy);
  if (trials.length < normalized.min_trials) {
    return {
      decision: 'inconclusive',
      score: 0,
      agreement: 0,
      trials_evaluated: trials.length,
      verdicts_evaluated: 0,
      model_ids: [],
      reason: 'minimum trial count was not reached',
    };
  }
  const trialIds = new Set<string>();
  const modelIds = new Set<string>();
  const allVerdicts: AgentJudgeVerdict[] = [];
  const trialDecisions: boolean[] = [];
  for (const trial of trials) {
    if (!trial.trial_id.trim() || trialIds.has(trial.trial_id))
      throw new Error('trial ids must be non-empty and unique');
    trialIds.add(trial.trial_id);
    if (trial.verdicts.length < normalized.min_judges)
      return {
        decision: 'inconclusive',
        score: 0,
        agreement: 0,
        trials_evaluated: trials.length,
        verdicts_evaluated: allVerdicts.length,
        model_ids: [...modelIds].sort(),
        reason: `trial ${trial.trial_id} has too few judge verdicts`,
      };
    const judgeIds = new Set<string>();
    const trialModels = new Set<string>();
    for (const verdict of trial.verdicts) {
      validateVerdict(verdict);
      if (verdict.passed !== verdict.score >= normalized.score_threshold)
        throw new Error(`judge ${verdict.judge_id} passed flag disagrees with score`);
      if (judgeIds.has(verdict.judge_id))
        throw new Error(`duplicate judge in trial ${trial.trial_id}`);
      judgeIds.add(verdict.judge_id);
      const model = `${verdict.model.provider}/${verdict.model.model_id}`;
      trialModels.add(model);
      modelIds.add(model);
      allVerdicts.push(verdict);
    }
    if (normalized.require_distinct_models && trialModels.size < normalized.min_judges)
      return {
        decision: 'inconclusive',
        score: 0,
        agreement: 0,
        trials_evaluated: trials.length,
        verdicts_evaluated: allVerdicts.length,
        model_ids: [...modelIds].sort(),
        reason: `trial ${trial.trial_id} does not have distinct judge models`,
      };
    const passing = trial.verdicts.filter(
      (verdict) => verdict.score >= normalized.score_threshold,
    ).length;
    const failing = trial.verdicts.length - passing;
    const agreement = Math.max(passing, failing) / trial.verdicts.length;
    if (agreement < normalized.min_agreement)
      return {
        decision: 'inconclusive',
        score:
          trial.verdicts.reduce((sum, verdict) => sum + verdict.score, 0) / trial.verdicts.length,
        agreement,
        trials_evaluated: trials.length,
        verdicts_evaluated: allVerdicts.length,
        model_ids: [...modelIds].sort(),
        reason: `trial ${trial.trial_id} judge agreement is below policy`,
      };
    trialDecisions.push(passing > failing);
  }
  const score = allVerdicts.reduce((sum, verdict) => sum + verdict.score, 0) / allVerdicts.length;
  const passedTrials = trialDecisions.filter(Boolean).length;
  const trialAgreement =
    Math.max(passedTrials, trialDecisions.length - passedTrials) / trialDecisions.length;
  const decision =
    trialAgreement >= normalized.min_agreement && passedTrials > trialDecisions.length / 2
      ? 'pass'
      : 'fail';
  return {
    decision,
    score,
    agreement: trialAgreement,
    trials_evaluated: trials.length,
    verdicts_evaluated: allVerdicts.length,
    model_ids: [...modelIds].sort(),
    reason:
      decision === 'pass'
        ? 'ensemble and multi-trial policy satisfied'
        : 'ensemble policy rejected the result',
  };
}

/** Compute calibration metrics for a reviewed gold-label corpus. */
export function calibrateAgentJudges(
  samples: readonly CalibrationSample[],
  binCount = 10,
): CalibrationReport {
  if (!Number.isSafeInteger(binCount) || binCount < 1 || binCount > 100)
    throw new Error('binCount must be an integer between 1 and 100');
  if (samples.length === 0)
    return { samples: 0, brier_score: 0, expected_calibration_error: 0, bins: [] };
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: index / binCount,
    upper: (index + 1) / binCount,
    values: [] as CalibrationSample[],
  }));
  let brier = 0;
  for (const sample of samples) {
    if (!validProbability(sample.predicted))
      throw new Error('calibration prediction must be between 0 and 1');
    const expected = sample.expected ? 1 : 0;
    brier += (sample.predicted - expected) ** 2;
    const index = Math.min(binCount - 1, Math.floor(sample.predicted * binCount));
    bins[index]?.values.push(sample);
  }
  const materialized = bins.map((bin) => {
    const count = bin.values.length;
    const mean =
      count === 0 ? 0 : bin.values.reduce((sum, sample) => sum + sample.predicted, 0) / count;
    const observed =
      count === 0 ? 0 : bin.values.filter((sample) => sample.expected).length / count;
    return {
      lower: bin.lower,
      upper: bin.upper,
      count,
      mean_predicted: mean,
      observed_rate: observed,
    };
  });
  return {
    samples: samples.length,
    brier_score: brier / samples.length,
    expected_calibration_error: materialized.reduce(
      (sum, bin) =>
        sum + (bin.count / samples.length) * Math.abs(bin.mean_predicted - bin.observed_rate),
      0,
    ),
    bins: materialized,
  };
}

export function rationaleSha256(rationale: string): string {
  return createHash('sha256').update(rationale, 'utf8').digest('hex');
}
