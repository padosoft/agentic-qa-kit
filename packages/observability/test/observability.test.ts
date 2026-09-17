import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MetricsRegistry,
  StructuredLogger,
  Tracer,
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
});
