const TRACE_ID = /^[0-9a-f]{32}$/u;
const SPAN_ID = /^[0-9a-f]{16}$/u;
const MAX_SPANS = 100_000;
const MAX_ATTRIBUTES = 64;
const SECRET_KEY =
  /(authorization|cookie|password|secret|token|api[_-]?key|private[_-]?key|credential)/iu;

export type TraceAttribute = string | number | boolean;

export interface FederatedSpan {
  source: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  service?: string;
  started_at: string;
  ended_at: string;
  status: 'unset' | 'ok' | 'error';
  attributes: Readonly<Record<string, TraceAttribute>>;
}

export interface FederatedTraceSource {
  schema_version: '1';
  source: string;
  spans: ReadonlyArray<FederatedSpan>;
  warnings: ReadonlyArray<string>;
}

export interface FederatedTrace {
  trace_id: string;
  spans: ReadonlyArray<FederatedSpan>;
  orphan_span_ids: ReadonlyArray<string>;
  conflicting_span_ids: ReadonlyArray<string>;
}

export interface TraceFederationReport {
  schema_version: '1';
  source_count: number;
  traces: ReadonlyArray<FederatedTrace>;
  warnings: ReadonlyArray<string>;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    throw new Error(`${field} must be a bounded non-empty string`);
  return value.trim();
}

function nanosToIso(value: unknown, field: string): string {
  let nanos: bigint;
  try {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new Error('unsafe numeric timestamp');
      nanos = BigInt(value);
    } else {
      nanos = BigInt(bounded(value, field));
    }
  } catch {
    throw new Error(`${field} must be a valid Unix nanosecond timestamp`);
  }
  if (nanos <= 0n || nanos > 4_102_444_800_000_000_000n)
    throw new Error(`${field} is outside the supported time range`);
  const millis = Number(nanos / 1_000_000n);
  return new Date(millis).toISOString();
}

function attributeValue(value: unknown): TraceAttribute | undefined {
  const item = record(value, 'OTLP attribute value');
  if (typeof item.stringValue === 'string') return item.stringValue.slice(0, 512);
  if (typeof item.boolValue === 'boolean') return item.boolValue;
  if (typeof item.intValue === 'number' && Number.isSafeInteger(item.intValue))
    return item.intValue;
  if (typeof item.intValue === 'string' && /^-?\d{1,18}$/u.test(item.intValue))
    return Number(item.intValue);
  if (typeof item.doubleValue === 'number' && Number.isFinite(item.doubleValue))
    return item.doubleValue;
  return undefined;
}

function attributes(value: unknown): { values: Record<string, TraceAttribute>; redacted: number } {
  if (value === undefined) return { values: {}, redacted: 0 };
  if (!Array.isArray(value) || value.length > MAX_ATTRIBUTES)
    throw new Error(`OTLP span attributes must contain at most ${MAX_ATTRIBUTES} entries`);
  const values: Record<string, TraceAttribute> = {};
  let redacted = 0;
  for (const raw of value) {
    const item = record(raw, 'OTLP span attribute');
    const key = bounded(item.key, 'OTLP attribute key', 128);
    if (SECRET_KEY.test(key)) {
      values[key] = '[redacted]';
      redacted += 1;
      continue;
    }
    const parsed = attributeValue(item.value);
    if (parsed !== undefined)
      values[key] =
        typeof parsed === 'string'
          ? parsed.replace(/https?:\/\/[^\s]+/giu, '[redacted-url]')
          : parsed;
  }
  return { values, redacted };
}

function serviceName(resource: unknown): string | undefined {
  if (resource === undefined) return undefined;
  const item = record(resource, 'OTLP resource');
  const attrs = Array.isArray(item.attributes) ? item.attributes.slice(0, MAX_ATTRIBUTES) : [];
  const service = attrs.find((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return (raw as Record<string, unknown>).key === 'service.name';
  });
  if (!service) return undefined;
  const value = attributeValue((service as Record<string, unknown>).value);
  return typeof value === 'string' ? value.slice(0, 200) : undefined;
}

/** Parse bounded OTLP/HTTP JSON spans and retain metadata only. */
export function parseOtlpTrace(value: unknown, source = 'otlp.json'): FederatedTraceSource {
  const root = record(value, 'OTLP document');
  const safeSource = bounded(source, 'OTLP source', 200);
  if (!Array.isArray(root.resourceSpans))
    throw new Error('OTLP document must contain resourceSpans');
  const spans: FederatedSpan[] = [];
  const warnings: string[] = [];
  for (const resourceSpan of root.resourceSpans) {
    const resourceItem = record(resourceSpan, 'OTLP resource span');
    const service = serviceName(resourceItem.resource);
    const scopes = Array.isArray(resourceItem.scopeSpans) ? resourceItem.scopeSpans : [];
    for (const scope of scopes) {
      const scopeItem = record(scope, 'OTLP scope span');
      if (!Array.isArray(scopeItem.spans)) continue;
      for (const rawSpan of scopeItem.spans) {
        if (spans.length >= MAX_SPANS) throw new Error(`OTLP trace exceeds ${MAX_SPANS} spans`);
        const item = record(rawSpan, 'OTLP span');
        const traceId = bounded(item.traceId, 'OTLP traceId', 32).toLowerCase();
        const spanId = bounded(item.spanId, 'OTLP spanId', 16).toLowerCase();
        if (!TRACE_ID.test(traceId) || /^0+$/.test(traceId))
          throw new Error('OTLP traceId is invalid');
        if (!SPAN_ID.test(spanId) || /^0+$/.test(spanId)) throw new Error('OTLP spanId is invalid');
        const started = nanosToIso(item.startTimeUnixNano, 'OTLP startTimeUnixNano');
        const ended = nanosToIso(item.endTimeUnixNano, 'OTLP endTimeUnixNano');
        if (Date.parse(ended) < Date.parse(started))
          throw new Error(`OTLP span ${spanId} ends before it starts`);
        const parsedAttributes = attributes(item.attributes);
        if (parsedAttributes.redacted > 0)
          warnings.push(
            `redacted ${parsedAttributes.redacted} sensitive attributes from ${spanId}`,
          );
        const statusCode =
          item.status === undefined ? 0 : record(item.status, 'OTLP span status').code;
        if (statusCode !== undefined && statusCode !== 0 && statusCode !== 1 && statusCode !== 2)
          throw new Error(`OTLP span ${spanId} has an unsupported status code`);
        const parentSpanId =
          item.parentSpanId === undefined
            ? undefined
            : bounded(item.parentSpanId, 'OTLP parentSpanId', 16).toLowerCase();
        if (
          parentSpanId !== undefined &&
          (!SPAN_ID.test(parentSpanId) || /^0+$/.test(parentSpanId))
        )
          throw new Error(`OTLP parentSpanId for ${spanId} is invalid`);
        spans.push({
          source: safeSource,
          trace_id: traceId,
          span_id: spanId,
          ...(parentSpanId ? { parent_span_id: parentSpanId } : {}),
          name: bounded(item.name, 'OTLP span name', 200),
          ...(service ? { service } : {}),
          started_at: started,
          ended_at: ended,
          status: statusCode === 2 ? 'error' : statusCode === 1 ? 'ok' : 'unset',
          attributes: parsedAttributes.values,
        });
      }
    }
  }
  if (spans.length === 0) throw new Error('OTLP document contains no spans');
  return {
    schema_version: '1',
    source: safeSource,
    spans,
    warnings: [...new Set(warnings)].slice(0, 100),
  };
}

function sameSpanContent(left: FederatedSpan, right: FederatedSpan): boolean {
  return (
    left.trace_id === right.trace_id &&
    left.span_id === right.span_id &&
    left.parent_span_id === right.parent_span_id &&
    left.name === right.name &&
    left.service === right.service &&
    left.started_at === right.started_at &&
    left.ended_at === right.ended_at &&
    left.status === right.status &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
  );
}

/** Merge independently ingested trace sources without trusting telemetry as audit truth. */
export function federateTraceSources(
  sources: ReadonlyArray<FederatedTraceSource>,
): TraceFederationReport {
  if (sources.length === 0 || sources.length > 64)
    throw new Error('trace federation requires 1..64 sources');
  const byTrace = new Map<string, Map<string, FederatedSpan>>();
  const conflicts = new Map<string, Set<string>>();
  const warnings = new Set<string>();
  for (const source of sources) {
    for (const warning of source.warnings) warnings.add(`${source.source}: ${warning}`);
    for (const span of source.spans) {
      const trace = byTrace.get(span.trace_id) ?? new Map<string, FederatedSpan>();
      const existing = trace.get(span.span_id);
      if (existing && !sameSpanContent(existing, span)) {
        const ids = conflicts.get(span.trace_id) ?? new Set<string>();
        ids.add(span.span_id);
        conflicts.set(span.trace_id, ids);
      } else if (!existing) trace.set(span.span_id, span);
      byTrace.set(span.trace_id, trace);
    }
  }
  const traces = [...byTrace.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([traceId, spanMap]) => {
      const spans = [...spanMap.values()].sort(
        (a, b) => a.started_at.localeCompare(b.started_at) || a.span_id.localeCompare(b.span_id),
      );
      const ids = new Set(spans.map((span) => span.span_id));
      const orphanSpanIds = spans
        .filter((span) => span.parent_span_id && !ids.has(span.parent_span_id))
        .map((span) => span.span_id);
      return {
        trace_id: traceId,
        spans,
        orphan_span_ids: orphanSpanIds,
        conflicting_span_ids: [...(conflicts.get(traceId) ?? new Set())].sort(),
      };
    });
  return {
    schema_version: '1',
    source_count: sources.length,
    traces,
    warnings: [...warnings].sort(),
  };
}
