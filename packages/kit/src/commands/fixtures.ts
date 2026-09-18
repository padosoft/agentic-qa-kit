import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9](?:-?[a-z0-9]){0,63}$/u;
const PII_KEY =
  /(?:email|phone|mobile|name|address|token|secret|password|ssn|iban|pan|cvv|customer[_-]?id|user[_-]?id)/iu;

export interface FixtureFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface FixtureManifest {
  schema_version: '1';
  fixture_id: string;
  created_at: string;
  anonymized: boolean;
  files: FixtureFile[];
}

export interface FixtureResult {
  ok: boolean;
  error?: string;
  fixturePath?: string;
  files?: number;
  bytes?: number;
}

export interface FixtureSnapshotOptions {
  root: string;
  source: string;
  fixtureId?: string;
  anonymize?: boolean;
}

export interface FixtureRestoreOptions {
  root: string;
  fixture: string;
  target: string;
  force?: boolean;
}

function safeRelative(path: string): boolean {
  if (!path || path.includes('\0') || path.startsWith('/') || path.startsWith('\\')) return false;
  const normalized = path.split(sep).join('/');
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function anonymizedValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const digest = sha256(Buffer.from(`aqa-fixture:${key}:${String(value)}`, 'utf8')).slice(0, 16);
  if (/email/iu.test(key)) return `fixture-${digest}@example.invalid`;
  if (/phone|mobile/iu.test(key)) return `+1000${digest.slice(0, 10)}`;
  return `fixture-${digest}`;
}

function anonymizeJson(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymizeJson(item, parentKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        PII_KEY.test(key) ? anonymizedValue(key, item) : anonymizeJson(item, key),
      ]),
    );
  }
  return PII_KEY.test(parentKey) ? anonymizedValue(parentKey, value) : value;
}

function collectJsonFiles(source: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') files.push(path);
    }
  };
  walk(source);
  return files;
}

function parseManifest(value: unknown): FixtureManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('manifest must be an object');
  const m = value as Record<string, unknown>;
  if (m.schema_version !== '1' || typeof m.fixture_id !== 'string' || !SAFE_ID.test(m.fixture_id))
    throw new Error('manifest schema or fixture_id is invalid');
  if (
    typeof m.anonymized !== 'boolean' ||
    typeof m.created_at !== 'string' ||
    Number.isNaN(Date.parse(m.created_at)) ||
    !Array.isArray(m.files) ||
    m.files.length > MAX_FILES
  )
    throw new Error('manifest files or anonymized field is invalid');
  const seenPaths = new Set<string>();
  const files = m.files.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('manifest file is invalid');
    const f = item as Record<string, unknown>;
    if (
      typeof f.path !== 'string' ||
      !safeRelative(f.path) ||
      seenPaths.has(f.path) ||
      typeof f.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(f.sha256) ||
      typeof f.bytes !== 'number' ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > MAX_FILE_BYTES
    )
      throw new Error('manifest file entry is invalid');
    seenPaths.add(f.path);
    return { path: f.path, sha256: f.sha256, bytes: f.bytes };
  });
  return {
    schema_version: '1',
    fixture_id: m.fixture_id,
    created_at: m.created_at,
    anonymized: m.anonymized,
    files,
  };
}

export function runFixturesSnapshot(opts: FixtureSnapshotOptions): FixtureResult {
  try {
    const source = resolve(opts.root, opts.source);
    if (!existsSync(source) || !statSync(source).isDirectory())
      return { ok: false, error: 'source directory not found' };
    const fixtureId =
      opts.fixtureId ??
      basename(source)
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-');
    if (!SAFE_ID.test(fixtureId))
      return { ok: false, error: 'fixture id must be a lowercase slug' };
    const sourceFiles = collectJsonFiles(source);
    if (sourceFiles.length === 0) return { ok: false, error: 'source contains no JSON files' };
    if (sourceFiles.length > MAX_FILES) return { ok: false, error: 'fixture file limit exceeded' };
    const fixturePath = join(opts.root, '.aqa', 'fixtures', fixtureId);
    if (existsSync(fixturePath))
      return { ok: false, error: 'fixture already exists; remove it before replacing' };
    const dataPath = join(fixturePath, 'data');
    mkdirSync(dataPath, { recursive: true });
    let totalBytes = 0;
    const files: FixtureFile[] = [];
    for (const sourceFile of sourceFiles) {
      const relativePath = relative(source, sourceFile).split(sep).join('/');
      if (!safeRelative(relativePath)) throw new Error('unsafe source path');
      const raw = readFileSync(sourceFile);
      if (raw.byteLength > MAX_FILE_BYTES || totalBytes + raw.byteLength > MAX_TOTAL_BYTES)
        throw new Error('fixture size limit exceeded');
      let output = raw;
      if (opts.anonymize) {
        const parsed: unknown = JSON.parse(raw.toString('utf8'));
        output = Buffer.from(`${JSON.stringify(anonymizeJson(parsed), null, 2)}\n`, 'utf8');
      }
      const destination = join(dataPath, relativePath);
      mkdirSync(join(destination, '..'), { recursive: true });
      writeFileSync(destination, output, { flag: 'wx' });
      files.push({ path: relativePath, sha256: sha256(output), bytes: output.byteLength });
      totalBytes += output.byteLength;
    }
    const manifest: FixtureManifest = {
      schema_version: '1',
      fixture_id: fixtureId,
      created_at: new Date().toISOString(),
      anonymized: opts.anonymize === true,
      files,
    };
    writeFileSync(join(fixturePath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    return {
      ok: true,
      fixturePath: relative(opts.root, fixturePath),
      files: files.length,
      bytes: totalBytes,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function runFixturesRestore(opts: FixtureRestoreOptions): FixtureResult {
  try {
    const fixturePath = resolve(opts.root, opts.fixture);
    if (!isWithin(opts.root, fixturePath))
      throw new Error('fixture path must stay under project root');
    const manifest = parseManifest(
      JSON.parse(readFileSync(join(fixturePath, 'manifest.json'), 'utf8')),
    );
    if (manifest.fixture_id !== basename(fixturePath))
      throw new Error('fixture path does not match manifest id');
    const target = resolve(opts.root, opts.target);
    if (!isWithin(opts.root, target))
      throw new Error('restore target must stay under project root');
    mkdirSync(target, { recursive: true });
    let totalBytes = 0;
    for (const file of manifest.files) {
      const source = join(fixturePath, 'data', file.path);
      const destination = join(target, file.path);
      if (!existsSync(source) || !safeRelative(file.path))
        throw new Error(`fixture member missing or unsafe: ${file.path}`);
      const bytes = readFileSync(source);
      if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256)
        throw new Error(`fixture integrity mismatch: ${file.path}`);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('fixture size limit exceeded');
      mkdirSync(join(destination, '..'), { recursive: true });
      if (!opts.force && existsSync(destination)) throw new Error(`target exists: ${file.path}`);
      writeFileSync(destination, bytes);
    }
    return {
      ok: true,
      fixturePath: relative(opts.root, fixturePath),
      files: manifest.files.length,
      bytes: totalBytes,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
