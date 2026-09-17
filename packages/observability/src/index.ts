import { randomBytes } from 'node:crypto';

export interface TraceContext {
  trace_id: string;
  span_id: string;
  trace_flags?: string;
  run_id?: string;
  org_id?: string;
  project_id?: string;
  actor_id?: string;
}

export interface SpanRecord {
  name: string;
  context: TraceContext;
  parent_span_id?: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
}

export type SpanExporter = (span: SpanRecord) => void;

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_16 = /^[0-9a-f]{16}$/;

export function parseTraceParent(value: string | undefined): TraceContext | undefined {
  const parts = value?.trim().split('-');
  if (!parts || parts.length !== 4) return undefined;
  const [, trace_id, span_id, trace_flags] = parts;
  if (!trace_id || !span_id || !trace_flags || !HEX_32.test(trace_id) || !HEX_16.test(span_id))
    return undefined;
  if (!/^[0-9a-f]{2}$/.test(trace_flags) || trace_id === '0'.repeat(32)) return undefined;
  return { trace_id, span_id, trace_flags };
}

export function formatTraceParent(context: TraceContext): string {
  if (!HEX_32.test(context.trace_id) || !HEX_16.test(context.span_id))
    throw new Error('invalid W3C trace context');
  return `00-${context.trace_id}-${context.span_id}-${context.trace_flags ?? '01'}`;
}

function id(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export class Tracer {
  constructor(private readonly exporter: SpanExporter = () => {}) {}

  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    parent?: TraceContext,
  ): Span {
    const context: TraceContext = {
      trace_id: parent?.trace_id ?? id(16),
      span_id: id(8),
      ...(parent?.trace_flags ? { trace_flags: parent.trace_flags } : {}),
      ...(parent?.run_id ? { run_id: parent.run_id } : {}),
      ...(parent?.org_id ? { org_id: parent.org_id } : {}),
      ...(parent?.project_id ? { project_id: parent.project_id } : {}),
      ...(parent?.actor_id ? { actor_id: parent.actor_id } : {}),
    };
    return new Span(name, context, attributes, parent?.span_id, this.exporter);
  }
}

export class Span {
  private readonly started = performance.now();
  private status: 'ok' | 'error' = 'ok';
  private ended = false;

  constructor(
    private readonly name: string,
    private readonly context: TraceContext,
    private readonly attributes: Record<string, string | number | boolean>,
    private readonly parent_span_id: string | undefined,
    private readonly exporter: SpanExporter,
  ) {}

  get traceContext(): TraceContext {
    return this.context;
  }

  end(status: 'ok' | 'error' = this.status): SpanRecord {
    if (this.ended) throw new Error('span already ended');
    this.ended = true;
    const record: SpanRecord = {
      name: this.name,
      context: this.context,
      ...(this.parent_span_id ? { parent_span_id: this.parent_span_id } : {}),
      started_at: new Date(Date.now() - Math.round(performance.now() - this.started)).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: Math.max(0, performance.now() - this.started),
      status,
      attributes: { ...this.attributes },
    };
    this.exporter(record);
    return record;
  }

  fail(): void {
    this.status = 'error';
  }
}

type LabelValues = Record<string, string>;
interface MetricSeries {
  value: number;
  buckets?: number[];
  counts?: number[];
  sum?: number;
}

function metricName(value: string): string {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(value)) throw new Error(`invalid metric name: ${value}`);
  return value;
}

function normalizeLabels(labels: LabelValues): LabelValues {
  const normalized: LabelValues = {};
  for (const key of Object.keys(labels).sort()) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error(`invalid metric label name: ${key}`);
    normalized[key] = String(labels[key]);
  }
  return normalized;
}

function seriesKey(labels: LabelValues): string {
  return JSON.stringify(
    Object.entries(normalizeLabels(labels)).map(([key, value]) => [key, value]),
  );
}

function decodeLabels(key: string): LabelValues {
  const entries = JSON.parse(key) as unknown;
  if (!Array.isArray(entries)) throw new Error('invalid metric series key');
  return Object.fromEntries(
    entries.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')
        throw new Error('invalid metric label entry');
      return [entry[0], String(entry[1])];
    }),
  );
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, MetricSeries>>();
  private readonly gauges = new Map<string, Map<string, MetricSeries>>();
  private readonly histograms = new Map<string, Map<string, MetricSeries>>();

  constructor(private readonly maxSeries = 10_000) {
    if (!Number.isInteger(maxSeries) || maxSeries < 1)
      throw new Error('maxSeries must be positive');
  }

  counter(name: string, labels: LabelValues = {}, amount = 1): void {
    this.add(this.counters, metricName(name), labels, amount);
  }

  gauge(name: string, labels: LabelValues = {}, value = 0): void {
    this.set(this.gauges, metricName(name), labels, value);
  }

  histogram(
    name: string,
    value: number,
    labels: LabelValues = {},
    buckets = [0.01, 0.1, 1, 5, 30],
  ): void {
    if (!Number.isFinite(value) || value < 0)
      throw new Error('histogram value must be finite and non-negative');
    const cleanBuckets = [...buckets].sort((a, b) => a - b);
    if (cleanBuckets.some((bucket) => !Number.isFinite(bucket) || bucket < 0))
      throw new Error('histogram buckets must be finite and non-negative');
    const map = this.histograms.get(metricName(name)) ?? new Map<string, MetricSeries>();
    const key = seriesKey(labels);
    let series = map.get(key);
    if (!series) {
      this.assertCapacity();
      series = {
        value: 0,
        buckets: cleanBuckets,
        counts: Array(cleanBuckets.length + 1).fill(0),
        sum: 0,
      };
      map.set(key, series);
      this.histograms.set(metricName(name), map);
    }
    series.value += 1;
    series.sum = (series.sum ?? 0) + value;
    const index = (series.buckets ?? []).findIndex((bucket) => value <= bucket);
    (series.counts ?? [])[index < 0 ? (series.counts?.length ?? 1) - 1 : index] =
      ((series.counts ?? [])[index < 0 ? (series.counts?.length ?? 1) - 1 : index] ?? 0) + 1;
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, map] of [...this.counters, ...this.gauges]) {
      for (const [key, series] of map) lines.push(`${name}${formatLabels(key)} ${series.value}`);
    }
    for (const [name, map] of this.histograms) {
      for (const [key, series] of map) {
        let cumulative = 0;
        for (let i = 0; i < (series.buckets?.length ?? 0); i++) {
          cumulative += series.counts?.[i] ?? 0;
          lines.push(`${name}_bucket${formatLabels(key, series.buckets?.[i])} ${cumulative}`);
        }
        cumulative += series.counts?.at(-1) ?? 0;
        lines.push(`${name}_bucket${formatLabels(key, '+Inf')} ${cumulative}`);
        lines.push(`${name}_sum${formatLabels(key)} ${series.sum ?? 0}`);
        lines.push(`${name}_count${formatLabels(key)} ${series.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private assertCapacity(): void {
    let count = 0;
    for (const map of [
      ...this.counters.values(),
      ...this.gauges.values(),
      ...this.histograms.values(),
    ])
      count += map.size;
    if (count >= this.maxSeries) throw new Error('observability metric series limit exceeded');
  }

  private add(
    target: Map<string, Map<string, MetricSeries>>,
    name: string,
    labels: LabelValues,
    amount: number,
  ): void {
    if (!Number.isFinite(amount)) throw new Error('metric amount must be finite');
    const map = target.get(name) ?? new Map<string, MetricSeries>();
    const key = seriesKey(labels);
    const series = map.get(key);
    if (series) series.value += amount;
    else {
      this.assertCapacity();
      map.set(key, { value: amount });
      target.set(name, map);
    }
  }

  private set(
    target: Map<string, Map<string, MetricSeries>>,
    name: string,
    labels: LabelValues,
    value: number,
  ): void {
    if (!Number.isFinite(value)) throw new Error('metric value must be finite');
    const map = target.get(name) ?? new Map<string, MetricSeries>();
    const key = seriesKey(labels);
    if (!map.has(key)) this.assertCapacity();
    map.set(key, { value });
    target.set(name, map);
  }
}

function formatLabels(key: string, le?: number | string): string {
  const entries = Object.entries(decodeLabels(key));
  if (le !== undefined) entries.push(['le', String(le)]);
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}

const SENSITIVE =
  /(authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|pan|cvv|iban)/i;
function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE.test(key)) return '[REDACTED]';
  if (typeof value === 'string')
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]');
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}

export type LogSink = (line: string) => void;

export type SloStatus = 'healthy' | 'warning' | 'breached';

export interface SloObservation {
  name: string;
  target: number;
  total_events: number;
  bad_events: number;
}

export interface SloReport extends SloObservation {
  good_events: number;
  allowed_bad_events: number;
  error_budget_remaining: number;
  burn_rate: number;
  status: SloStatus;
  reason: 'no_data' | 'within_budget' | 'budget_warning' | 'budget_exhausted';
}

/**
 * Evaluate an SLO from counted events. This is intentionally pure so the same
 * error-budget decision can be used by an exporter, API and release gate.
 */
export function evaluateSlo(observation: SloObservation): SloReport {
  if (!observation.name.trim()) throw new Error('SLO name is required');
  if (!Number.isFinite(observation.target) || observation.target <= 0 || observation.target > 1)
    throw new Error('SLO target must be > 0 and <= 1');
  if (!Number.isInteger(observation.total_events) || observation.total_events < 0)
    throw new Error('SLO total_events must be a non-negative integer');
  if (!Number.isInteger(observation.bad_events) || observation.bad_events < 0)
    throw new Error('SLO bad_events must be a non-negative integer');
  if (observation.bad_events > observation.total_events)
    throw new Error('SLO bad_events cannot exceed total_events');
  const allowedBad = Number((observation.total_events * (1 - observation.target)).toFixed(6));
  const remaining =
    allowedBad === 0
      ? observation.bad_events === 0
        ? 1
        : 0
      : (allowedBad - observation.bad_events) / allowedBad;
  const errorBudgetRemaining = Math.max(0, Math.min(1, remaining));
  const burnRate =
    allowedBad === 0
      ? observation.bad_events === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : observation.bad_events / allowedBad;
  const reason =
    observation.total_events === 0
      ? 'no_data'
      : errorBudgetRemaining <= 0
        ? 'budget_exhausted'
        : errorBudgetRemaining < 0.2
          ? 'budget_warning'
          : 'within_budget';
  return {
    ...observation,
    good_events: observation.total_events - observation.bad_events,
    allowed_bad_events: Number(allowedBad.toFixed(6)),
    error_budget_remaining: Number(errorBudgetRemaining.toFixed(6)),
    burn_rate: Number.isFinite(burnRate) ? Number(burnRate.toFixed(6)) : burnRate,
    status:
      reason === 'no_data'
        ? 'warning'
        : reason === 'budget_exhausted'
          ? 'breached'
          : reason === 'budget_warning'
            ? 'warning'
            : 'healthy',
    reason,
  };
}

export class StructuredLogger {
  constructor(private readonly sink: LogSink = (line) => console.error(line)) {}

  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    fields: Record<string, unknown> = {},
  ): void {
    const value = redact({ ts: new Date().toISOString(), level, message, ...fields });
    this.sink(JSON.stringify(value));
  }
}
