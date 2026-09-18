import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdmin } from '../packages/kit/dist/commands/admin.js';
import {
  MetricsRegistry,
  OtlpHttpSpanExporter,
  Tracer,
} from '../packages/observability/dist/index.js';

if (process.env.AQA_TEST_OBSERVABILITY_LIVE !== '1') {
  console.log('SKIP: set AQA_TEST_OBSERVABILITY_LIVE=1 for the live telemetry journey');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'aqa-observability-live-'));
const network = `aqa-observability-${process.pid}`;
const prometheus = `aqa-prometheus-${process.pid}`;
const collector = `aqa-collector-${process.pid}`;
const adminDistDir = join(process.cwd(), 'packages', 'admin', 'dist');
const adminMetrics = new MetricsRegistry();
adminMetrics.counter('aqa_live_journey_total', { environment: 'ci' });
const admin = await runAdmin({
  root,
  host: '0.0.0.0',
  port: 0,
  adminDistDir,
  metrics: adminMetrics,
  metricsAuthorize: () => true,
  authenticate: async () => ({
    id: 'observability-live',
    email: 'observability-live@aqa.test',
    display_name: 'Observability journey',
    roles: ['admin'],
  }),
});
assert.equal(admin.ok, true, `admin failed to start: ${JSON.stringify(admin)}`);
if (!admin.ok) process.exit(1);

const promPort = await freePort();
const collectorPort = await freePort();
const promConfig = join(root, 'prometheus.yml');
const collectorConfig = join(root, 'collector.yml');
writeFileSync(
  promConfig,
  `global:\n  scrape_interval: 1s\nscrape_configs:\n  - job_name: aqa-live\n    static_configs:\n      - targets: ['host.docker.internal:${admin.port}']\n`,
);
writeFileSync(
  collectorConfig,
  'receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\nexporters:\n  debug:\n    verbosity: detailed\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n',
);

try {
  docker(['network', 'create', network]);
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    collector,
    '--network',
    network,
    '-p',
    `${collectorPort}:4318`,
    '-v',
    `${collectorConfig}:/etc/otelcol/config.yaml:ro`,
    'otel/opentelemetry-collector-contrib:0.136.0',
    '--config=/etc/otelcol/config.yaml',
  ]);
  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    prometheus,
    '--network',
    network,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-p',
    `${promPort}:9090`,
    '-v',
    `${promConfig}:/etc/prometheus/prometheus.yml:ro`,
    'prom/prometheus:v2.55.1',
    '--config.file=/etc/prometheus/prometheus.yml',
  ]);

  await waitForHttp(
    `http://127.0.0.1:${collectorPort}/v1/traces`,
    (response) => response.status < 500,
  );
  await waitForHttp(`http://127.0.0.1:${promPort}/-/ready`, (response) => response.ok);

  const directMetrics = await fetch(`http://127.0.0.1:${admin.port}/metrics`);
  assert.equal(directMetrics.status, 200);
  assert.match(await directMetrics.text(), /aqa_live_journey_total\{environment="ci"\} 1/);

  const exporter = new OtlpHttpSpanExporter({
    endpoint: `http://127.0.0.1:${collectorPort}/v1/traces`,
    service_name: 'aqa-live-journey',
  });
  const tracer = new Tracer((span) => exporter.export(span));
  const span = tracer.startSpan('aqa.live.observability');
  span.end();
  await exporter.shutdown();

  const query = encodeURIComponent('aqa_live_journey_total{environment="ci"}');
  const prometheusResult = await waitForJson(
    `http://127.0.0.1:${promPort}/api/v1/query?query=${query}`,
    (body) => body?.status === 'success' && body.data?.result?.length > 0,
  );
  assert.equal(prometheusResult.status, 'success');
  assert.equal(prometheusResult.data.result[0].value[1], '1');

  const collectorResult = docker(['logs', collector]);
  const collectorLogs = `${collectorResult.stdout}\n${collectorResult.stderr}`;
  assert.match(collectorLogs, /aqa\.live\.observability/);
  console.log('PASS: live Prometheus scrape/query and OTLP Collector export verified');
} finally {
  for (const name of [prometheus, collector]) docker(['rm', '-f', name], false);
  docker(['network', 'rm', network], false);
  await admin.close();
  rmSync(root, { recursive: true, force: true });
}

function docker(args, required = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (required && result.status !== 0)
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForHttp(url, predicate, timeoutMs = 60_000) {
  return waitFor(async () => {
    try {
      const response = await fetch(url);
      return (await predicate(response)) ? response : undefined;
    } catch {
      return undefined;
    }
  }, timeoutMs);
}

async function waitForJson(url, predicate, timeoutMs = 60_000) {
  return waitFor(async () => {
    try {
      const response = await fetch(url);
      const body = await response.json();
      return predicate(body) ? body : undefined;
    } catch {
      return undefined;
    }
  }, timeoutMs);
}

async function waitFor(operation, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`timed out waiting for ${timeoutMs}ms`);
}
