import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRunnerScopes, runnerConfigFromEnv } from '../dist/commands/worker.js';

describe('runner worker deployment configuration', () => {
  it('parses project and org-wide scopes without exposing DSN values', () => {
    assert.deepEqual(parseRunnerScopes('padosoft/shop,other/*'), [
      { org: 'padosoft', project: 'shop' },
      { org: 'other' },
    ]);
  });

  it('fails closed when durable worker scope is absent or malformed', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_QUEUE_DSN: 'postgres://redacted',
          AQA_RUNNER_ROOT: 'C:/aqa',
        }),
      /AQA_RUNNER_SCOPES is required/,
    );
    assert.throws(() => parseRunnerScopes('padosoft'), /org\/project/);
  });

  it('bounds the worker polling interval', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_QUEUE_DSN: 'postgres://redacted',
          AQA_RUNNER_ROOT: 'C:/aqa',
          AQA_RUNNER_SCOPES: 'padosoft/shop',
          AQA_RUNNER_POLL_MS: '5',
        }),
      /10 to 60000/,
    );
  });
});
