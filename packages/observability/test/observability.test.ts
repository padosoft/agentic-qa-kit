import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MetricsRegistry,
  OtlpHttpSpanExporter,
  StructuredLogger,
  Tracer,
  evaluateSlo,
  formatTraceParent,
  parseTraceParent,
} from '../dist/index.js';

describe('@aqa/observability', () => {
  it('validates and round-trips W3C traceparent without accepting malformed context', () => {
    const input = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
    const context = parseTraceParent(input);
    assert.deepEqual(context, {
      trace_id: 'a'.repeat(32),
      span_id: 'b'.repeat(16),
      trace_flags: '01',
    });
    assert.equal(formatTraceParent(context ?? { trace_id: '', span_id: '' }), input);
    assert.equal(parseTraceParent('not-a-trace'), undefined);
    assert.equal(parseTraceParent(`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`), undefined);
  });

  it('exports child spans with inherited trace identity and parent span', () => {
    const spans: unknown[] = [];
    const tracer = new Tracer((span) => spans.push(span));
    const root = tracer.startSpan('run', { run_id: 'run-1' });
    const child = tracer.startSpan('scenario', {}, root.traceContext);
    child.end();
    root.end();
    const records = spans as Array<{
      context: { trace_id: string; span_id: string };
      parent_span_id?: string;
    }>;
    assert.equal(records.length, 2);
    assert.equal(records[0]?.context.trace_id, records[1]?.context.trace_id);
    assert.equal(records[0]?.parent_span_id, records[1]?.context.span_id);
  });

  it('renders bounded counters, gauges and cumulative histogram buckets', () => {
    const metrics = new MetricsRegistry(4);
    metrics.counter('aqa_runs_total', { project: 'shop' });
    metrics.counter('aqa_runs_total', { project: 'shop' });
    metrics.gauge('aqa_queue_depth', {}, 3);
    metrics.histogram('aqa_run_duration_seconds', 0.2, { project: 'shop' });
    const text = metrics.renderPrometheus();
    assert.match(text, /aqa_runs_total\{project="shop"\} 2/);
    assert.match(text, /aqa_run_duration_seconds_bucket\{project="shop",le="1"\} 1/);
    assert.match(text, /aqa_run_duration_seconds_count\{project="shop"\} 1/);
  });

  it('fails closed on unbounded metric series', () => {
    const metrics = new MetricsRegistry(1);
    metrics.counter('aqa_runs_total', { project: 'one' });
    assert.throws(() => metrics.counter('aqa_runs_total', { project: 'two' }), /series limit/);
    assert.throws(() => metrics.counter('aqa_runs_total', { 'bad-label': 'x' }), /label name/);
  });

  it('redacts secrets before structured log sink emission', () => {
    const lines: string[] = [];
    new StructuredLogger((line) => lines.push(line)).log('info', 'request', {
      trace_id: 'trace',
      authorization: 'Bearer super-secret',
      nested: { api_key: 'hidden' },
    });
    assert.equal(lines.length, 1);
    const line = lines[0] ?? '';
    assert.doesNotMatch(line, /super-secret|hidden/);
    assert.match(line, /REDACTED/);
  });

  it('computes a bounded error budget with explicit reason codes', () => {
    const report = evaluateSlo({
      name: 'run_success',
      target: 0.99,
      total_events: 100,
      bad_events: 1,
    });
    assert.equal(report.status, 'breached');
    assert.equal(report.reason, 'budget_exhausted');
    assert.equal(report.error_budget_remaining, 0);
    assert.equal(report.burn_rate, 1);
    assert.equal(
      evaluateSlo({ name: 'empty', target: 0.99, total_events: 0, bad_events: 0 }).reason,
      'no_data',
    );
  });

  it('rejects impossible SLO observations', () => {
    assert.throws(
      () => evaluateSlo({ name: 'bad', target: 0.99, total_events: 2, bad_events: 3 }),
      /cannot exceed/,
    );
    assert.throws(
      () => evaluateSlo({ name: 'bad', target: 0, total_events: 1, bad_events: 0 }),
      /target/,
    );
  });

  it('exports bounded, redacted OTLP JSON and retries failed batches', async () => {
    const requests: RequestInit[] = [];
    let fail = true;
    const exporter = new OtlpHttpSpanExporter({
      endpoint: 'http://collector.test/v1/traces',
      service_name: 'aqa-server',
      max_batch_size: 2,
      max_queue_size: 2,
      fetcher: async (_input, init) => {
        requests.push(init ?? {});
        if (fail) {
          fail = false;
          return new Response('', { status: 503 });
        }
        return new Response('', { status: 200 });
      },
    });
    exporter.export({
      name: 'run',
      context: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) },
      started_at: '2026-09-17T10:00:00.000Z',
      ended_at: '2026-09-17T10:00:01.000Z',
      duration_ms: 1_000,
      status: 'ok',
      attributes: { authorization: 'Bearer secret', project: 'shop' },
    });
    await assert.rejects(() => exporter.flush(), /503/);
    assert.equal(exporter.pendingCount(), 1);
    assert.equal(await exporter.flush(), 1);
    const body = String(requests[1]?.body);
    assert.doesNotMatch(body, /secret/);
    assert.match(body, /shop/);
  });

  it('rejects invalid OTLP exporter limits and protocols', () => {
    assert.throws(
      () => new OtlpHttpSpanExporter({ endpoint: 'file:///tmp/traces', service_name: 'aqa' }),
      /http or https/,
    );
    assert.throws(
      () =>
        new OtlpHttpSpanExporter({
          endpoint: 'http://collector.test',
          service_name: 'aqa',
          max_queue_size: 0,
        }),
      /max_queue_size/,
    );
  });
});
