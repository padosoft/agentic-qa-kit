/**
 * `aqa pack new <slug>` — scaffold a runnable pack on disk.
 *
 * The output is the smallest schema-valid pack that `aqa run` will execute
 * cleanly against the no-network probe stub: one risk, one scenario whose
 * `http_status` oracle expects 200 (which the stub returns by default).
 * That gives community authors a green starting point — they then replace
 * the placeholder probe URL + add real scenarios.
 *
 * The CLI accepts `--sut-type api|web|cli|lib|agent|pipeline`. The scaffold
 * adapts `applies_when.sut_type` and the example scenario's URL accordingly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PackManifest } from '@aqa/schemas';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

export interface PackNewOptions {
  root: string;
  slug: string;
  sutType: string;
  /** Overwrite an existing target directory. Defaults to false. */
  force?: boolean;
  description?: string;
  author?: string;
  license?: string;
}

export interface PackNewResult {
  ok: boolean;
  /** Absolute path to the scaffolded pack directory. Present only on success. */
  packDir?: string;
  /** Files created, relative to `packDir`. Present only on success. */
  files?: string[];
  error?: string;
}

const VALID_SUT_TYPES = new Set(['api', 'web', 'cli', 'lib', 'agent', 'pipeline']);
const SLUG_PATTERN = /^[a-z0-9](?:-?[a-z0-9])*$/;

function makeError(error: string): PackNewResult {
  return { ok: false, error };
}

/** Starter URL each SUT-type's example probe points at. Stub returns 200 either way. */
function exampleUrlFor(sutType: string): string {
  switch (sutType) {
    case 'api':
      return '/healthz';
    case 'web':
      return '/';
    case 'cli':
      return '/usage';
    case 'agent':
      return '/agent/ping';
    default:
      return '/';
  }
}

export function runPackNew(opts: PackNewOptions): PackNewResult {
  if (!opts.slug || opts.slug.trim() === '') {
    return makeError('slug is required');
  }
  if (!SLUG_PATTERN.test(opts.slug)) {
    return makeError(
      `slug "${opts.slug}" must be lowercase alphanumeric with single dashes (matches /^[a-z0-9](?:-?[a-z0-9])*$/)`,
    );
  }
  if (!VALID_SUT_TYPES.has(opts.sutType)) {
    return makeError(
      `unsupported sut-type "${opts.sutType}" — must be one of: ${[...VALID_SUT_TYPES].join(', ')}`,
    );
  }

  const packDir = isAbsolute(opts.slug) ? opts.slug : join(opts.root, opts.slug);
  if (existsSync(packDir) && !opts.force) {
    return makeError(`pack directory ${packDir} already exists; pass --force to overwrite`);
  }

  const description = opts.description ?? 'Pack scaffolded by aqa pack new';
  const author = opts.author ?? 'You';
  const license = opts.license ?? 'Apache-2.0';
  const exampleUrl = exampleUrlFor(opts.sutType);

  // Build the manifest object and validate against the canonical schema
  // before we touch the filesystem. Catches typos in the starter content
  // before they end up on disk.
  const manifest = {
    schema_version: '1' as const,
    name: opts.slug,
    version: '0.1.0',
    description,
    author,
    license,
    applies_when: {
      sut_type: [opts.sutType],
    },
    templates: [],
    scenarios: ['scenarios/starter.yaml'],
    risks: ['risks/starter.yaml'],
    oracles: [],
    probes: [],
  };
  const validated = PackManifest.PackManifest.safeParse(manifest);
  if (!validated.success) {
    return makeError(
      `generated manifest failed schema validation (this is a bug in aqa pack new — please report): ${validated.error.message}`,
    );
  }

  const scenarioYaml = yamlStringify({
    schema_version: '1',
    id: `scn-${opts.slug}-starter`,
    title: `Starter scenario for ${opts.slug} — replace with a real test`,
    risk_refs: [`r-${opts.slug}-starter`],
    invariant_refs: [`inv-${opts.slug}-starter`],
    preconditions: [],
    steps: [
      {
        id: 'probe-starter',
        kind: 'http',
        with: { method: 'GET', url: exampleUrl },
      },
    ],
    oracles: [
      {
        id: 'o-starter-ok',
        kind: 'http_status',
        // The no-network probe stub returns status=200, so this passes
        // out of the box. When you wire a real probe runner the oracle
        // will be checked against the actual server response.
        with: { expected: 200 },
      },
    ],
    tags: [opts.sutType, 'starter'],
  });

  const riskYaml = yamlStringify({
    schema_version: '1',
    project: opts.slug,
    risks: [
      {
        id: `r-${opts.slug}-starter`,
        category: 'integrity',
        title: 'Starter risk — replace with a real one',
        severity: 'medium',
        likelihood: 'possible',
        invariants: [
          {
            id: `inv-${opts.slug}-starter`,
            statement:
              'Replace this with the real invariant your scenarios prove. The current statement is a placeholder so the pack passes schema validation.',
          },
        ],
      },
    ],
  });

  const readmeMd = `# ${opts.slug}

Scaffolded by \`aqa pack new\`. Replace this with a real description.

## Files

- \`pack.yaml\` — the manifest. Update \`name\`, \`description\`, and \`applies_when\` to match your project.
- \`scenarios/starter.yaml\` — example scenario. Edit the probe URL + oracle to match real behavior.
- \`risks/starter.yaml\` — risk declaration. Replace the placeholder \`r-${opts.slug}-starter\` with the real risk you're proving.

## Run it

Drop this pack under \`<project>/packs/${opts.slug}/\` and reference it from \`.aqa/profiles.yaml\`:

\`\`\`yaml
profiles:
  smoke:
    name: smoke
    packs: [${opts.slug}]
    tags: [${opts.sutType}, starter]
\`\`\`

Then \`aqa run --profile smoke\` will pick it up.

See [\`docs/PACK-AUTHORING.md\`](../docs/PACK-AUTHORING.md) in the kit repo for the full pack authoring guide.
`;

  // All the content is built and validated. Now write to disk.
  mkdirSync(packDir, { recursive: true });
  mkdirSync(join(packDir, 'scenarios'), { recursive: true });
  mkdirSync(join(packDir, 'risks'), { recursive: true });
  writeFileSync(join(packDir, 'pack.yaml'), yamlStringify(manifest), 'utf8');
  writeFileSync(join(packDir, 'scenarios', 'starter.yaml'), scenarioYaml, 'utf8');
  writeFileSync(join(packDir, 'risks', 'starter.yaml'), riskYaml, 'utf8');
  writeFileSync(join(packDir, 'README.md'), readmeMd, 'utf8');
  writeFileSync(
    join(packDir, 'package.json'),
    JSON.stringify(
      {
        name: opts.slug,
        version: '0.1.0',
        description,
        license,
        author,
        files: ['pack.yaml', 'scenarios', 'risks', 'oracles', 'probes', 'README.md'],
        private: true,
      },
      null,
      2,
    ),
    'utf8',
  );

  // Re-validate by parsing what we wrote — catches any serializer divergence.
  const roundTrip = PackManifest.PackManifest.safeParse(
    yamlParse(readFileSync(join(packDir, 'pack.yaml'), 'utf8')),
  );
  if (!roundTrip.success) {
    return makeError(
      `scaffolded pack.yaml failed round-trip validation: ${roundTrip.error.message}`,
    );
  }

  return {
    ok: true,
    packDir,
    files: [
      'pack.yaml',
      'scenarios/starter.yaml',
      'risks/starter.yaml',
      'README.md',
      'package.json',
    ],
  };
}
