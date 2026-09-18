import assert from 'node:assert/strict';
import test from 'node:test';
import { federateTraceSources, parseOtlpTrace } from '../dist/index.js';

function otlp(overrides: Record<string, unknown> = {}): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'checkout' } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: '0123456789abcdef0123456789abcdef',
                spanId: '0123456789abcdef',
                name: 'checkout',
                startTimeUnixNano: '1700000000000000000',
                endTimeUnixNano: '1700000001000000000',
                status: { code: 1 },
                attributes: [
                  { key: 'authorization', value: { stringValue: 'Bearer secret' } },
                  { key: 'http.url', value: { stringValue: 'https://example.test/orders/1' } },
                ],
                ...overrides,
              },
            ],
          },
        ],
      },
    ],
  };
}

test('OTLP ingestion redacts sensitive metadata and federates ordered spans', () => {
  const source = parseOtlpTrace(otlp(), 'otel.json');
  assert.equal(source.spans[0]?.service, 'checkout');
  assert.equal(source.spans[0]?.attributes.authorization, '[redacted]');
  assert.equal(source.spans[0]?.attributes['http.url'], '[redacted-url]');
  const report = federateTraceSources([source]);
  assert.equal(report.traces.length, 1);
  assert.equal(report.traces[0]?.orphan_span_ids.length, 0);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('trace federation reports orphan and conflicting spans and rejects unsafe input', () => {
  const source = parseOtlpTrace(
    otlp({ parentSpanId: 'fedcba9876543210', name: 'child' }),
    'child.json',
  );
  const conflicting = parseOtlpTrace(otlp({ name: 'different' }), 'other.json');
  const report = federateTraceSources([source, conflicting]);
  assert.deepEqual(report.traces[0]?.orphan_span_ids, ['0123456789abcdef']);
  assert.deepEqual(report.traces[0]?.conflicting_span_ids, ['0123456789abcdef']);
  assert.throws(() => parseOtlpTrace({ resourceSpans: [] }), /no spans/);
  assert.throws(() => federateTraceSources([]), /1..64/);
});

test('trace federation deduplicates identical spans across sources and accepts OTLP defaults', () => {
  const first = parseOtlpTrace(
    otlp({ status: undefined, attributes: undefined }),
    'collector-a.json',
  );
  const second = parseOtlpTrace(
    otlp({ status: undefined, attributes: undefined }),
    'collector-b.json',
  );
  const report = federateTraceSources([first, second]);
  assert.equal(report.traces[0]?.spans.length, 1);
  assert.deepEqual(report.traces[0]?.conflicting_span_ids, []);
  assert.equal(report.traces[0]?.spans[0]?.status, 'unset');
});

test('trace federation rejects unsafe timestamps and parent span IDs', () => {
  assert.throws(
    () => parseOtlpTrace(otlp({ startTimeUnixNano: Number.MAX_SAFE_INTEGER + 1 })),
    /timestamp/,
  );
  assert.throws(() => parseOtlpTrace(otlp({ parentSpanId: '0000000000000000' })), /parentSpanId/);
});
