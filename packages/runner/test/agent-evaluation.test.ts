import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AgentTrial,
  calibrateAgentJudges,
  evaluateAgentTrials,
  rationaleSha256,
} from '../dist/index.js';

const model = (id: string) => ({ provider: 'fixture' as const, model_id: id });

function trials(scores: number[]): AgentTrial[] {
  return scores.map((score, index) => ({
    trial_id: `trial-${index + 1}`,
    verdicts: [
      { judge_id: `judge-a-${index}`, model: model('a'), passed: score >= 0.5, score },
      { judge_id: `judge-b-${index}`, model: model('b'), passed: score >= 0.5, score },
      { judge_id: `judge-c-${index}`, model: model('c'), passed: score >= 0.5, score },
    ],
  }));
}

test('evaluates distinct-model ensembles across multiple trials', () => {
  const result = evaluateAgentTrials(trials([0.9, 0.8, 0.7]), {
    min_judges: 3,
    min_trials: 3,
  });
  assert.equal(result.decision, 'pass');
  assert.equal(result.agreement, 1);
  assert.deepEqual(result.model_ids, ['fixture/a', 'fixture/b', 'fixture/c']);
});

test('fails closed when trials are missing or judges disagree', () => {
  assert.equal(
    evaluateAgentTrials(trials([0.9]), { min_judges: 3, min_trials: 2 }).decision,
    'inconclusive',
  );
  const disagree = trials([0.9]);
  const firstTrial = disagree[0];
  assert.ok(firstTrial);
  firstTrial.verdicts[2] = {
    judge_id: 'judge-c-0',
    model: model('c'),
    passed: false,
    score: 0.1,
  };
  assert.equal(
    evaluateAgentTrials(disagree, { min_judges: 3, min_trials: 1, min_agreement: 1 }).decision,
    'inconclusive',
  );
  const inconsistent = trials([0.9]);
  const inconsistentVerdict = inconsistent[0]?.verdicts[0];
  assert.ok(inconsistentVerdict);
  const inconsistentTrial = inconsistent[0];
  assert.ok(inconsistentTrial);
  inconsistentTrial.verdicts[0] = { ...inconsistentVerdict, passed: false };
  assert.throws(() => evaluateAgentTrials(inconsistent, { min_judges: 3, min_trials: 1 }));
});

test('computes bounded calibration metrics without storing rationales', () => {
  const report = calibrateAgentJudges([
    { predicted: 0.9, expected: true },
    { predicted: 0.1, expected: false },
    { predicted: 0.6, expected: true },
    { predicted: 0.4, expected: false },
  ]);
  assert.equal(report.samples, 4);
  assert.ok(Math.abs(report.brier_score - 0.085) < 1e-12);
  assert.ok(Math.abs(report.expected_calibration_error - 0.25) < 1e-12);
  assert.equal(rationaleSha256('private rationale').length, 64);
  assert.throws(() => calibrateAgentJudges([{ predicted: 2, expected: true }]));
});
