#!/usr/bin/env node
/**
 * Bundles the `aqa` CLI into a single CommonJS file at `dist/cli.cjs`.
 *
 * Why bundle: `@padosoft/agentic-qa-kit` ships to GitHub Packages as a
 * single tarball. Internal workspace deps (@aqa/runner, @aqa/schemas,
 * @aqa/pack-loader, …) are NOT separately published to any registry —
 * they only exist inside this monorepo's bun workspace. If we left them
 * in `dependencies`, a downstream `bun add @padosoft/agentic-qa-kit`
 * would fail because npm/bun can't resolve `@aqa/*` against the registry.
 *
 * esbuild walks the import graph, inlines every @aqa/* + every regular
 * npm dep (yaml, kleur, zod, …) into one file, and externalises only
 * Node built-ins (`node:fs`, `node:http`, …). The resulting `dist/cli.cjs`
 * is the only JS artifact shipped in the npm tarball — alongside the
 * static `dist/packs/` directory (bundled by bundle-packs.mjs) that the
 * CLI loads at runtime via fs paths. The admin SPA static directory
 * (`dist/admin/`) is bundled by a sibling `bundle-admin.mjs` added in
 * the macro-task v1.9 `aqa admin` sub-task; this PR alone ships only
 * the CLI bundler.
 *
 * Why CJS-in-.cjs instead of ESM-in-.js: some bundled CJS deps (yaml,
 * ajv) call `require('process')` etc. inside their compiled output.
 * esbuild's ESM bundler rewrites those into a `__require` helper that
 * throws at runtime; CJS output keeps Node's native `require`. The
 * `.cjs` extension makes Node load this file as CJS even though the
 * kit's package.json sets `"type": "module"`.
 *
 * Sourcemap is emitted so `node --enable-source-maps` and crash stacks
 * point back at the original TypeScript source files (under each
 * `packages/<name>/src/`) even after the bundle inlines them.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const entryPoint = join(kitRoot, 'dist', 'cli', 'aqa.js');
// `.cjs` extension is mandatory because the kit's package.json sets
// `"type": "module"`, which makes every plain `.js` be parsed as ESM.
// The bundler emits CJS to keep bundled-dep `require()` calls working
// (see below), and a `.cjs` extension tells Node to load this file as
// CJS regardless of the surrounding type:module setting.
const outFile = join(kitRoot, 'dist', 'cli.cjs');

if (!existsSync(entryPoint)) {
  console.error(
    `[build-bundle] missing entry point ${entryPoint} — run \`tsc -p tsconfig.json\` first (this script is invoked after tsc in the kit build pipeline)`,
  );
  process.exit(1);
}

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CJS output: some bundled npm deps (yaml's internals, ajv) embed
  // `require('process')` etc. in their CJS source. esbuild's ESM
  // bundling rewrites those to a `__require` helper that throws
  // ("Dynamic require of X is not supported"). CJS output preserves
  // Node's native `require` so the wrappers resolve cleanly. The
  // tarball's `bin: dist/cli.cjs` runs identically as CJS — bin
  // scripts don't care about ESM vs CJS as long as the shebang is
  // intact.
  format: 'cjs',
  sourcemap: true,
  // Node 22+ built-ins MUST stay external — bundling them breaks at
  // runtime. `bun:*` modules are also external so a Node 22 install
  // doesn't try to resolve them (the kit's bun-specific paths gracefully
  // detect runtime via `globalThis.Bun` checks).
  // Externalise Node built-ins in BOTH prefix forms — `node:fs` and
  // `fs`. Some bundled CJS deps (yaml, ajv, …) `require('process')` or
  // `require('crypto')` without the prefix; without listing the
  // unprefixed names esbuild rewrites those as `Dynamic require ...`
  // stubs that throw at runtime. The prefixed forms cover what TS/ESM
  // code targets directly.
  external: [
    'bun',
    'bun:sqlite',
    'bun:test',
    ...[
      'assert',
      'async_hooks',
      'buffer',
      'child_process',
      'console',
      'crypto',
      'dgram',
      'diagnostics_channel',
      'dns',
      'events',
      'fs',
      'fs/promises',
      'http',
      'http2',
      'https',
      'inspector',
      'module',
      'net',
      'os',
      'path',
      'path/posix',
      'path/win32',
      'perf_hooks',
      'process',
      'punycode',
      'querystring',
      'readline',
      'repl',
      'stream',
      'stream/promises',
      'stream/web',
      'string_decoder',
      'sys',
      'test',
      'timers',
      'timers/promises',
      'tls',
      'trace_events',
      'tty',
      'url',
      'util',
      'util/types',
      'v8',
      'vm',
      'worker_threads',
      'zlib',
    ].flatMap((m) => [m, `node:${m}`]),
  ],
  // No banner: tsc preserves the source shebang in dist/cli/aqa.js, and
  // esbuild keeps any shebang it sees at the top of the entry. A banner
  // here would emit a second `#!/usr/bin/env node` and Node rejects two
  // shebangs in a row with `SyntaxError: Invalid or unexpected token`.
  // Don't minify: the bundle stays grep-able and readable in stack
  // traces. The tarball size penalty vs minified is small (~30%) and
  // not worth the debugging cost for a CLI.
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

// Defensive shebang dedup. Today this script does NOT set an esbuild
// banner (the entry file's own `#!/usr/bin/env node`, preserved by
// tsc, is enough). If a future iteration re-introduces a banner with
// a shebang — or if esbuild ever decides to add one itself — the
// output would land with two shebang lines and Node would reject the
// second as a SyntaxError. Keeping this idempotent post-process means
// the bundle stays runnable through that kind of edit without anyone
// noticing in CI.
{
  const text = readFileSync(outFile, 'utf8');
  const lines = text.split('\n');
  if (lines[0]?.startsWith('#!')) {
    const cleaned = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.startsWith('#!')) continue;
      cleaned.push(line);
    }
    writeFileSync(outFile, cleaned.join('\n'), 'utf8');
  }
}

// Make the bundled file executable on POSIX so `bunx @padosoft/agentic-qa-kit`
// can chmod-then-spawn without an extra step. No-op on Windows.
if (process.platform !== 'win32') {
  try {
    const { chmodSync } = await import('node:fs');
    chmodSync(outFile, 0o755);
  } catch (e) {
    console.warn(
      `[build-bundle] could not chmod ${outFile}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const st = statSync(outFile);
console.info(`[build-bundle] wrote ${outFile} (${(st.size / 1024).toFixed(1)} KB)`);

// Write a sentinel that the test/CI can use to verify the bundle exists
// and is non-empty without invoking node on it (which would require the
// whole runtime + all bundled paths to be loadable).
writeFileSync(
  join(kitRoot, 'dist', 'cli.bundle.meta.json'),
  `${JSON.stringify({ bytes: st.size, generated_at: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
