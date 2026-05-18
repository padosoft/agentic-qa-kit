import assert from 'node:assert/strict';
/**
 * Ajv 2020 round-trip: every valid fixture should pass the emitted JSON
 * Schema; every invalid fixture should fail. This catches divergence
 * between the Zod source-of-truth and the emitted Draft 2020-12 schemas
 * (issue #3).
 *
 * Notes:
 * - The schemas folder is `packages/schemas/schemas/v1/<name>.schema.json`.
 * - Fixtures are `packages/schemas/fixtures/{valid,invalid}/<name>.json`,
 *   sometimes with a kebab suffix for the failure mode.
 * - Invalid fixtures cover failure modes that JSON Schema CAN express
 *   (bad enum value, bad hash, verified-without-determinism). Pure
 *   cross-field invariants (e.g. Run.finished_at >= started_at) are
 *   documented via `$comment` on the schema and not asserted here — Zod
 *   continues to be the authoritative validator for those.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SCHEMAS_DIR = join(ROOT, 'schemas', 'v1');
const VALID_DIR = join(ROOT, 'fixtures', 'valid');
const INVALID_DIR = join(ROOT, 'fixtures', 'invalid');

function makeAjv() {
  // biome-ignore lint/suspicious/noExplicitAny: ajv 2020 default-export shape varies by build
  const Ajv = (Ajv2020 as any).default ?? Ajv2020;
  const ajv = new Ajv({ strict: false, allErrors: true });
  // biome-ignore lint/suspicious/noExplicitAny: addFormats default-export shape varies by build
  const af = (addFormats as any).default ?? addFormats;
  af(ajv);
  return ajv;
}

function loadJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function compile(schemaName: string) {
  const ajv = makeAjv();
  const schema = loadJson(join(SCHEMAS_DIR, `${schemaName}.schema.json`));
  return ajv.compile(schema as Record<string, unknown>);
}

function fixtureName(file: string): string {
  return file.replace(/\.json$/, '').split('--')[0] ?? file;
}

describe('Ajv 2020 round-trip — valid fixtures', () => {
  const files = readdirSync(VALID_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const schemaName = fixtureName(file);
    it(`valid/${file} validates against ${schemaName}.schema.json`, () => {
      const validate = compile(schemaName);
      const data = loadJson(join(VALID_DIR, file));
      const ok = validate(data);
      assert.ok(ok, `expected valid, got errors: ${JSON.stringify(validate.errors, null, 2)}`);
    });
  }
});

describe('Ajv 2020 round-trip — invalid fixtures', () => {
  const files = readdirSync(INVALID_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const schemaName = fixtureName(file);
    it(`invalid/${file} fails against ${schemaName}.schema.json`, () => {
      const validate = compile(schemaName);
      const data = loadJson(join(INVALID_DIR, file));
      const ok = validate(data);
      assert.equal(ok, false, 'expected invalid, but validator accepted it');
    });
  }
});

describe('Issue #3 — patched cross-field rules', () => {
  it('Finding with status=duplicate without duplicate_of fails', () => {
    const validate = compile('finding');
    const valid = loadJson(join(VALID_DIR, 'finding.json')) as Record<string, unknown>;
    const { duplicate_of: _omit, ...rest } = valid as Record<string, unknown>;
    const bad = { ...rest, status: 'duplicate' };
    assert.equal(validate(bad), false);
  });

  it('Finding with reproducibility.bug_level.deterministic=true and attempts=0 fails', () => {
    const validate = compile('finding');
    const valid = loadJson(join(VALID_DIR, 'finding.json')) as Record<string, unknown> & {
      reproducibility: Record<
        string,
        { deterministic: boolean; attempts: number; successes: number }
      >;
    };
    const bad = {
      ...valid,
      reproducibility: {
        ...valid.reproducibility,
        bug_level: { deterministic: true, attempts: 0, successes: 0 },
      },
    };
    assert.equal(validate(bad), false);
  });

  it('emitted schemas carry $comment for cross-field invariants', () => {
    const finding = loadJson(join(SCHEMAS_DIR, 'finding.schema.json')) as Record<string, unknown>;
    assert.match(String(finding.$comment ?? ''), /duplicate_of !== id/);
    const run = loadJson(join(SCHEMAS_DIR, 'run.schema.json')) as Record<string, unknown>;
    assert.match(String(run.$comment ?? ''), /finished_at >= started_at/);
    const profiles = loadJson(join(SCHEMAS_DIR, 'profiles-file.schema.json')) as Record<
      string,
      unknown
    >;
    assert.match(String(profiles.$comment ?? ''), /profile\.name === key/);
  });
});
