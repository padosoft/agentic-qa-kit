import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmeaScore, methodologyCheck, owaspOf, strideOf } from '../dist/index.js';

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
