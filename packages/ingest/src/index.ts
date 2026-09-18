import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export type IngestFramework = 'junit' | 'sast' | 'k6' | 'locust' | 'playwright';
export type IngestStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface IngestRecord {
  id: string;
  framework: IngestFramework;
  external_id: string;
  name: string;
  status: IngestStatus;
  suite?: string;
  file?: string;
  line?: number;
  duration_ms?: number;
  severity?: string;
  message?: string;
  rule_id?: string;
  /** Tool-native numeric measurements retained for threshold evaluation. */
  measurements?: Record<string, number>;
  fingerprint: string;
}

export interface IngestReport {
  schema_version: '1';
  framework: IngestFramework;
  source: string;
  ingested_at: string;
  records: IngestRecord[];
  warnings: string[];
}

export interface PerformanceThresholdPolicy {
  max_p95_ms?: number;
  max_failure_rate?: number;
  min_check_rate?: number;
}

export interface PerformanceThresholdViolation {
  record_id: string;
  metric: 'p95_ms' | 'failure_rate' | 'check_rate';
  actual: number;
  expected: number;
}

export interface PerformanceThresholdResult {
  passed: boolean;
  evaluated_records: number;
  violations: PerformanceThresholdViolation[];
}

export type MutationStatus =
  | 'killed'
  | 'survived'
  | 'no_coverage'
  | 'timeout'
  | 'runtime_error'
  | 'compile_error'
  | 'ignored';

export interface MutationRecord {
  id: string;
  file: string;
  operator: string;
  status: MutationStatus;
}

export interface MutationReport {
  schema_version: '1';
  source: string;
  observed_at: string;
  records: MutationRecord[];
  totals: Record<MutationStatus, number>;
  mutation_score: number;
}

export interface MutationThresholdResult {
  passed: boolean;
  minimum_score: number;
  mutation_score: number;
  evaluated_mutants: number;
  violations: string[];
}

export {
  evaluateMutationCoverage,
  parseMutationCoverageManifest,
  type MutationCoverageLink,
  type MutationCoverageManifest,
  type MutationCoveragePolicy,
  type MutationCoverageResult,
} from './mutation-coverage.js';

function fingerprint(parts: string[]): string {
  return createHash('sha256')
    .update(parts.map((part) => part.toLowerCase().replace(/\s+/g, ' ').trim()).join('|'))
    .digest('hex');
}

function boundedText(value: string, field: string): string {
  if (Buffer.byteLength(value, 'utf8') > MAX_INPUT_BYTES)
    throw new Error(`${field} exceeds size limit`);
  return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function mutationText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 2_000)
    throw new Error(`mutation ${field} must be a bounded non-empty string`);
  return value.trim();
}

function normalizeMutationStatus(value: unknown): MutationStatus {
  if (typeof value !== 'string') throw new Error('mutation status is required');
  const normalized = value.replace(/[-\s]/gu, '_').toLowerCase();
  const statuses: Record<string, MutationStatus> = {
    killed: 'killed',
    survived: 'survived',
    nocoverage: 'no_coverage',
    no_coverage: 'no_coverage',
    timeout: 'timeout',
    runtimeerror: 'runtime_error',
    runtime_error: 'runtime_error',
    compileerror: 'compile_error',
    compile_error: 'compile_error',
    ignored: 'ignored',
  };
  const status = statuses[normalized];
  if (!status) throw new Error(`unsupported mutation status: ${value}`);
  return status;
}

/** Normalize bounded Stryker/mutmut-style JSON; execution stays outside this boundary. */
export function parseMutationSummary(value: unknown, source = 'mutation.json'): MutationReport {
  const root = object(value, 'mutation report');
  const rawMutants = Array.isArray(root.mutants)
    ? root.mutants.map((item, index) => ({ item, file: undefined, index }))
    : Object.entries(object(root.files, 'mutation files')).flatMap(([file, fileValue]) => {
        const fileObject = object(fileValue, `mutation file ${file}`);
        if (!Array.isArray(fileObject.mutants))
          throw new Error(`mutation file ${file} must contain mutants`);
        return fileObject.mutants.map((item, index) => ({ item, file, index }));
      });
  if (rawMutants.length === 0 || rawMutants.length > 100_000)
    throw new Error('mutation report must contain between 1 and 100000 mutants');

  const seen = new Set<string>();
  const records: MutationRecord[] = [];
  for (const entry of rawMutants) {
    const mutant = object(entry.item, `mutation ${entry.index}`);
    const id = mutationText(
      mutant.id ?? mutant.mutantId ?? `${entry.file ?? 'unknown'}:${entry.index}`,
      'id',
    );
    if (seen.has(id)) throw new Error(`duplicate mutation id: ${id}`);
    seen.add(id);
    records.push({
      id,
      file: mutationText(mutant.file ?? entry.file, 'file'),
      operator: mutationText(mutant.operator ?? mutant.mutatorName ?? 'unknown', 'operator'),
      status: normalizeMutationStatus(mutant.status ?? mutant.state),
    });
  }
  const totals = Object.fromEntries(
    (
      [
        'killed',
        'survived',
        'no_coverage',
        'timeout',
        'runtime_error',
        'compile_error',
        'ignored',
      ] as const
    ).map((status) => [status, records.filter((record) => record.status === status).length]),
  ) as Record<MutationStatus, number>;
  const evaluated = records.length - totals.ignored;
  const score = evaluated === 0 ? 0 : totals.killed / evaluated;
  return {
    schema_version: '1',
    source,
    observed_at: new Date().toISOString(),
    records,
    totals,
    mutation_score: Number(score.toFixed(6)),
  };
}

export function evaluateMutationThreshold(
  report: MutationReport,
  minimumScore: number,
): MutationThresholdResult {
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1)
    throw new Error('mutation minimum score must be between 0 and 1');
  const evaluated = report.records.length - report.totals.ignored;
  const passed = report.mutation_score >= minimumScore && evaluated > 0;
  return {
    passed,
    minimum_score: minimumScore,
    mutation_score: report.mutation_score,
    evaluated_mutants: evaluated,
    violations: passed
      ? []
      : ['mutation score is below the configured minimum or no mutants were evaluated'],
  };
}

/**
 * Read the small, metadata-only part of a Playwright trace ZIP. Trace files
 * can contain URLs, headers, request bodies and screenshots; none of those
 * are copied into the normalized report. The ZIP reader intentionally accepts
 * only local entries and bounded deflate/store members so ingestion cannot
 * become an archive extraction primitive.
 */
function traceEntry(zip: Uint8Array, wanted: string): string {
  if (zip.byteLength > MAX_INPUT_BYTES) throw new Error('Playwright trace exceeds size limit');
  const bytes = Buffer.from(zip);
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart > bytes.length || dataStart + compressedSize > bytes.length)
      throw new Error('Playwright trace ZIP entry is truncated');
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (flags & 0x1) throw new Error('encrypted Playwright trace entries are forbidden');
    if (name.includes('..') || name.startsWith('/') || name.includes('\\'))
      throw new Error('Playwright trace contains an unsafe entry name');
    if (uncompressedSize > MAX_INPUT_BYTES)
      throw new Error('Playwright trace entry exceeds size limit');
    if (name === wanted) {
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      let content: Buffer;
      if (method === 0) content = compressed;
      else if (method === 8)
        content = inflateRawSync(compressed, { maxOutputLength: MAX_INPUT_BYTES });
      else throw new Error(`unsupported Playwright trace compression method: ${method}`);
      if (content.byteLength !== uncompressedSize)
        throw new Error('Playwright trace entry size mismatch');
      return content.toString('utf8');
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`Playwright trace is missing ${wanted}`);
}

function traceString(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined;
}

function safeTraceMessage(value: unknown): string | undefined {
  const message = traceString(value, 2_000);
  return message?.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s]+/giu, '[redacted-url]');
}

/** Normalize Playwright's `trace.trace` JSONL into safe action-level evidence. */
export function parsePlaywrightTrace(zip: Uint8Array, source = 'trace.zip'): IngestReport {
  const trace = traceEntry(zip, 'trace.trace');
  const records: IngestRecord[] = [];
  const pending = new Map<string, IngestRecord>();
  for (const [lineIndex, line] of trace.split(/\r?\n/u).entries()) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Playwright trace line ${lineIndex + 1} is invalid JSON`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const item = event as Record<string, unknown>;
    if (item.type !== 'action') continue;
    const metadata = item.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
    const data = metadata as Record<string, unknown>;
    const callId = traceString(data.id, 200) ?? `line-${lineIndex + 1}`;
    const apiName = traceString(data.apiName, 200) ?? 'playwright action';
    const action: IngestRecord = {
      id: `playwright-${records.length + 1}`,
      framework: 'playwright',
      external_id: callId,
      name: apiName,
      status: 'passed',
      ...(typeof data.wallTime === 'number' && Number.isFinite(data.wallTime)
        ? { measurements: { wall_time_ms: data.wallTime } }
        : {}),
      fingerprint: fingerprint(['playwright', apiName, callId]),
    };
    records.push(action);
    pending.set(callId, action);
  }
  for (const line of trace.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    const item = JSON.parse(line) as unknown;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const event = item as Record<string, unknown>;
    if (event.type !== 'after') continue;
    const metadata = event.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
    const data = metadata as Record<string, unknown>;
    const callId = traceString(data.id, 200);
    const action = callId ? pending.get(callId) : undefined;
    if (!action) continue;
    const error = data.error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const message = safeTraceMessage((error as Record<string, unknown>).message);
      action.status = 'failed';
      if (message) action.message = message;
    }
    if (typeof data.endTime === 'number' && typeof data.startTime === 'number') {
      const duration = data.endTime - data.startTime;
      if (Number.isFinite(duration) && duration >= 0)
        action.duration_ms = Number(duration.toFixed(3));
    }
  }
  if (records.length === 0) throw new Error('Playwright trace contains no action events');
  return {
    schema_version: '1',
    framework: 'playwright',
    source,
    ingested_at: new Date().toISOString(),
    records,
    warnings: [],
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(raw);
  while (match !== null) {
    const key = match[1];
    if (key) out[key] = decodeXml(match[3] ?? match[4] ?? '');
    match = pattern.exec(raw);
  }
  return out;
}

function numberOrUndefined(value: string | undefined, multiplier = 1): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Number((parsed * multiplier).toFixed(3))
    : undefined;
}

function messageFromBody(body: string, tag: 'failure' | 'error'): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(body);
  if (!match?.[1]) return undefined;
  return decodeXml(match[1].replace(/<[^>]+>/g, '').trim()).slice(0, 100_000);
}

/** Parse the portable JUnit XML subset emitted by Jest, Vitest, Pytest and CI runners. */
export function parseJunit(xml: string, source = 'junit.xml'): IngestReport {
  const input = boundedText(xml, 'JUnit input');
  if (/<!DOCTYPE|<!ENTITY/i.test(input))
    throw new Error('JUnit DOCTYPE/ENTITY declarations are forbidden');
  if (!/<testsuite(?:s)?\b/i.test(input)) throw new Error('JUnit document has no testsuite root');
  const suiteMatch = /<testsuite\b([^>]*)>/i.exec(input);
  const suiteAttrs = suiteMatch ? attributes(suiteMatch[1] ?? '') : {};
  const casePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase\s*>)/gi;
  const records: IngestRecord[] = [];
  let match = casePattern.exec(input);
  while (match !== null) {
    const attrs = attributes(match[1] ?? '');
    const body = match[2] ?? '';
    const className = attrs.classname ?? '';
    const name = attrs.name ?? className;
    if (!name) throw new Error('JUnit testcase is missing name');
    const hasError = /<error\b/i.test(body);
    const hasFailure = /<failure\b/i.test(body);
    const skipped = /<skipped\b/i.test(body);
    const status: IngestStatus = skipped
      ? 'skipped'
      : hasError
        ? 'error'
        : hasFailure
          ? 'failed'
          : 'passed';
    const externalId = attrs.id ?? `${className}::${name}`;
    const message = messageFromBody(body, hasError ? 'error' : 'failure');
    const line = numberOrUndefined(attrs.line);
    const duration = numberOrUndefined(attrs.time, 1000);
    records.push({
      id: `junit-${records.length + 1}`,
      framework: 'junit',
      external_id: externalId,
      name,
      status,
      ...(attrs.classname
        ? { suite: attrs.classname }
        : suiteAttrs.name
          ? { suite: suiteAttrs.name }
          : {}),
      ...(attrs.file ? { file: attrs.file } : {}),
      ...(line === undefined ? {} : { line }),
      ...(duration === undefined ? {} : { duration_ms: duration }),
      ...(message ? { message } : {}),
      fingerprint: fingerprint(['junit', className, name, message ?? status]),
    });
    match = casePattern.exec(input);
  }
  if (records.length === 0) throw new Error('JUnit document contains no testcase elements');
  return {
    schema_version: '1',
    framework: 'junit',
    source,
    ingested_at: new Date().toISOString(),
    records,
    warnings: [],
  };
}

function recordValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`SAST result ${field} is required`);
  return value;
}

/** Normalize Semgrep-compatible JSON; other SAST tools can map to this shape upstream. */
export function parseSast(value: unknown, source = 'sast.json', tool = 'sast'): IngestReport {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('SAST document must be an object');
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.results)) throw new Error('SAST document must contain a results array');
  const records: IngestRecord[] = [];
  for (const [index, item] of root.results.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`SAST result ${index} must be an object`);
    const result = item as Record<string, unknown>;
    const extra =
      result.extra && typeof result.extra === 'object' && !Array.isArray(result.extra)
        ? (result.extra as Record<string, unknown>)
        : {};
    const checkId = recordValue(result.check_id, 'check_id');
    const path = recordValue(result.path, 'path');
    const message = typeof extra.message === 'string' ? extra.message.slice(0, 100_000) : undefined;
    const start =
      result.start && typeof result.start === 'object'
        ? (result.start as Record<string, unknown>)
        : {};
    const line =
      typeof start.line === 'number' && Number.isInteger(start.line) && start.line > 0
        ? start.line
        : undefined;
    const externalId = `${checkId}:${path}:${line ?? 0}`;
    records.push({
      id: `sast-${records.length + 1}`,
      framework: 'sast',
      external_id: externalId,
      name: message ?? checkId,
      status: 'failed',
      file: path,
      ...(line !== undefined ? { line } : {}),
      ...(typeof extra.severity === 'string' ? { severity: extra.severity } : {}),
      ...(message ? { message } : {}),
      rule_id: checkId,
      fingerprint: fingerprint([tool, checkId, path, String(line ?? 0), message ?? '']),
    });
  }
  const warnings = Array.isArray(root.errors)
    ? root.errors.filter((error): error is string => typeof error === 'string').slice(0, 100)
    : [];
  return {
    schema_version: '1',
    framework: 'sast',
    source,
    ingested_at: new Date().toISOString(),
    records,
    warnings,
  };
}

/** Normalize the stable JSON summary emitted by k6 after a load test. */
export function parseK6Summary(value: unknown, source = 'k6-summary.json'): IngestReport {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('k6 summary must be an object');
  const metrics = (value as Record<string, unknown>).metrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics))
    throw new Error('k6 summary must contain a metrics object');

  const records: IngestRecord[] = [];
  for (const [name, raw] of Object.entries(metrics as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error(`k6 metric ${name} must be an object`);
    const values = (raw as Record<string, unknown>).values;
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new Error(`k6 metric ${name} must contain values`);
    const numeric = Object.fromEntries(
      Object.entries(values as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    );
    if (Object.keys(numeric).length === 0) continue;
    const p95 = numeric['p(95)'];
    const rate = numeric.rate;
    const status: IngestStatus =
      name === 'http_req_failed' && rate !== undefined && rate > 0
        ? 'failed'
        : name === 'checks' && rate !== undefined && rate < 1
          ? 'failed'
          : 'passed';
    const detail = Object.entries(numeric)
      .slice(0, 20)
      .map(([key, metricValue]) => `${key}=${metricValue}`)
      .join(', ');
    records.push({
      id: `k6-${records.length + 1}`,
      framework: 'k6',
      external_id: name,
      name,
      status,
      ...(p95 === undefined ? {} : { duration_ms: Number(p95.toFixed(3)) }),
      ...(Object.keys(numeric).length > 0
        ? {
            measurements: {
              ...numeric,
              ...(name === 'http_req_failed' && rate !== undefined ? { failure_rate: rate } : {}),
              ...(name === 'checks' && rate !== undefined ? { check_rate: rate } : {}),
            },
          }
        : {}),
      message: detail,
      fingerprint: fingerprint(['k6', name, detail, status]),
    });
  }
  if (records.length === 0) throw new Error('k6 summary contains no numeric metrics');
  return {
    schema_version: '1',
    framework: 'k6',
    source,
    ingested_at: new Date().toISOString(),
    records,
    warnings: [],
  };
}

/** Normalize the JSON statistics export produced by Locust's web UI/API. */
export function parseLocustSummary(value: unknown, source = 'locust-summary.json'): IngestReport {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Locust summary must be an object');
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.stats)) throw new Error('Locust summary must contain a stats array');
  const records: IngestRecord[] = [];
  for (const [index, raw] of root.stats.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error(`Locust stat ${index} must be an object`);
    const stat = raw as Record<string, unknown>;
    const name = recordValue(stat.name, 'name');
    const method = typeof stat.method === 'string' ? stat.method : '';
    const failures = numericValue(stat.num_failures, 'num_failures', index);
    const requests = numericValue(stat.num_requests, 'num_requests', index);
    const percentiles =
      stat.response_time_percentiles &&
      typeof stat.response_time_percentiles === 'object' &&
      !Array.isArray(stat.response_time_percentiles)
        ? (stat.response_time_percentiles as Record<string, unknown>)
        : {};
    const p95 = firstNumeric(percentiles, ['0.95', '95', '0.950']);
    const status: IngestStatus = failures > 0 ? 'failed' : 'passed';
    const externalId = `${method ? `${method} ` : ''}${name}`;
    const detail = `requests=${requests}, failures=${failures}${p95 === undefined ? '' : `, p95=${p95}`}`;
    records.push({
      id: `locust-${records.length + 1}`,
      framework: 'locust',
      external_id: externalId,
      name: externalId,
      status,
      ...(p95 === undefined ? {} : { duration_ms: Number(p95.toFixed(3)) }),
      measurements: {
        requests,
        failures,
        failure_rate: requests === 0 ? 0 : failures / requests,
        ...(p95 === undefined ? {} : { p95_ms: p95 }),
      },
      message: detail,
      fingerprint: fingerprint(['locust', externalId, detail, status]),
    });
  }
  if (records.length === 0) throw new Error('Locust summary contains no stats');
  const warnings = Array.isArray(root.errors)
    ? root.errors.filter((error): error is string => typeof error === 'string').slice(0, 100)
    : [];
  return {
    schema_version: '1',
    framework: 'locust',
    source,
    ingested_at: new Date().toISOString(),
    records,
    warnings,
  };
}

/**
 * Apply explicit performance policy after parsing. Parsing preserves evidence;
 * this function is the separate, auditable pass/fail boundary for CI gates.
 */
export function evaluatePerformanceThresholds(
  report: IngestReport,
  policy: PerformanceThresholdPolicy,
): PerformanceThresholdResult {
  const entries = Object.entries(policy);
  if (entries.length === 0) throw new Error('performance threshold policy is empty');
  if (
    (policy.max_p95_ms !== undefined &&
      (!Number.isFinite(policy.max_p95_ms) || policy.max_p95_ms < 0)) ||
    (policy.max_failure_rate !== undefined &&
      (!Number.isFinite(policy.max_failure_rate) ||
        policy.max_failure_rate < 0 ||
        policy.max_failure_rate > 1)) ||
    (policy.min_check_rate !== undefined &&
      (!Number.isFinite(policy.min_check_rate) ||
        policy.min_check_rate < 0 ||
        policy.min_check_rate > 1))
  )
    throw new Error('performance threshold policy contains an invalid value');

  const violations: PerformanceThresholdViolation[] = [];
  for (const record of report.records) {
    const measurements = record.measurements ?? {};
    if (
      policy.max_p95_ms !== undefined &&
      record.duration_ms !== undefined &&
      record.duration_ms > policy.max_p95_ms
    )
      violations.push({
        record_id: record.id,
        metric: 'p95_ms',
        actual: record.duration_ms,
        expected: policy.max_p95_ms,
      });
    const failureRate = measurements.failure_rate;
    if (
      policy.max_failure_rate !== undefined &&
      failureRate !== undefined &&
      failureRate > policy.max_failure_rate
    )
      violations.push({
        record_id: record.id,
        metric: 'failure_rate',
        actual: failureRate,
        expected: policy.max_failure_rate,
      });
    const checkRate =
      measurements.check_rate ?? (record.external_id === 'checks' ? measurements.rate : undefined);
    if (
      policy.min_check_rate !== undefined &&
      checkRate !== undefined &&
      checkRate < policy.min_check_rate
    )
      violations.push({
        record_id: record.id,
        metric: 'check_rate',
        actual: checkRate,
        expected: policy.min_check_rate,
      });
  }
  return { passed: violations.length === 0, evaluated_records: report.records.length, violations };
}

function numericValue(value: unknown, field: string, index: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`Locust stat ${index} ${field} must be a non-negative number`);
  return value;
}

function firstNumeric(values: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}
