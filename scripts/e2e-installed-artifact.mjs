#!/usr/bin/env node
/**
 * Complete journey for the artifact a consumer actually installs.
 *
 * The workspace bundle tests prove that dist/cli.cjs works in-place. This
 * journey additionally prepares the publish manifest, creates an npm tarball,
 * extracts it into an isolated directory, and runs the extracted CLI without
 * workspace dependencies or source files.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(root, 'packages', 'kit');
const sourceBundle = join(kitRoot, 'dist', 'cli.cjs');
if (!existsSync(sourceBundle)) {
  console.error(`installed-artifact: missing ${sourceBundle}; run \`bun run build\` first`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'aqa-installed-artifact-'));
const staging = join(work, 'staging');
const extracted = join(work, 'extracted');
const run = (command, args, cwd, label) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    windowsHide: true,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed (exit=${result.status ?? 'unknown'}): ${result.error?.message ?? result.stderr ?? ''}`,
    );
  }
  return result;
};

try {
  cpSync(join(kitRoot, 'package.json'), join(work, 'package.json'));
  const sourcePackage = JSON.parse(readFileSync(join(work, 'package.json'), 'utf8'));
  const sourceName = sourcePackage.name;
  const sourceVersion = sourcePackage.version;
  cpSync(join(kitRoot, 'README.md'), join(work, 'README.md'));
  cpSync(join(root, 'LICENSE'), join(work, 'LICENSE'));
  cpSync(join(kitRoot, 'dist'), join(work, 'dist'), { recursive: true });
  cpSync(join(kitRoot, 'scripts', 'publish-prep.mjs'), join(work, 'publish-prep.mjs'));

  // publish-prep resolves package.json one directory above its own location.
  mkdirSync(join(staging, 'scripts'), { recursive: true });
  cpSync(join(work, 'package.json'), join(staging, 'package.json'));
  cpSync(join(work, 'README.md'), join(staging, 'README.md'));
  cpSync(join(work, 'LICENSE'), join(staging, 'LICENSE'));
  cpSync(join(work, 'dist'), join(staging, 'dist'), { recursive: true });
  cpSync(join(work, 'publish-prep.mjs'), join(staging, 'scripts', 'publish-prep.mjs'));

  run(
    process.execPath,
    [join(staging, 'scripts', 'publish-prep.mjs')],
    staging,
    'publish preparation',
  );
  const prepared = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'));
  if (prepared.name !== '@padosoft/agentic-qa-kit')
    throw new Error(`prepared package name mismatch: ${prepared.name}`);
  if (prepared.version !== sourceVersion)
    throw new Error(`prepared package version mismatch: ${prepared.version}`);
  for (const group of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const dependency of Object.keys(prepared[group] ?? {})) {
      if (dependency.startsWith('@aqa/'))
        throw new Error(`unpublished internal dependency remains: ${dependency}`);
    }
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = run(
    npmCommand,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', work],
    staging,
    'npm pack',
  );
  const metadata = JSON.parse(packed.stdout);
  const tarballName = metadata[0]?.filename;
  if (typeof tarballName !== 'string')
    throw new Error('npm pack did not return a tarball filename');
  const tarball = join(work, tarballName);
  if (!existsSync(tarball)) throw new Error(`npm pack output missing: ${tarball}`);

  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', extracted], work, 'tar extraction');
  const installedRoot = join(extracted, 'package');
  const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  if (installedPackage.name !== '@padosoft/agentic-qa-kit')
    throw new Error(`installed package name mismatch: ${installedPackage.name}`);
  const installedBin = join(installedRoot, 'dist', 'cli.cjs');
  if (!existsSync(installedBin)) throw new Error('installed CLI bundle is missing');

  const fixture = join(work, 'consumer-project');
  mkdirSync(fixture, { recursive: true });
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({
      name: 'installed-artifact-fixture',
      private: true,
      version: '0.0.0',
      type: 'module',
    }),
  );
  run(process.execPath, [installedBin, '--version'], fixture, 'installed CLI version');
  run(process.execPath, [installedBin, '--help'], fixture, 'installed CLI help');
  run(process.execPath, [installedBin, 'init', '--silent'], fixture, 'installed CLI init');
  run(process.execPath, [installedBin, 'validate'], fixture, 'installed CLI validate');
  console.log(`Installed artifact journey passed for ${sourceName}@${sourceVersion}`);
} catch (error) {
  console.error(`installed-artifact: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
