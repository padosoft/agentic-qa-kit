#!/usr/bin/env node
/**
 * Prepares `packages/kit/` for publishing to GitHub Packages.
 *
 * Why this exists: internally the package is named `@aqa/kit` so the
 * monorepo's other workspaces (server, store, …) can reference it via
 * `workspace:*`. The published artifact must be named
 * `@padosoft/agentic-qa-kit` because GitHub Packages requires
 * `<scope> === <repo-owner>` (= `padosoft`). Renaming the workspace
 * permanently would break every internal import path; rewriting only
 * the published tarball is a one-line transform here.
 *
 * What it does:
 *   1. Reads `packages/kit/package.json`.
 *   2. Substitutes `name` with the value declared in `aqa.publishName`
 *      (currently `@padosoft/agentic-qa-kit`).
 *   3. STRIPS every `@aqa/*` dependency entirely — those packages are
 *      bundled into `dist/cli.cjs` by esbuild and are NOT separately
 *      published, so leaving them in `dependencies` would make
 *      `bun add @padosoft/agentic-qa-kit` fail at install time
 *      ("404 — @aqa/runner not found on registry"). Reported by
 *      Copilot iter 1 on PR #55.
 *   4. Replaces every remaining `workspace:*` dep value with the
 *      package's current version (so the published manifest is
 *      self-consistent and an npm consumer doesn't see the bun-only
 *      protocol).
 *   5. Writes the prepared manifest back over `packages/kit/package.json`
 *      so `npm publish` in the same directory uses the rewritten file.
 *
 * Idempotent: running twice is a no-op as long as `aqa.publishName` is
 * preserved. The publish workflow runs this immediately before `npm
 * publish` and does NOT commit the change back — the rewrite is for
 * the tarball only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const pkgPath = join(kitRoot, 'package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const publishName = pkg.aqa?.publishName;
if (typeof publishName !== 'string' || publishName.length === 0) {
  console.error(
    '[publish-prep] no aqa.publishName declared in packages/kit/package.json — refusing to publish',
  );
  process.exit(2);
}

if (pkg.name === publishName) {
  console.info(
    `[publish-prep] package already named ${publishName}; only rewriting workspace:* deps`,
  );
} else {
  console.info(`[publish-prep] rewriting name: ${pkg.name} → ${publishName}`);
  pkg.name = publishName;
}

const version = pkg.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[publish-prep] invalid version "${version}"; expected semver`);
  process.exit(2);
}

function rewriteDeps(group) {
  const deps = pkg[group];
  if (!deps || typeof deps !== 'object') return { stripped: 0, pinned: 0 };
  let stripped = 0;
  let pinned = 0;
  for (const name of Object.keys(deps)) {
    // 1. Drop @aqa/* — these are inlined in the bundle, never published.
    if (name.startsWith('@aqa/')) {
      delete deps[name];
      stripped += 1;
      continue;
    }
    // 2. Pin any remaining `workspace:*` deps to the kit's version.
    const spec = deps[name];
    if (typeof spec === 'string' && spec.startsWith('workspace:')) {
      deps[name] = version;
      pinned += 1;
    }
  }
  if (stripped > 0)
    console.info(`[publish-prep] stripped ${stripped} @aqa/* ${group} (bundled into dist/cli.cjs)`);
  if (pinned > 0) console.info(`[publish-prep] pinned ${pinned} ${group} workspace:* → ${version}`);
  return { stripped, pinned };
}
rewriteDeps('dependencies');
rewriteDeps('devDependencies');
rewriteDeps('peerDependencies');
rewriteDeps('optionalDependencies');

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.info(`[publish-prep] wrote ${pkgPath}`);
