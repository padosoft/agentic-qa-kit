import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PackManifest } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';

export interface LoadedPack {
  /** Absolute path to the pack root (the directory containing `pack.yaml`). */
  root: string;
  /** Validated manifest contents. */
  manifest: PackManifest.PackManifest;
}

export interface LoadPackOptions {
  /** Optional override to read the manifest file (defaults to fs.readFileSync). */
  readFile?: (path: string) => string;
}

export interface PackDiscoveryRoot {
  /** Where the discovery starts; every subdirectory is considered a potential pack. */
  root: string;
}

const MANIFEST_FILENAMES = ['pack.yaml', 'pack.yml'];

function findManifest(packRoot: string): string | null {
  for (const f of MANIFEST_FILENAMES) {
    const p = join(packRoot, f);
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadPack(packRoot: string, opts: LoadPackOptions = {}): LoadedPack {
  const manifestPath = findManifest(packRoot);
  if (!manifestPath) {
    throw new Error(`[pack-loader] no manifest at ${packRoot} (expected pack.yaml or pack.yml)`);
  }
  const reader = opts.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  let parsed: unknown;
  try {
    parsed = yamlParse(reader(manifestPath));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[pack-loader] ${manifestPath}: YAML parse error — ${msg}`);
  }
  const result = PackManifest.PackManifest.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`[pack-loader] ${manifestPath}: invalid manifest — ${detail}`);
  }
  return { root: packRoot, manifest: result.data };
}

/**
 * Load every pack found one level below `root`. A direct subdirectory is
 * considered a pack when it contains either `pack.yaml` (preferred) or
 * `pack.yml`; everything else is skipped silently.
 */
export function loadPacks(root: string, opts: LoadPackOptions = {}): LoadedPack[] {
  if (!existsSync(root)) return [];
  const out: LoadedPack[] = [];
  for (const entry of readdirSync(root).sort()) {
    if (entry.startsWith('.')) continue;
    const abs = join(root, entry);
    let st: ReturnType<typeof statSync> | null = null;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (!findManifest(abs)) continue;
    out.push(loadPack(abs, opts));
  }
  return out;
}
