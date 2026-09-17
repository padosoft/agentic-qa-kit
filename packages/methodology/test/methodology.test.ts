import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmeaScore, methodologyCheck, owaspOf, riskCoverage, strideOf } from '../dist/index.js';

const RISK_AUTH = {
  id: 'r-auth-x',
  category: 'auth' as const,
  title: 't',
  severity: 'critical' as const,
  likelihood: 'possible' as const,
  invariants: [],
  owners: [],
  tags: ['owasp:a07'],
};

const RISK_AGENTIC = {
  id: 'r-agentic-x',
  category: 'agentic' as const,
  title: 't',
  severity: 'high' as const,
  likelihood: 'likely' as const,
  invariants: [],
  owners: [],
  tags: ['owasp-agentic:a01'],
};

const RISK_UI_NO_ANCHOR = {
  id: 'r-ui-orphan',
  category: 'ui_ux' as const,
  title: 't',
  severity: 'low' as const,
  likelihood: 'unlikely' as const,
  invariants: [],
  owners: [],
  tags: [],
};

describe('strideOf', () => {
  it('auth risks map to Spoofing + EoP', () => {
    const s = strideOf(RISK_AUTH);
    assert.ok(s.includes('Spoofing'));
    assert.ok(s.includes('ElevationOfPrivilege'));
  });
});

describe('fmeaScore', () => {
  it('RPN = severity * occurrence * detection', () => {
    // critical(5) * possible(3) * default 3 = 45
    assert.equal(fmeaScore(RISK_AUTH).rpn, 45);
  });
});

describe('owaspOf', () => {
  it('extracts owasp web + agentic tags', () => {
    assert.deepEqual(owaspOf(RISK_AUTH).web, ['a07']);
    assert.deepEqual(owaspOf(RISK_AGENTIC).agentic, ['a01']);
  });
});

describe('methodologyCheck', () => {
  it('flags risks without any framework anchor', () => {
    const reports = methodologyCheck({
      schema_version: '1',
      project: 'demo',
      risks: [RISK_AUTH, RISK_UI_NO_ANCHOR],
    });
    const orphan = reports.find((r) => r.risk_id === 'r-ui-orphan');
    assert.equal(orphan?.has_framework_anchor, false);
    const anchored = reports.find((r) => r.risk_id === 'r-auth-x');
    assert.equal(anchored?.has_framework_anchor, true);
  });
});

describe('riskCoverage', () => {
  const complete = {
    risk_id: 'r-auth-x',
    invariants_count: 3,
    invariants_with_scenarios: 3,
    scenarios_count: 10,
    scenarios_with_oracles: 10,
    scenarios_with_deterministic_replay: 10,
    last_run_at: '2026-09-16T12:00:00.000Z',
    pass_rate_30d: 0.99,
    flaky_count: 0,
  };

  it('computes the documented score and covered status', () => {
    const report = riskCoverage(complete, new Date('2026-09-17T12:00:00.000Z'));
    assert.equal(report.coverage_score, 0.999);
    assert.equal(report.status, 'covered');
    assert.deepEqual(report.drift_alerts, []);
  });

  it('distinguishes partial gaps from stale evidence', () => {
    const partial = riskCoverage(
      { ...complete, scenarios_with_oracles: 2, scenarios_with_deterministic_replay: 0 },
      new Date('2026-09-17T12:00:00.000Z'),
    );
    assert.equal(partial.status, 'partial');
    assert.ok(partial.drift_alerts.length >= 2);
    const stale = riskCoverage({ ...complete, last_run_at: undefined }, new Date());
    assert.equal(stale.status, 'stale');
  });

  it('rejects impossible observations instead of hiding data quality errors', () => {
    assert.throws(
      () => riskCoverage({ ...complete, scenarios_with_oracles: 11 }),
      /numerator cannot exceed denominator/i,
    );
  });
});
