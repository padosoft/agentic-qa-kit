#!/usr/bin/env node
/**
 * Copies the prebuilt admin SPA (under <repo>/packages/admin/dist) into
 * `packages/kit/dist/admin/` so it ships inside the `@aqa/kit` npm
 * tarball.
 *
 * Why this exists: `aqa admin` boots an in-process HTTP server that
 * serves the SPA static files alongside the @aqa/server API handlers.
 * Without bundling, a junior who installed only `@aqa/kit` would have
 * no admin SPA to serve and `aqa admin` would 404 on `/`. Topological
 * `bun run build` runs `@aqa/admin`'s build before `@aqa/kit`'s, so the
 * source dist is guaranteed to be present at bundle time.
 *
 * If the admin dist is missing (e.g. a downstream contributor only built
 * `@aqa/kit` in isolation), we emit a warning and continue — `aqa admin`
 * will then report a clear error at boot, not at build.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const repoRoot = resolve(kitRoot, '..', '..');
const sourceAdminDist = join(repoRoot, 'packages', 'admin', 'dist');
const destAdminDir = join(kitRoot, 'dist', 'admin');

if (!existsSync(sourceAdminDist) || !statSync(sourceAdminDist).isDirectory()) {
  console.warn(
    `[bundle-admin] no admin dist at ${sourceAdminDist} — \`aqa admin\` will not work until @aqa/admin is built`,
  );
  process.exit(0);
}

if (existsSync(destAdminDir)) rmSync(destAdminDir, { recursive: true, force: true });
mkdirSync(destAdminDir, { recursive: true });
cpSync(sourceAdminDist, destAdminDir, { recursive: true });

console.info(`[bundle-admin] copied admin SPA into ${destAdminDir}`);
