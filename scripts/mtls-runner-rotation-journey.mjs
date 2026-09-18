import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Proves the deployed identity boundary without printing certificate material
 * or bearer tokens. The provider/operator must expose a mTLS health endpoint
 * and a queue probe where the old runner token is rejected after rotation.
 */
export async function runMtlsRunnerRotationJourney(env = process.env) {
  const healthUrl = required(env, 'AQA_TEST_MTLS_HEALTH_URL');
  const rotationUrl = required(env, 'AQA_TEST_RUNNER_ROTATION_URL');
  const caPem = required(env, 'AQA_TEST_MTLS_CA_PEM');
  const certPem = required(env, 'AQA_TEST_MTLS_CERT_PEM');
  const keyPem = required(env, 'AQA_TEST_MTLS_KEY_PEM');
  const oldToken = required(env, 'AQA_TEST_RUNNER_OLD_TOKEN');
  const newToken = required(env, 'AQA_TEST_RUNNER_NEW_TOKEN');
  const expectedHealth = status(env.AQA_TEST_MTLS_EXPECTED_HEALTH_STATUS ?? '200', 'health');
  const expectedOld = status(env.AQA_TEST_RUNNER_EXPECTED_OLD_STATUS ?? '401', 'old token');

  validateHttps(healthUrl, 'health URL');
  validateHttps(rotationUrl, 'rotation URL');
  if (![401, 403].includes(expectedOld)) throw new Error('old token status must be 401 or 403');

  const directory = await mkdtemp(join(tmpdir(), 'aqa-mtls-'));
  try {
    const caPath = join(directory, 'ca.pem');
    const certPath = join(directory, 'client.pem');
    const keyPath = join(directory, 'client-key.pem');
    await Promise.all([
      writeFile(caPath, caPem, { mode: 0o600 }),
      writeFile(certPath, certPem, { mode: 0o600 }),
      writeFile(keyPath, keyPem, { mode: 0o600 }),
    ]);

    const health = await curlStatus(healthUrl, { caPath, certPath, keyPath });
    if (health !== expectedHealth)
      throw new Error(`mTLS health endpoint returned unexpected status (${health})`);

    const old = await curlStatus(rotationUrl, {
      caPath,
      certPath,
      keyPath,
      bearer: oldToken,
    });
    if (old !== expectedOld)
      throw new Error(`rotated runner token was not rejected (status ${old})`);

    const fresh = await curlStatus(rotationUrl, {
      caPath,
      certPath,
      keyPath,
      bearer: newToken,
    });
    if (fresh < 200 || fresh >= 300)
      throw new Error(`new runner token was not accepted (status ${fresh})`);

    return { health_status: health, old_token_status: old, new_token_status: fresh };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function curlStatus(url, options) {
  const args = [
    '--silent',
    '--show-error',
    '--max-time',
    '20',
    '--connect-timeout',
    '10',
    '--max-redirs',
    '0',
    '--cacert',
    options.caPath,
    '--cert',
    options.certPath,
    '--key',
    options.keyPath,
    '--output',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
    '--write-out',
    '%{http_code}',
  ];
  if (options.bearer) args.push('--header', `Authorization: Bearer ${options.bearer}`);
  args.push(url);
  try {
    const result = await execFileAsync('curl', args, { encoding: 'utf8', windowsHide: true });
    const match = /^(\d{3})$/.exec(result.stdout.trim());
    if (!match?.[1]) throw new Error('curl returned no HTTP status');
    return Number(match[1]);
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      const match = /^(\d{3})$/.exec(String(error.stdout).trim());
      if (match?.[1]) return Number(match[1]);
    }
    throw new Error('mTLS identity probe failed');
  }
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateHttps(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error(`${label} must be an HTTPS URL without credentials or query data`);
}

function status(value, label) {
  if (!/^\d{3}$/.test(value)) throw new Error(`${label} status must be a three-digit code`);
  return Number(value);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  runMtlsRunnerRotationJourney()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'journey failed'}\n`);
      process.exitCode = 1;
    });
}
