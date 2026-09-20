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
    assert.throws(() => parseRunnerScopes('padosoft/'), /project or \*/);
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

  it('rejects an unsafe runner identity before the worker can start', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_QUEUE_DSN: 'postgres://redacted',
          AQA_RUNNER_ROOT: 'C:/aqa',
          AQA_RUNNER_SCOPES: 'padosoft/shop',
          AQA_RUNNER_ID: 'runner/with-path',
        }),
      /runner_id must contain only bounded identifier characters/,
    );
  });

  it('requires an explicit runner identity for the remote control plane', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_SERVER_URL: 'http://aqa-server:8080',
          AQA_RUNNER_TOKEN: 'redacted-token',
          AQA_RUNNER_ROOT: 'C:/aqa',
          AQA_RUNNER_SCOPES: 'padosoft/shop',
        }),
      /AQA_RUNNER_ID is required with AQA_SERVER_URL/,
    );
  });

  it('rejects the static remote token path before creating an unbound lease', async () => {
    const { runWorker } = await import('../dist/commands/worker.js');
    await assert.rejects(
      () =>
        runWorker({
          server_url: 'http://aqa-server:8080',
          runner_token: 'redacted-token',
          runner_id: 'runner-a',
          root: 'C:/aqa',
          poll_ms: 250,
          scopes: [{ org: 'padosoft', project: 'shop' }],
        }),
      /static runner tokens cannot bind/,
    );
  });

  it('requires a credential for a remote control-plane worker and resolves token files', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_SERVER_URL: 'http://aqa-server:8080',
          AQA_RUNNER_ROOT: 'C:/aqa',
          AQA_RUNNER_SCOPES: 'padosoft/shop',
        }),
      /AQA_RUNNER_TOKEN or AQA_RUNNER_TOKEN_FILE/,
    );
    const config = runnerConfigFromEnv({
      AQA_SERVER_URL: 'http://aqa-server:8080',
      AQA_RUNNER_ID: 'runner-a',
      AQA_RUNNER_ROOT: 'C:/aqa',
      AQA_RUNNER_SCOPES: 'padosoft/shop',
      AQA_RUNNER_TOKEN_FILE: 'secrets/runner-token',
    });
    assert.equal(config.server_url, 'http://aqa-server:8080');
    assert.match(config.runner_token_file ?? '', /secrets[\\/]runner-token$/);
    assert.deepEqual(config.scopes, [{ org: 'padosoft', project: 'shop' }]);
  });

  it('carries explicit probe-driver policy into the worker configuration', () => {
    const config = runnerConfigFromEnv({
      AQA_QUEUE_DSN: 'postgres://redacted',
      AQA_RUNNER_ROOT: 'C:/aqa',
      AQA_RUNNER_SCOPES: 'padosoft/shop',
      AQA_PROBE_SHELL_ENABLED: 'true',
      AQA_PROBE_SHELL_ALLOWED_COMMANDS: 'node, npm',
      AQA_PROBE_SHELL_CWD: 'C:/aqa/project',
    });
    assert.deepEqual(config.probe_drivers?.shell?.allowedCommands, ['node', 'npm']);
    assert.equal(config.probe_drivers?.shell?.cwd, 'C:/aqa/project');
  });

  it('fails closed when a worker opts into shell probes without an allowlist', () => {
    assert.throws(
      () =>
        runnerConfigFromEnv({
          AQA_QUEUE_DSN: 'postgres://redacted',
          AQA_RUNNER_ROOT: 'C:/aqa',
          AQA_RUNNER_SCOPES: 'padosoft/shop',
          AQA_PROBE_SHELL_ENABLED: '1',
        }),
      /AQA_PROBE_SHELL_ALLOWED_COMMANDS/,
    );
  });
});
