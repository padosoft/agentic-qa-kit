import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RiskMap } from '@aqa/schemas';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { lastPathSegment, slugify } from '../cli-utils.js';
import { type WriteResult, writeFileSafe } from '../fs-utils.js';

export type RiskDiscoverMethod = 'stride' | 'owasp';

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

export function runRiskDiscover(opts: RiskDiscoverOptions): RiskDiscoverResult {
  try {
    const scope = safeScope(opts.scope ?? 'repository');
    const aqaDir = join(opts.root, '.aqa');
    const target = join(aqaDir, 'risk-map.yaml');
    if (existsSync(aqaDir) && lstatSync(aqaDir).isSymbolicLink())
      throw new Error('.aqa is a symlink; refusing to write through it');
    if (existsSync(target) && lstatSync(target).isSymbolicLink())
      throw new Error('risk-map.yaml is a symlink; refusing to write through it');
    const baseline = opts.method === 'owasp' ? OWASP_BASELINE : STRIDE_BASELINE;
    const risks = baseline.map((item) => ({
      id: `risk-${opts.method}-${item.key}`,
      category: item.category,
      title: item.title,
      description: `Baseline ${opts.method.toUpperCase()} review for scope: ${scope}`,
      severity: item.severity,
      likelihood: item.likelihood,
      invariants: [{ id: `inv-${opts.method}-${item.key}`, statement: item.statement }],
      owners: [],
      tags: [`${opts.method}:${item.key}`, `scope:${slugify(scope)}`],
    }));
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
