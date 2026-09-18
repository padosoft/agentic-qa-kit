import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calibrateSimilarityHoldout,
  calibrateSimilarityThreshold,
  clusterFindings,
  clusterFindingsBySimilarity,
  evaluateSimilarityCalibration,
  priorityOf,
  rootCauseId,
  signatureOf,
  splitSimilarityCalibrationHoldout,
} from '../dist/index.js';

const base = {
  schema_version: '1' as const,
  run_id: 'run-a',
  scenario_id: 'scn-1',
  risk_id: 'r-1',
  status: 'draft' as const,
  execution_mode: 'orchestrator' as const,
  confidence: 0.5,
  confidence_components: {},
  reproducibility: {},
  verification_floor: 'scenario_level' as const,
  evidence: [],
  tags: [],
};

describe('signatureOf', () => {
  it('two findings with the same scenario/risk/summary share a signature', () => {
    const a = {
      ...base,
      id: 'AQA-2026-0001',
      title: 't',
      summary: 'Token still valid 120s after rotation',
      severity: 'critical' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const b = {
      ...base,
      id: 'AQA-2026-0002',
      run_id: 'run-b',
      title: 't',
      summary: 'Token still valid 999s after rotation',
      severity: 'critical' as const,
      discovered_at: '2026-05-17T11:00:00Z',
    };
    assert.equal(signatureOf(a), signatureOf(b));
  });

  it('different risks → different signatures', () => {
    const a = {
      ...base,
      id: 'AQA-2026-0001',
      title: 't',
      summary: 's',
      severity: 'high' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const b = { ...a, risk_id: 'r-different' };
    assert.notEqual(signatureOf(a), signatureOf(b));
  });
});

describe('clusterFindings', () => {
  it('groups identical signatures and picks the earliest representative', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        title: 't',
        summary: 'x',
        severity: 'high' as const,
        discovered_at: '2026-05-17T12:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        run_id: 'run-b',
        title: 't',
        summary: 'x',
        severity: 'high' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.representative.id, 'AQA-2026-0002');
  });

  it('cluster severity is the worst among members', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        title: 't',
        summary: 'x',
        severity: 'medium' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        run_id: 'run-b',
        title: 't',
        summary: 'x',
        severity: 'critical' as const,
        discovered_at: '2026-05-17T11:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters[0]?.severity, 'critical');
  });

  it('output is sorted by severity (critical first)', () => {
    const fs = [
      {
        ...base,
        id: 'AQA-2026-0001',
        scenario_id: 'a',
        risk_id: 'r-a',
        title: 't',
        summary: 's',
        severity: 'low' as const,
        discovered_at: '2026-05-17T10:00:00Z',
      },
      {
        ...base,
        id: 'AQA-2026-0002',
        scenario_id: 'b',
        risk_id: 'r-b',
        title: 't',
        summary: 's',
        severity: 'critical' as const,
        discovered_at: '2026-05-17T11:00:00Z',
      },
    ];
    const clusters = clusterFindings(fs);
    assert.equal(clusters[0]?.severity, 'critical');
    assert.equal(clusters[1]?.severity, 'low');
  });

  it('assigns a stable root cause and explainable priority', () => {
    const finding = {
      ...base,
      id: 'AQA-2026-0001',
      title: 't',
      summary: 'x',
      severity: 'high' as const,
      confidence: 0.8,
      blast_radius: 4,
      cost_to_fix_estimate: 2,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const signature = signatureOf(finding);
    assert.equal(rootCauseId(signature), `root-${signature.slice(0, 24)}`);
    assert.equal(priorityOf(finding), 6.4);
    const cluster = clusterFindings([finding])[0];
    assert.equal(cluster?.root_cause_id, rootCauseId(signature));
    assert.equal(cluster?.priority_score, 6.4);
  });

  it('links semantically similar findings only within the same risk and explains the edge', () => {
    const first = {
      ...base,
      id: 'AQA-2026-0001',
      scenario_id: 'login-a',
      title: 'Expired session remains accepted',
      summary: 'Expired session token remains accepted after logout',
      severity: 'high' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const second = {
      ...first,
      id: 'AQA-2026-0002',
      scenario_id: 'logout-b',
      title: 'Logout does not invalidate session',
      summary: 'Session token remains accepted after logout and expiry',
      discovered_at: '2026-05-17T11:00:00Z',
    };
    const differentRisk = { ...second, id: 'AQA-2026-0003', risk_id: 'r-other' };
    const clusters = clusterFindingsBySimilarity([first, second, differentRisk], {
      threshold: 0,
    });
    const linked = clusters.find((cluster) =>
      cluster.members.some((member) => member.id === first.id),
    );
    assert.equal(linked?.members.length, 2);
    assert.equal(linked?.similarity_edges[0]?.method, 'token');
    assert.equal(linked?.similarity_edges[0]?.left_id, first.id);
    assert.equal(
      clusters.some((cluster) =>
        cluster.members.some(
          (member) => member.id === differentRisk.id && cluster.members.length > 1,
        ),
      ),
      false,
    );
  });

  it('supports operator-owned embeddings with bounded dimensions and fail-closed thresholds', () => {
    const first = {
      ...base,
      id: 'AQA-2026-0001',
      title: 'A meaningful failure summary',
      summary: 'A meaningful failure summary for the payment flow',
      severity: 'medium' as const,
      discovered_at: '2026-05-17T10:00:00Z',
    };
    const second = { ...first, id: 'AQA-2026-0002', discovered_at: '2026-05-17T11:00:00Z' };
    const clusters = clusterFindingsBySimilarity([first, second], {
      threshold: 0.9,
      embed: () => [1, 0, 0],
    });
    assert.equal(clusters[0]?.members.length, 2);
    assert.equal(clusters[0]?.similarity_edges[0]?.method, 'embedding');
    assert.throws(
      () => clusterFindingsBySimilarity([first, second], { threshold: 1.1 }),
      /between 0 and 1/,
    );
    assert.throws(
      () => clusterFindingsBySimilarity([first, second], { embed: () => [Number.NaN] }),
      /finite/,
    );
  });

  it('calibrates similarity thresholds against reviewed pairs and enforces policy', () => {
    const report = calibrateSimilarityThreshold(
      [
        { score: 0.95, same_root_cause: true },
        { score: 0.9, same_root_cause: false },
        { score: 0.4, same_root_cause: true },
        { score: 0.1, same_root_cause: false },
      ],
      0.8,
    );
    assert.deepEqual(
      {
        true_positive: report.true_positive,
        false_positive: report.false_positive,
        false_negative: report.false_negative,
        true_negative: report.true_negative,
      },
      { true_positive: 1, false_positive: 1, false_negative: 1, true_negative: 1 },
    );
    assert.equal(evaluateSimilarityCalibration(report, { min_precision: 0.4 }).passed, true);
    assert.equal(
      evaluateSimilarityCalibration(report, { min_recall: 0.6, max_false_positive_rate: 0.4 })
        .passed,
      false,
    );
    assert.throws(() => calibrateSimilarityThreshold([], 0.8), /requires/);
  });

  it('uses a deterministic unseen holdout for semantic calibration', () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({
      score: index % 2 === 0 ? 0.9 : 0.2,
      same_root_cause: index % 2 === 0,
    }));
    const first = splitSimilarityCalibrationHoldout(samples, 0.3, 'review-corpus-v1');
    const second = splitSimilarityCalibrationHoldout(samples, 0.3, 'review-corpus-v1');
    assert.deepEqual(first, second);
    assert.equal(first.train.length + first.holdout.length, samples.length);
    const report = calibrateSimilarityHoldout(samples, 0.8, 0.3, 'review-corpus-v1', {
      min_precision: 1,
      min_recall: 1,
    });
    assert.equal(report.gate.passed, true);
    assert.match(report.split_digest, /^[a-f0-9]{64}$/u);
    assert.throws(() => splitSimilarityCalibrationHoldout(samples, 0.3, ''), /seed/);
  });
});
