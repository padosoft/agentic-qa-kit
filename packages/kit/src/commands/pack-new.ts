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

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
    let parentStat: ReturnType<typeof lstatSync>;
    try {
      parentStat = lstatSync(packsParent);
    } catch (e) {
      return makeError(`cannot stat ${packsParent}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (parentStat.isSymbolicLink()) {
      return makeError(
        `parent directory ${packsParent} is a symlink — refusing to scaffold (would follow the link and write outside the project root)`,
      );
    }
    // Reject anything that isn't a directory (regular file, socket,
    // device) up-front with a clear message — otherwise we'd fail later
    // in `mkdirSync` with a generic ENOTDIR that doesn't pinpoint the
    // wrong path.
    if (!parentStat.isDirectory()) {
      return makeError(
        `${packsParent} exists but is not a directory — refusing to scaffold (move/remove the file first, then re-run)`,
      );
    }
  }
  // Whether packDir already exists (as anything that's *not* a symlink —
  // we explicitly reject symlinks above, but the path could still be a
  // regular file rather than a directory; either way `rmSync({recursive,
  // force})` will clear it) and therefore needs to be removed before we
  // recreate it. We compute this up-front so we can refuse fast (no
  // --force + path exists, or symlink at any time) but defer the actual
  // destructive rmSync until *after* all schema validation passes.
  // Otherwise a scaffold that fails schema validation would still have
  // nuked the user's existing pack, with nothing recreated to take its
  // place.
  let existingPackDirNeedsRm = false;
  if (existsSync(packDir)) {
    // Use lstat (not stat) so symlinks don't transparently pass the
    // directory check — following them with `mkdirSync` later would let a
    // malicious or accidental symlink overwrite files outside packDir.
    // Failure to stat is treated as a hard refusal: we can't confirm the
    // target is safe to overwrite, so we don't.
    let isSymlink: boolean;
    try {
      isSymlink = lstatSync(packDir).isSymbolicLink();
    } catch (e) {
      return makeError(
        `cannot stat pack directory ${packDir}: ${e instanceof Error ? e.message : String(e)} — refusing to scaffold (cannot confirm path is not a symlink)`,
      );
    }
    if (isSymlink) {
      return makeError(
        `pack directory ${packDir} is a symlink — refusing to scaffold into it (would follow the link and write outside the pack root)`,
      );
    }
    if (!opts.force) {
      return makeError(`pack directory ${packDir} already exists; pass --force to overwrite`);
    }
    existingPackDirNeedsRm = true;
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
- \`package.json\` — only used if you publish to npm. The scaffold sets \`name: "${opts.slug}"\` (unscoped) so vendor/copy distribution works as-is. **Before \`npm publish\` you must change \`name\` to a scope you own** (e.g. \`"@your-scope/${opts.slug}"\`), or the publish will fail with "name already taken" / "you do not have permission". \`pack.yaml.name\` (the discovery key) stays as the unscoped slug — those two names are independent.

## Run it

Drop this pack under \`<project>/packs/${opts.slug}/\` and reference it from \`.aqa/profiles.yaml\`. To distribute it across projects: publish under your own npm scope (\`@your-scope/${opts.slug}\`) and have consumers either (a) vendor/copy/extract the published tarball into their \`<project>/packs/\` directory, or (b) install it normally via \`npm install\` and add an alias into the \`@aqa\` scope for auto-discovery (\`"@aqa/${opts.slug}": "npm:@your-scope/${opts.slug}"\` in their \`package.json\` — packs under \`<project>/node_modules/@aqa/*\` are auto-discovered). The snippet below is the smallest schema-valid form — both top-level \`schema_version\` and per-profile fields (\`schema_version\`, \`execution_mode\`) are required by \`@aqa/schemas/ProfilesFile\`:

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
  //
  // Atomic-ish `--force`: when overwriting, we rename the existing pack
  // out of the way to a sibling backup path BEFORE writing the new one.
  // If the write phase fails (permissions, disk full, partial write), we
  // remove the half-written new pack and rename the backup back into
  // place — so the user is left with their original pack intact rather
  // than neither pack. On success, the backup is removed. The rename
  // stays inside the same parent directory, so it's atomic on any sane
  // filesystem (no cross-device move).
  let backupDir: string | null = null;
  if (existingPackDirNeedsRm) {
    backupDir = `${packDir}.aqa-backup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      renameSync(packDir, backupDir);
    } catch (e) {
      return makeError(
        `cannot rename existing pack directory ${packDir} → ${backupDir} (needed to make --force non-destructive): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
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
          // `files` lists what to include in the published tarball.
          // We only list directories the scaffold actually creates; if
          // the author later adds custom `oracles/` or `probes/`, they
          // should extend this array themselves. Listing non-existent
          // directories here makes some tooling warn on `npm pack`.
          files: ['pack.yaml', 'scenarios', 'risks', 'README.md'],
          // No `private: true`. The pack must remain publishable from
          // this scaffold: setting `private: true` would make npm refuse
          // the publish outright. Note that an author will still need to
          // change `name` to a scope they own (e.g. `@your-scope/<slug>`)
          // before `npm publish` — the README explains this — but
          // leaving `private: true` would block them at a less-obvious
          // step. For vendor/copy distribution into `<project>/packs/`,
          // the package.json is irrelevant either way.
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (e) {
    return rollbackAndError(
      packDir,
      backupDir,
      `cannot write pack files to ${packDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Re-validate by parsing what we wrote — catches any serializer divergence.
  try {
    const roundTrip = PackManifest.PackManifest.safeParse(
      yamlParse(readFileSync(resolve(packDir, 'pack.yaml'), 'utf8')),
    );
    if (!roundTrip.success) {
      return rollbackAndError(
        packDir,
        backupDir,
        `scaffolded pack.yaml failed round-trip validation: ${roundTrip.error.message}`,
      );
    }
  } catch (e) {
    return rollbackAndError(
      packDir,
      backupDir,
      `cannot re-read scaffolded pack.yaml at ${packDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Scaffold succeeded — drop the backup. A failure to clean up the
  // backup is not fatal: the new pack is in place and usable. We still
  // surface a warning-ish note in the error string so the user can
  // remove the stray backup directory if they care.
  if (backupDir !== null) {
    try {
      rmSync(backupDir, { recursive: true, force: true });
    } catch {
      // best-effort; new pack is valid either way
    }
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

/**
 * Restore the user's original pack (renamed to `backupDir`) and return a
 * structured error. Called on every failure path after the rename has
 * happened, so an interrupted scaffold leaves the working tree in the
 * same state it was in before `aqa pack new --force` was invoked.
 *
 * If `backupDir` is null (no existing pack to begin with), we just clear
 * any half-written content at `packDir` and surface the error.
 */
function rollbackAndError(
  packDir: string,
  backupDir: string | null,
  message: string,
): PackNewResult {
  try {
    rmSync(packDir, { recursive: true, force: true });
  } catch {
    // best-effort — surface the original error regardless
  }
  if (backupDir !== null) {
    try {
      renameSync(backupDir, packDir);
    } catch (restoreErr) {
      // We failed to restore. Don't lose the data silently — point the
      // user at the backup path so they can recover manually.
      return makeError(
        `${message} (rollback FAILED — your original pack is at ${backupDir}, please restore it manually: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)})`,
      );
    }
  }
  return makeError(message);
}
