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

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PackManifest, RiskMap, Scenario } from '@aqa/schemas';
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
// Derived IDs prepend at most `inv-` (4 chars) and append `-starter` (8 chars).
// `Slug` schema allows up to 64 chars, so the user-supplied slug fragment must
// stay within (64 - 12) = 52 chars or `Scenario.parse` / `RiskMap.parse` will
// later reject the scaffolded files.
const MAX_SLUG_LEN = 52;

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
  if (opts.slug.length > MAX_SLUG_LEN) {
    return makeError(
      `slug "${opts.slug}" is ${opts.slug.length} chars; max ${MAX_SLUG_LEN} (derived scenario/risk IDs prepend "inv-" and append "-starter", and the underlying Slug schema caps at 64)`,
    );
  }
  if (!VALID_SUT_TYPES.has(opts.sutType)) {
    return makeError(
      `unsupported sut-type "${opts.sutType}" — must be one of: ${[...VALID_SUT_TYPES].join(', ')}`,
    );
  }

  // Scaffold into `<root>/packs/<slug>/` (not `<root>/<slug>/`) so the
  // pack ends up in a location `aqa run`'s `defaultPacksRoot()` actually
  // discovers. Otherwise the user would scaffold a pack, hit `aqa run`,
  // and see "0 scenarios" with no clue why. `resolve` always returns an
  // absolute path even if `opts.root` was relative; the SLUG_PATTERN
  // check above already rejects any slug containing `/` or `\`, so the
  // prior `isAbsolute(opts.slug)` branch was unreachable.
  const packDir = resolve(opts.root, 'packs', opts.slug);
  // Also check the `packs/` parent — a symlinked parent would let
  // `mkdirSync(packDir, { recursive: true })` follow the link and write
  // outside the project root. Both the parent and the leaf target are
  // refused if they're symlinks.
  const packsParent = resolve(opts.root, 'packs');
  if (existsSync(packsParent)) {
    try {
      if (lstatSync(packsParent).isSymbolicLink()) {
        return makeError(
          `parent directory ${packsParent} is a symlink — refusing to scaffold (would follow the link and write outside the project root)`,
        );
      }
    } catch (e) {
      return makeError(`cannot stat ${packsParent}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (existsSync(packDir)) {
    // Use lstat (not stat) so symlinks don't transparently pass the
    // directory check — following them with `mkdirSync` later would let a
    // malicious or accidental symlink overwrite files outside packDir.
    let isSymlink = false;
    try {
      isSymlink = lstatSync(packDir).isSymbolicLink();
    } catch {
      // unreadable — treat as a hard refusal below
    }
    if (isSymlink) {
      return makeError(
        `pack directory ${packDir} is a symlink — refusing to scaffold into it (would follow the link and write outside the pack root)`,
      );
    }
    if (!opts.force) {
      return makeError(`pack directory ${packDir} already exists; pass --force to overwrite`);
    }
    // `--force` mode: remove the existing tree (real directory, not a
    // symlink — we just rejected those) and recreate from scratch so we
    // don't merge stale files with the new scaffold.
    try {
      rmSync(packDir, { recursive: true, force: true });
    } catch (e) {
      return makeError(
        `cannot remove existing pack directory ${packDir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

  const scenarioObj = {
    schema_version: '1' as const,
    id: `scn-${opts.slug}-starter`,
    title: `Starter scenario for ${opts.slug} — replace with a real test`,
    risk_refs: [`r-${opts.slug}-starter`],
    invariant_refs: [`inv-${opts.slug}-starter`],
    preconditions: [],
    steps: [
      {
        id: 'probe-starter',
        kind: 'http' as const,
        with: { method: 'GET', url: exampleUrl },
      },
    ],
    oracles: [
      {
        id: 'o-starter-ok',
        kind: 'http_status' as const,
        // The no-network probe stub returns status=200, so this passes
        // out of the box. When you wire a real probe runner the oracle
        // will be checked against the actual server response.
        with: { expected: 200 },
      },
    ],
    tags: [opts.sutType, 'starter'],
  };
  const scenarioValid = Scenario.Scenario.safeParse(scenarioObj);
  if (!scenarioValid.success) {
    return makeError(
      `generated scenario failed schema validation (likely a too-long slug): ${scenarioValid.error.message}`,
    );
  }
  const scenarioYaml = yamlStringify(scenarioObj);

  const riskObj = {
    schema_version: '1' as const,
    project: opts.slug,
    risks: [
      {
        id: `r-${opts.slug}-starter`,
        category: 'integrity' as const,
        title: 'Starter risk — replace with a real one',
        severity: 'medium' as const,
        likelihood: 'possible' as const,
        invariants: [
          {
            id: `inv-${opts.slug}-starter`,
            statement:
              'Replace this with the real invariant your scenarios prove. The current statement is a placeholder so the pack passes schema validation.',
          },
        ],
      },
    ],
  };
  const riskValid = RiskMap.RiskMap.safeParse(riskObj);
  if (!riskValid.success) {
    return makeError(
      `generated risk map failed schema validation (likely a too-long slug): ${riskValid.error.message}`,
    );
  }
  const riskYaml = yamlStringify(riskObj);

  const readmeMd = `# ${opts.slug}

Scaffolded by \`aqa pack new\`. Replace this with a real description.

## Files

- \`pack.yaml\` — the manifest. Update \`name\`, \`description\`, and \`applies_when\` to match your project.
- \`scenarios/starter.yaml\` — example scenario. Edit the probe URL + oracle to match real behavior.
- \`risks/starter.yaml\` — risk declaration. Replace the placeholder \`r-${opts.slug}-starter\` with the real risk you're proving.

## Run it

Drop this pack under \`<project>/packs/${opts.slug}/\` and reference it from \`.aqa/profiles.yaml\`. To distribute it across projects: publish under your own npm scope (\`@your-scope/${opts.slug}\`) and have consumers either install it directly under \`<project>/packs/\` or use an npm alias into \`@aqa/*\` for auto-discovery (\`"@aqa/${opts.slug}": "npm:@your-scope/${opts.slug}"\` in their \`package.json\`). The snippet below is the smallest schema-valid form — both top-level \`schema_version\` and per-profile fields (\`schema_version\`, \`execution_mode\`) are required by \`@aqa/schemas/ProfilesFile\`:

\`\`\`yaml
schema_version: "1"
profiles:
  smoke:
    schema_version: "1"
    name: smoke
    execution_mode: orchestrator
    packs: ["${opts.slug}"]
    tags: ["${opts.sutType}", "starter"]
\`\`\`

Then \`aqa run --profile smoke\` will pick it up.

See the [pack authoring guide](https://github.com/padosoft/agentic-qa-kit/blob/main/docs/PACK-AUTHORING.md) for the full reference.
`;

  // All the content is built and validated. Wrap writes in try/catch so
  // any FS failure (permission, file-at-path, partial-write) returns a
  // structured error instead of throwing past the CLI's top handler.
  try {
    mkdirSync(packDir, { recursive: true });
    mkdirSync(resolve(packDir, 'scenarios'), { recursive: true });
    mkdirSync(resolve(packDir, 'risks'), { recursive: true });
    writeFileSync(resolve(packDir, 'pack.yaml'), yamlStringify(manifest), 'utf8');
    writeFileSync(resolve(packDir, 'scenarios', 'starter.yaml'), scenarioYaml, 'utf8');
    writeFileSync(resolve(packDir, 'risks', 'starter.yaml'), riskYaml, 'utf8');
    writeFileSync(resolve(packDir, 'README.md'), readmeMd, 'utf8');
    writeFileSync(
      resolve(packDir, 'package.json'),
      JSON.stringify(
        {
          name: opts.slug,
          version: '0.1.0',
          description,
          license,
          author,
          files: ['pack.yaml', 'scenarios', 'risks', 'oracles', 'probes', 'README.md'],
          // No `private: true` — pack authors need to be able to
          // `npm publish` straight from this scaffold without editing
          // package.json first. Setting `private: true` would make npm
          // refuse the publish.
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (e) {
    return makeError(
      `cannot write pack files to ${packDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Re-validate by parsing what we wrote — catches any serializer divergence.
  try {
    const roundTrip = PackManifest.PackManifest.safeParse(
      yamlParse(readFileSync(resolve(packDir, 'pack.yaml'), 'utf8')),
    );
    if (!roundTrip.success) {
      return makeError(
        `scaffolded pack.yaml failed round-trip validation: ${roundTrip.error.message}`,
      );
    }
  } catch (e) {
    return makeError(
      `cannot re-read scaffolded pack.yaml at ${packDir}: ${e instanceof Error ? e.message : String(e)}`,
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
