import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';
import { z } from 'zod';
import type { LoadedPack } from './loader.js';

const ResourceProbeKind = z.enum(['http', 'shell', 'sql', 'playwright', 'llm_eval', 'fs']);
const ResourceOracleKind = z.enum([
  'http_status',
  'response_contains',
  'response_not_contains',
  'json_schema',
  'db_query',
  'semantic_llm_judge',
]);

const CustomProbe = z
  .object({
    schema_version: z.literal('1').default('1'),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    kind: ResourceProbeKind,
    with: z.record(z.string(), z.unknown()).default({}),
    template: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
    timeout_ms: z.number().int().positive().max(600_000).default(30_000),
  })
  .passthrough();

const CustomOracle = z
  .object({
    schema_version: z.literal('1').default('1'),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    kind: ResourceOracleKind,
    probe_id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    with: z.record(z.string(), z.unknown()).default({}),
    description: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    weight: z.number().min(0).max(1).default(1),
  })
  .passthrough();

type CustomProbeDefinition = z.output<typeof CustomProbe>;
type CustomOracleDefinition = z.output<typeof CustomOracle>;

export interface PackResources {
  probes: ReadonlyMap<string, Scenario.Probe>;
  oracles: ReadonlyMap<string, Scenario.Oracle>;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function resourcePath(packRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`resource path must be relative: ${relativePath}`);
  const root = realpathSync(packRoot);
  const absolute = resolve(packRoot, relativePath);
  if (!inside(packRoot, absolute))
    throw new Error(`resource path escapes pack root: ${relativePath}`);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile())
    throw new Error(`resource file is missing: ${relativePath}`);
  const real = realpathSync(absolute);
  if (!inside(root, real)) throw new Error(`resource symlink escapes pack root: ${relativePath}`);
  return real;
}

function parseResource<S extends z.ZodTypeAny>(path: string, schema: S, kind: string): z.output<S> {
  let parsed: unknown;
  try {
    parsed = yamlParse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${kind} ${path}: YAML parse error — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${kind} ${path}: invalid definition — ${detail}`);
  }
  return result.data;
}

function normalizeProbe(definition: CustomProbeDefinition): Scenario.Probe {
  return {
    id: definition.id,
    kind: definition.kind,
    with: Object.keys(definition.with).length > 0 ? definition.with : (definition.template ?? {}),
    timeout_ms: definition.timeout_ms,
  };
}

function normalizeOracle(definition: CustomOracleDefinition): Scenario.Oracle {
  return {
    id: definition.id,
    kind: definition.kind,
    ...(definition.probe_id ? { probe_id: definition.probe_id } : {}),
    with: definition.with,
    weight: definition.weight,
  };
}

/** Load manifest-declared resources and reject every missing, unsafe or duplicate entry. */
export function loadPackResources(pack: LoadedPack): PackResources {
  const probes = new Map<string, Scenario.Probe>();
  const oracles = new Map<string, Scenario.Oracle>();
  for (const relativePath of pack.manifest.probes ?? []) {
    const path = resourcePath(pack.root, relativePath);
    const definition = parseResource(path, CustomProbe, 'probe');
    if (probes.has(definition.id)) throw new Error(`duplicate custom probe id: ${definition.id}`);
    probes.set(definition.id, normalizeProbe(definition));
  }
  for (const relativePath of pack.manifest.oracles ?? []) {
    const path = resourcePath(pack.root, relativePath);
    const definition = parseResource(path, CustomOracle, 'oracle');
    if (oracles.has(definition.id)) throw new Error(`duplicate custom oracle id: ${definition.id}`);
    oracles.set(definition.id, normalizeOracle(definition));
  }
  return { probes, oracles };
}

/** Expand `kind: custom` references into validated, immutable built-in contracts. */
export function resolvePackScenario(
  scenario: Scenario.Scenario,
  resources: PackResources,
): Scenario.Scenario {
  const steps = scenario.steps.map((step) => {
    if (step.kind !== 'custom' || step.with.ref === undefined) return step;
    const ref = step.with.ref;
    if (typeof ref !== 'string' || Object.keys(step.with).length !== 1)
      throw new Error(`custom probe "${step.id}" requires only with.ref`);
    const definition = resources.probes.get(ref);
    if (!definition) throw new Error(`custom probe reference not found: ${ref}`);
    return { ...definition, id: step.id };
  });
  const cleanup = scenario.cleanup.map((step) => {
    if (step.kind !== 'custom' || step.with.ref === undefined) return step;
    const ref = step.with.ref;
    if (typeof ref !== 'string' || Object.keys(step.with).length !== 1)
      throw new Error(`custom cleanup probe "${step.id}" requires only with.ref`);
    const definition = resources.probes.get(ref);
    if (!definition) throw new Error(`custom probe reference not found: ${ref}`);
    return { ...definition, id: step.id };
  });
  const oracles = scenario.oracles.map((oracle) => {
    if (oracle.kind !== 'custom' || oracle.with.ref === undefined) return oracle;
    const ref = oracle.with.ref;
    if (typeof ref !== 'string' || Object.keys(oracle.with).length !== 1)
      throw new Error(`custom oracle "${oracle.id}" requires only with.ref`);
    const definition = resources.oracles.get(ref);
    if (!definition) throw new Error(`custom oracle reference not found: ${ref}`);
    return { ...definition, id: oracle.id, weight: oracle.weight };
  });
  return Scenario.Scenario.parse({ ...scenario, steps, cleanup, oracles });
}
