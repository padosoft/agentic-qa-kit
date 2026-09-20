import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('chaos benchmark', () => {
  it('reports terminal accounting and exits nonzero below threshold', () => {
    const passing = run(['--jobs', '20', '--runs', '1']);
    assert.equal(passing.status, 0);
    const passReport = JSON.parse(passing.stdout);
    assert.equal(passReport.result, 'pass');
    assert.equal(passReport.totals.completion_ratio, 0.95);
    assert.equal(passReport.measurements[0].stranded, 0);

    const failing = run(['--jobs', '1', '--runs', '1', '--min-completion-ratio', '1']);
    assert.equal(failing.status, 1);
    const failReport = JSON.parse(failing.stdout);
    assert.equal(failReport.result, 'fail');
    assert.equal(failReport.totals.failed, 1);
    assert.equal(failReport.totals.completion_ratio, 0);
  });
});

function run(args) {
  return spawnSync(process.execPath, ['scripts/chaos-benchmark.mjs', ...args], {
    encoding: 'utf8',
    maxBuffer: 1_000_000,
  });
}
