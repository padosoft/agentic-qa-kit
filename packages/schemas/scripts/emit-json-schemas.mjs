#!/usr/bin/env node
/**
 * Emit JSON Schema (Draft 2020-12) files from the Zod source of truth.
 * Output: packages/schemas/schemas/v1/<name>.schema.json
 *
 * Zod schemas are the source of truth. JSON Schemas are generated artifacts,
 * useful for editors (YAML/JSON LSP), third-party validators, and language ports.
 *
 * Two post-emit transforms keep the output Draft 2020-12 compliant:
 *
 *   1. zod-to-json-schema still emits Draft-4-style `exclusiveMinimum: true`
 *      and `exclusiveMaximum: true` next to `minimum`/`maximum`. In Draft
 *      2020-12 these keywords must be numbers. We rewrite them in place.
 *
 *   2. Zod's `superRefine` cannot be expressed in JSON Schema, so the
 *      "verified ⇒ deterministic floor" gating on Finding would be silently
 *      dropped. We add an explicit `allOf` of `if/then` clauses for each
 *      `verification_floor` value, so consumers validating findings via the
 *      shipped JSON Schema get the same gating as the Zod validator.
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
function patchFindingVerifiedGating(schema) {
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
  schema.allOf = [...(schema.allOf ?? []), ...allOf];
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
  if (schemaName === 'finding') patchFindingVerifiedGating(json);
  // Declare the dialect explicitly so consumers that default to an older draft
  // (e.g. ajv without the 2020-12 plugin) cannot silently mis-validate.
  json.$schema = 'https://json-schema.org/draft/2020-12/schema';
  const out = join(outDir, `${schemaName}.schema.json`);
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  emitted += 1;
  console.info(`[emit-json-schemas] wrote ${out}`);
}

console.info(`[emit-json-schemas] emitted ${emitted} schemas to ${outDir}`);
