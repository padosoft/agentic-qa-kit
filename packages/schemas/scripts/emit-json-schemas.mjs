#!/usr/bin/env node
/**
 * Emit JSON Schema (Draft 2020-12) files from the Zod source of truth.
 * Output: packages/schemas/schemas/v1/<name>.schema.json
 *
 * Zod schemas are the source of truth. JSON Schemas are generated artifacts,
 * useful for editors (YAML/JSON LSP), third-party validators, and language ports.
 *
 * Post-emit transforms keep the output Draft 2020-12 compliant and mirror the
 * cross-field invariants the Zod superRefine layer enforces:
 *
 *   1. fixExclusiveBounds — rewrite Draft-4-style `exclusiveMinimum: true` /
 *      `exclusiveMaximum: true` into the Draft 2020-12 numeric form.
 *   2. patchFindingVerifiedGating — encode "status='verified' ⇒
 *      reproducibility[verification_floor].deterministic === true" as
 *      `allOf` of `if/then` clauses, one per verification_floor.
 *   3. patchRunTerminalGating — encode "terminal state ⇒ finished_at required"
 *      and "non-terminal state ⇒ finished_at forbidden".
 *   4. patchReproLevelDeterministic — `deterministic=true ⇒ attempts >= 1`.
 *      The `successes === attempts` half of the rule is cross-field and
 *      surfaced via `$comment`.
 *   5. patchFindingDuplicateOf — `status='duplicate' ⇒ duplicate_of required`.
 *      `duplicate_of !== id` is cross-field and surfaced via `$comment`.
 *   6. patchProfilesFileNameKey — `$comment` documenting that each entry's
 *      `profile.name === key`; JSON Schema cannot bind a property key to
 *      a sub-property value.
 *
 * Remaining cross-field invariants enforced only by Zod (with `$comment`
 * notice on the emitted schema) — consumers validating via JSON Schema
 * must re-check them at the application layer:
 *   - ReproLevel: `successes <= attempts`, `deterministic && successes === attempts`
 *   - Finding:    `duplicate_of !== id`
 *   - ProfilesFile: `entries[key].profile.name === key`
 *   - Run:        `finished_at >= started_at`
 *
 * An Ajv 2020 round-trip test (`test/ajv-roundtrip.test.ts`) validates
 * the shipped fixtures against the emitted JSON Schemas so a divergence
 * between layers fails the build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const distDir = join(pkgRoot, 'dist');
const outDir = join(pkgRoot, 'schemas', 'v1');

mkdirSync(outDir, { recursive: true });

const modules = [
  { file: 'project.js', exportName: 'Project', schemaName: 'project' },
  { file: 'profile.js', exportName: 'Profile', schemaName: 'profile' },
  { file: 'profile.js', exportName: 'ProfilesFile', schemaName: 'profiles-file' },
  { file: 'risk-map.js', exportName: 'RiskMap', schemaName: 'risk-map' },
  { file: 'scenario.js', exportName: 'Scenario', schemaName: 'scenario' },
  { file: 'finding.js', exportName: 'Finding', schemaName: 'finding' },
  { file: 'event.js', exportName: 'Event', schemaName: 'event' },
  { file: 'run.js', exportName: 'Run', schemaName: 'run' },
  { file: 'pack-manifest.js', exportName: 'PackManifest', schemaName: 'pack-manifest' },
  // v1.4 admin surface — Zod namespaces that back the admin API.
  { file: 'notification.js', exportName: 'Notification', schemaName: 'notification' },
  { file: 'saved-view.js', exportName: 'SavedView', schemaName: 'saved-view' },
  { file: 'api-token.js', exportName: 'ApiToken', schemaName: 'api-token' },
  { file: 'cost-summary.js', exportName: 'CostSummary', schemaName: 'cost-summary' },
  { file: 'tenancy.js', exportName: 'Org', schemaName: 'org' },
  { file: 'tenancy.js', exportName: 'ProjectRef', schemaName: 'project-ref' },
  { file: 'sso-config.js', exportName: 'SsoConfig', schemaName: 'sso-config' },
];

/**
 * Rewrite Draft-4-style boolean exclusiveMinimum/exclusiveMaximum into
 * the Draft 2020-12 numeric form. Operates in-place on a JSON value.
 */
function fixExclusiveBounds(node) {
  if (Array.isArray(node)) {
    for (const item of node) fixExclusiveBounds(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const bound of ['exclusiveMinimum', 'exclusiveMaximum']) {
    if (node[bound] === true) {
      const sibling = bound === 'exclusiveMinimum' ? 'minimum' : 'maximum';
      if (typeof node[sibling] !== 'number') {
        // Strict failure: Draft 2020-12 requires `exclusiveMinimum`/`exclusiveMaximum`
        // to be a number. We cannot silently leave the Draft-4 boolean form in place
        // without producing an invalid schema. Fail the build so the developer
        // either pins `zod-to-json-schema` to a known-good version or extends this
        // function to handle the unexpected emission shape.
        throw new Error(
          `[emit-json-schemas] cannot fix ${bound}: expected numeric sibling "${sibling}", got ${JSON.stringify(node[sibling])}`,
        );
      }
      node[bound] = node[sibling];
      delete node[sibling];
    } else if (node[bound] === false) {
      delete node[bound];
    }
  }
  for (const value of Object.values(node)) fixExclusiveBounds(value);
}

/**
 * Add Finding's "status=verified ⇒ reproducibility[verification_floor].deterministic"
 * gating to the JSON Schema via if/then clauses. Mirrors the Zod superRefine.
 */
/**
 * Mirror Run's superRefine into the JSON Schema: terminal states require
 * `finished_at`; non-terminal states forbid it; `finished_at >= started_at`
 * cannot be expressed in pure JSON Schema, so we surface it via description.
 */
/** zod-to-json-schema wraps the root under `#/definitions/<name>` and
 * sets `$ref` at the top. Patches that drill into `properties` need to
 * resolve that indirection. Returns the inner object that carries
 * `properties` / `required` / `additionalProperties`. */
function resolveDefinition(schema, schemaName) {
  if (schema?.definitions && schemaName in schema.definitions) {
    return schema.definitions[schemaName];
  }
  return schema;
}

function patchRunTerminalGating(schema) {
  const root = resolveDefinition(schema, 'run');
  const terminal = ['succeeded', 'failed', 'aborted', 'budget_exceeded'];
  const nonTerminal = ['pending', 'running'];
  const allOf = [
    {
      if: { properties: { state: { enum: terminal } }, required: ['state'] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword
      then: { required: ['finished_at'] },
    },
    {
      if: { properties: { state: { enum: nonTerminal } }, required: ['state'] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword
      then: { not: { required: ['finished_at'] } },
    },
  ];
  root.allOf = [...(root.allOf ?? []), ...allOf];
  schema.$comment =
    'finished_at >= started_at is enforced by the Zod validator; JSON Schema cannot express the cross-field comparison.';
}

/**
 * Mirror Finding.duplicate_of superRefine: `status='duplicate'` requires
 * `duplicate_of` to be present. The `duplicate_of !== id` half is a
 * cross-field comparison flagged via `$comment`.
 */
function patchFindingDuplicateOf(schema) {
  const root = resolveDefinition(schema, 'finding');
  const allOf = [
    {
      if: { properties: { status: { const: 'duplicate' } }, required: ['status'] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword
      then: { required: ['duplicate_of'] },
    },
  ];
  root.allOf = [...(root.allOf ?? []), ...allOf];
  const existing = typeof schema.$comment === 'string' ? `${schema.$comment} ` : '';
  schema.$comment = `${existing}duplicate_of !== id is enforced by the Zod validator; JSON Schema cannot express the cross-field comparison.`;
}

/**
 * Mirror ReproLevel's superRefine: `deterministic=true ⇒ attempts >= 1`.
 * The `successes === attempts` half is cross-field — flagged via `$comment`.
 */
function patchReproLevelDeterministic(schema) {
  const root = resolveDefinition(schema, 'finding');
  const repro = root?.properties?.reproducibility?.properties;
  if (!repro) return;
  for (const floor of ['bug_level', 'scenario_level', 'agent_level']) {
    const level = repro[floor];
    if (!level || typeof level !== 'object') continue;
    const allOf = [
      {
        if: { properties: { deterministic: { const: true } }, required: ['deterministic'] },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword
        then: { properties: { attempts: { minimum: 1 } } },
      },
    ];
    level.allOf = [...(level.allOf ?? []), ...allOf];
    const existing = typeof level.$comment === 'string' ? `${level.$comment} ` : '';
    level.$comment = `${existing}successes <= attempts, and deterministic=true => successes === attempts, are enforced by the Zod validator; JSON Schema cannot express the cross-field comparisons.`;
  }
}

/**
 * Document ProfilesFile's superRefine via `$comment` — JSON Schema cannot
 * bind a property key to a sub-property value of the same entry.
 */
function patchProfilesFileNameKey(schema) {
  const existing = typeof schema.$comment === 'string' ? `${schema.$comment} ` : '';
  schema.$comment = `${existing}For each entry under profiles, profile.name === key is enforced by the Zod validator; JSON Schema cannot express the key/value binding.`;
}

function patchFindingVerifiedGating(schema) {
  const root = resolveDefinition(schema, 'finding');
  // `if`/`then`/`else` are JSON Schema 2020-12 keywords. Building the object via
  // bracket assignment avoids tripping lint rules that flag `.then` (intended to
  // catch accidental Promise-like properties, irrelevant here).
  const floors = ['bug_level', 'scenario_level', 'agent_level'];
  const allOf = floors.map((floor) => {
    const ifBranch = {
      properties: {
        status: { const: 'verified' },
        verification_floor: { const: floor },
      },
      required: ['status', 'verification_floor'],
    };
    const thenBranch = {
      properties: {
        reproducibility: {
          type: 'object',
          properties: {
            [floor]: {
              type: 'object',
              properties: { deterministic: { const: true } },
              required: ['deterministic'],
            },
          },
          required: [floor],
        },
      },
      required: ['reproducibility'],
    };
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema's `then` keyword
    return { if: ifBranch, then: thenBranch };
  });
  root.allOf = [...(root.allOf ?? []), ...allOf];
}

let emitted = 0;
for (const { file, exportName, schemaName } of modules) {
  const mod = await import(pathToFileURL(join(distDir, file)).href);
  const zod = mod[exportName];
  if (!zod) {
    console.error(`[emit-json-schemas] missing export "${exportName}" in ${file}`);
    process.exit(1);
  }
  const json = zodToJsonSchema(zod, {
    target: 'jsonSchema2020-12',
    name: schemaName,
    $refStrategy: 'none',
  });
  fixExclusiveBounds(json);
  if (schemaName === 'finding') {
    patchFindingVerifiedGating(json);
    patchFindingDuplicateOf(json);
    patchReproLevelDeterministic(json);
  }
  if (schemaName === 'run') patchRunTerminalGating(json);
  if (schemaName === 'profiles-file') patchProfilesFileNameKey(json);
  // Declare the dialect explicitly so consumers that default to an older draft
  // (e.g. ajv without the 2020-12 plugin) cannot silently mis-validate.
  json.$schema = 'https://json-schema.org/draft/2020-12/schema';
  const out = join(outDir, `${schemaName}.schema.json`);
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  emitted += 1;
  console.info(`[emit-json-schemas] wrote ${out}`);
}

console.info(`[emit-json-schemas] emitted ${emitted} schemas to ${outDir}`);
