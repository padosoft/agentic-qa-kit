import { createHash } from 'node:crypto';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export type IngestFramework = 'junit' | 'sast';
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
