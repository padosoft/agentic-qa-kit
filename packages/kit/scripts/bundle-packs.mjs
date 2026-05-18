#!/usr/bin/env node
/**
 * Copies the monorepo's bundled packs (under <repo>/packs/*) into
 * `packages/kit/dist/packs/` so they ship with the `@aqa/kit` npm tarball.
 *
 * Why this exists: `aqa init` writes profiles that reference bundled pack
 * names like `pack-core` and `pack-api-core`. Without the packs bundled
 * alongside `@aqa/kit`, a fresh `aqa init` → `aqa run` in an external
 * project would exit with "0 scenarios" because `defaultPacksRoot()` can't
 * find any pack.yaml on disk. Bundling them into the kit's own dist keeps
 * the install surface to a single `@aqa/kit` package.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const repoRoot = resolve(kitRoot, '..', '..');
const sourcePacksDir = join(repoRoot, 'packs');
const destPacksDir = join(kitRoot, 'dist', 'packs');

if (!existsSync(sourcePacksDir) || !statSync(sourcePacksDir).isDirectory()) {
  console.warn(`[bundle-packs] no packs/ at ${sourcePacksDir} — skipping`);
  process.exit(0);
}

if (existsSync(destPacksDir)) rmSync(destPacksDir, { recursive: true, force: true });
mkdirSync(destPacksDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(sourcePacksDir).sort()) {
  const src = join(sourcePacksDir, entry);
  const dst = join(destPacksDir, entry);
  if (!statSync(src).isDirectory()) continue;
  // Skip if no pack.yaml — README / non-pack files at packs/ root.
  if (!existsSync(join(src, 'pack.yaml')) && !existsSync(join(src, 'pack.yml'))) continue;
  cpSync(src, dst, { recursive: true });
  copied += 1;
}

console.info(`[bundle-packs] copied ${copied} pack(s) into ${destPacksDir}`);
