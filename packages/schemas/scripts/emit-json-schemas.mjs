#!/usr/bin/env node
/**
 * Emit JSON Schema (Draft 2020-12) files from the Zod source of truth.
 * Output: packages/schemas/schemas/v1/<name>.schema.json
 *
 * Zod schemas are the source of truth. JSON Schemas are generated artifacts,
 * useful for editors (YAML/JSON LSP), third-party validators, and language ports.
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
  const out = join(outDir, `${schemaName}.schema.json`);
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  emitted += 1;
  console.info(`[emit-json-schemas] wrote ${out}`);
}

console.info(`[emit-json-schemas] emitted ${emitted} schemas to ${outDir}`);
