import { type Dirent, existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RiskMap } from '@aqa/schemas';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { lastPathSegment, slugify } from '../cli-utils.js';
import { type WriteResult, writeFileSafe } from '../fs-utils.js';

export type RiskDiscoverMethod = 'stride' | 'owasp' | 'fmea' | 'source';

export interface RiskDiscoverOptions {
  root: string;
  method: RiskDiscoverMethod;
  scope?: string;
  force?: boolean;
}

export interface RiskDiscoverResult {
  ok: boolean;
  error?: string;
  path?: string;
  write_result?: WriteResult;
  risk_count?: number;
  method?: RiskDiscoverMethod;
}

const STRIDE_BASELINE = [
  {
    key: 'spoofing',
    category: 'auth' as const,
    title: 'Unauthorized identity or session impersonation',
    statement: 'Every protected operation authenticates and authorizes the intended principal.',
    severity: 'high' as const,
    likelihood: 'likely' as const,
  },
  {
    key: 'tampering',
    category: 'integrity' as const,
    title: 'Unauthorized modification of data or commands',
    statement:
      'Untrusted input cannot alter persisted state or commands outside its authorization.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'repudiation',
    category: 'compliance' as const,
    title: 'Actions cannot be reliably attributed',
    statement: 'Security-relevant actions have an integrity-protected actor and timestamp trail.',
    severity: 'medium' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'information-disclosure',
    category: 'confidentiality' as const,
    title: 'Sensitive information crosses an unauthorized boundary',
    statement: 'Responses and artifacts contain no data outside the caller and tenant policy.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'denial-of-service',
    category: 'availability' as const,
    title: 'Resource exhaustion makes the service unavailable',
    statement: 'Untrusted work is bounded by timeout, size, concurrency and retry limits.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'elevation-of-privilege',
    category: 'auth' as const,
    title: 'A lower-privilege actor gains a higher-privilege capability',
    statement: 'Every privileged capability enforces role and tenant scope at the server boundary.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
] as const;

const OWASP_BASELINE = [
  {
    key: 'broken-access-control',
    category: 'auth' as const,
    title: 'Broken access control',
    statement:
      'Every object and action enforces server-side authorization for the authenticated tenant and role.',
    severity: 'critical' as const,
    likelihood: 'likely' as const,
  },
  {
    key: 'cryptographic-failures',
    category: 'confidentiality' as const,
    title: 'Cryptographic failures expose protected data',
    statement:
      'Sensitive data uses approved encryption in transit and at rest, with keys separated from artifacts and logs.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'injection',
    category: 'integrity' as const,
    title: 'Injection changes interpreter behavior',
    statement:
      'Untrusted input is parameterized or safely encoded before every interpreter, query, template or tool boundary.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'insecure-design',
    category: 'business_logic' as const,
    title: 'Insecure design violates abuse-case invariants',
    statement:
      'Security and business abuse cases are modeled before implementation and covered by executable invariants.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'security-misconfiguration',
    category: 'availability' as const,
    title: 'Security misconfiguration weakens the deployment',
    statement:
      'Production defaults deny unnecessary access, expose no debug surface and are continuously configuration-tested.',
    severity: 'high' as const,
    likelihood: 'likely' as const,
  },
  {
    key: 'vulnerable-components',
    category: 'compliance' as const,
    title: 'Vulnerable or unmaintained components enter production',
    statement:
      'Dependencies and container images are inventoried, pinned, scanned and blocked when policy thresholds are exceeded.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'authentication-failures',
    category: 'auth' as const,
    title: 'Authentication failures permit account compromise',
    statement:
      'Authentication resists replay, fixation, brute force and session theft, with explicit timeout and revocation rules.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'software-integrity-failures',
    category: 'integrity' as const,
    title: 'Untrusted updates or artifacts execute',
    statement:
      'Builds, packs, dependencies and runtime artifacts are integrity-verified before execution or deployment.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'logging-monitoring-failures',
    category: 'compliance' as const,
    title: 'Security events cannot be detected or reconstructed',
    statement:
      'Security decisions emit redacted, integrity-protected audit evidence with actionable alert coverage.',
    severity: 'medium' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'ssrf',
    category: 'integration' as const,
    title: 'Server-side request forgery crosses network boundaries',
    statement:
      'Outbound requests use an explicit allowlist, deny metadata/private targets and enforce redirect and DNS policies.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
] as const;

const FMEA_BASELINE = [
  {
    key: 'ambiguous-requirement',
    category: 'business_logic' as const,
    title: 'Ambiguous requirement causes an incorrect outcome',
    statement:
      'Every critical requirement has an observable acceptance condition and an executable oracle.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'invalid-input',
    category: 'integrity' as const,
    title: 'Invalid input propagates into a state mutation',
    statement:
      'Every external input is schema-validated at the boundary before it can change state.',
    severity: 'high' as const,
    likelihood: 'likely' as const,
  },
  {
    key: 'dependency-outage',
    category: 'availability' as const,
    title: 'Dependency outage creates an uncontrolled failure',
    statement:
      'Dependency timeouts, retries, fallback behavior and operator-visible failure states are bounded.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'concurrency-race',
    category: 'integrity' as const,
    title: 'Concurrent actors produce duplicate or lost effects',
    statement:
      'Shared effects are protected by idempotency, ordering or transactional concurrency controls.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'configuration-drift',
    category: 'compliance' as const,
    title: 'Configuration drift violates a safety control',
    statement:
      'Production configuration is versioned, validated and continuously checked against policy.',
    severity: 'medium' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'detection-gap',
    category: 'compliance' as const,
    title: 'A failure occurs without actionable detection',
    statement:
      'Each critical failure mode has a redacted signal, owner, alert threshold and replayable evidence path.',
    severity: 'medium' as const,
    likelihood: 'possible' as const,
  },
] as const;

const SOURCE_RULES = [
  {
    key: 'authentication-boundary',
    markers: [/jwt|jsonwebtoken|oauth|oidc|saml|webauthn|passport|next-auth|bearer/i],
    category: 'auth' as const,
    title: 'Authentication and authorization boundary can be bypassed',
    statement:
      'Every authenticated request enforces identity, role and tenant scope at the server boundary.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'interpreter-boundary',
    markers: [/postgres|mysql|sqlite|prisma|drizzle|sequelize|knex|sql/i],
    category: 'integrity' as const,
    title: 'Database or interpreter input can alter application state',
    statement:
      'External values are parameterized and read-only boundaries reject unintended mutations.',
    severity: 'critical' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'outbound-request',
    markers: [/fetch\s*\(|axios|undici|http:\/\/|https:\/\//i],
    category: 'integration' as const,
    title: 'Outbound request crosses an unintended network boundary',
    statement: 'Outbound requests use explicit origin, redirect, DNS and credential policies.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
  {
    key: 'secret-material',
    markers: [/\.env|api[_-]?key|secret|credential|vault|kms/i],
    category: 'confidentiality' as const,
    title: 'Secret material can leak through code, logs or artifacts',
    statement:
      'Secrets remain in an approved manager and are redacted before logs, artifacts or findings persist.',
    severity: 'high' as const,
    likelihood: 'possible' as const,
  },
] as const;

function projectName(root: string): string {
  const path = join(root, '.aqa', 'project.yaml');
  if (existsSync(path)) {
    try {
      const parsed = yamlParse(readFileSync(path, 'utf8')) as { name?: unknown };
      if (typeof parsed.name === 'string') return slugify(parsed.name);
    } catch {
      // Validation remains the responsibility of `aqa validate`; discovery uses a safe fallback.
    }
  }
  return slugify(lastPathSegment(root));
}

function safeScope(scope: string): string {
  const normalized = scope.trim();
  if (!normalized || normalized.length > 200 || normalized.includes('\0'))
    throw new Error('scope must be a non-empty string of at most 200 characters');
  if (normalized.split(/[\\/]/).some((part) => part === '..'))
    throw new Error('scope must not contain parent traversal');
  return normalized;
}

function sourceAwareBaseline(root: string, scope: string) {
  const files = collectSourceFiles(root);
  const reachable = reachableSourceFiles(root, files);
  const evidence = files
    .filter((file) => reachable.has(normalizePath(file)))
    .map((file) => ({ file, text: readBounded(join(root, file)) }));
  return SOURCE_RULES.filter((rule) => {
    const matches = evidence.some(({ file, text }) =>
      rule.markers.some((marker) => marker.test(`${file}\n${text}`)),
    );
    return matches;
  }).map((rule) => {
    const matchedFiles = evidence
      .filter(({ file, text }) => rule.markers.some((marker) => marker.test(`${file}\n${text}`)))
      .map(({ file }) => file)
      .slice(0, 5);
    return {
      ...rule,
      description: `Source-aware signal in scope ${scope}: ${matchedFiles.join(', ')}`,
      tags: [
        'source-aware',
        'reachability:bounded-import-graph',
        `scope:${slugify(scope)}`,
        ...matchedFiles.map((file) => `evidence:${slugify(file)}`),
      ],
    };
  });
}

const CODE_FILE = /\.(c|m)?(js|ts|tsx|jsx)$/i;
const IMPORT_SPECIFIER =
  /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Return files reachable through bounded relative JS/TS imports.
 *
 * This intentionally does not evaluate code or resolve package exports. It is
 * an evidence filter for the source heuristic, not a substitute for a real
 * compiler/module graph. Manifests remain visible because dependency
 * declarations are themselves a relevant boundary.
 */
function reachableSourceFiles(root: string, files: ReadonlyArray<string>): Set<string> {
  const known = new Set(files.map(normalizePath));
  const codeFiles = files.filter((file) => CODE_FILE.test(file));
  const imported = new Set<string>();
  const edges = new Map<string, string[]>();

  for (const file of codeFiles) {
    const text = readBounded(join(root, file));
    const targets: string[] = [];
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (!specifier?.startsWith('.')) continue;
      const target = resolveRelativeModule(file, specifier, known);
      if (target) {
        targets.push(target);
        imported.add(target);
      }
    }
    edges.set(normalizePath(file), targets);
  }

  const roots = codeFiles.filter((file) => !imported.has(normalizePath(file)));
  const conventionalEntries = roots.filter((file) =>
    /(?:^|\/)(?:index|main|app|server|cli|start|bootstrap)\.(?:c|m)?(?:js|ts|tsx|jsx)$/i.test(
      normalizePath(file),
    ),
  );
  const entries = conventionalEntries.length > 0 ? conventionalEntries : roots;
  const queue = entries.length > 0 ? entries.map(normalizePath) : codeFiles.map(normalizePath);
  const reachable = new Set<string>(
    files.filter((file) => !CODE_FILE.test(file)).map(normalizePath),
  );
  while (queue.length > 0 && reachable.size <= 200) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const target of edges.get(current) ?? []) {
      if (!reachable.has(target)) queue.push(target);
    }
  }
  return reachable;
}

function resolveRelativeModule(
  importer: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  const base = normalizePath(join(importer, '..', specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  return candidates.find((candidate) => known.has(normalizePath(candidate))) ?? null;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function collectSourceFiles(root: string): string[] {
  const result: string[] = [];
  const allowed = /\.(c|m)?(js|ts|tsx|jsx|py|go|java|rb|php|cs|rs|json|yaml|yml|toml|env|md)$/i;
  const visit = (directory: string): void => {
    if (result.length >= 200) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.length >= 200) return;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && allowed.test(entry.name)) result.push(relative(root, absolute));
    }
  };
  visit(root);
  return result;
}

function readBounded(relativePath: string): string {
  try {
    return readFileSync(relativePath, 'utf8').slice(0, 200_000);
  } catch {
    return '';
  }
}

export function runRiskDiscover(opts: RiskDiscoverOptions): RiskDiscoverResult {
  try {
    const scope = safeScope(opts.scope ?? 'repository');
    const aqaDir = join(opts.root, '.aqa');
    const target = join(aqaDir, 'risk-map.yaml');
    if (existsSync(aqaDir) && lstatSync(aqaDir).isSymbolicLink())
      throw new Error('.aqa is a symlink; refusing to write through it');
    if (existsSync(target) && lstatSync(target).isSymbolicLink())
      throw new Error('risk-map.yaml is a symlink; refusing to write through it');
    const baseline =
      opts.method === 'owasp'
        ? OWASP_BASELINE
        : opts.method === 'fmea'
          ? FMEA_BASELINE
          : opts.method === 'source'
            ? sourceAwareBaseline(opts.root, scope)
            : STRIDE_BASELINE;
    const risks = baseline.map((item) => ({
      id: `risk-${opts.method}-${item.key}`,
      category: item.category,
      title: item.title,
      description:
        'description' in item && typeof item.description === 'string'
          ? item.description
          : `Baseline ${opts.method.toUpperCase()} review for scope: ${scope}`,
      severity: item.severity,
      likelihood: item.likelihood,
      invariants: [{ id: `inv-${opts.method}-${item.key}`, statement: item.statement }],
      owners: [],
      tags: [
        `${opts.method}:${item.key}`,
        `scope:${slugify(scope)}`,
        ...('tags' in item && Array.isArray(item.tags) ? item.tags : []),
      ],
    }));
    if (risks.length === 0) {
      return { ok: true, path: target, risk_count: 0, method: opts.method };
    }
    const map = RiskMap.RiskMap.parse({
      schema_version: '1',
      project: projectName(opts.root),
      generated_at: new Date().toISOString(),
      risks,
    });
    const write_result = writeFileSafe(target, yamlStringify(map), { overwrite: opts.force });
    return {
      ok: true,
      path: target,
      write_result,
      risk_count: map.risks.length,
      method: opts.method,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
