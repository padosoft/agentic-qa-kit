#!/usr/bin/env node
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors';
import { type CheckStatus, runDoctor } from '../commands/doctor.js';
import { runInit } from '../commands/init.js';
import { runRun } from '../commands/run.js';
import { runValidate } from '../commands/validate.js';

const VERSION = '0.0.1';

const STATUS_BADGE: Record<CheckStatus, string> = {
  pass: green('✓ pass'),
  warn: yellow('⚠ warn'),
  fail: red('✗ fail'),
};

interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Set<string>;
  /** Captured key/value pairs for flags written as `--key value` or `--key=value`. */
  values: Map<string, string>;
}

const VALUE_FLAGS = new Set(['profile', 'seed']);

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, positionals: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        const k = a.slice(2, eq);
        out.flags.add(k);
        out.values.set(k, a.slice(eq + 1));
      } else {
        const k = a.slice(2);
        out.flags.add(k);
        if (VALUE_FLAGS.has(k)) {
          // VALUE_FLAGS consume the next token even when it starts with a
          // single `-` (so a seed of `-123` works), but never when it starts
          // with `--` (those are always treated as the next flag — otherwise
          // `aqa run --profile --help` would silently swallow `--help`).
          // Pass `--key=value` for any value that begins with `--`.
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('--')) {
            out.values.set(k, next);
            i += 1;
          }
        }
      }
    } else if (a.startsWith('-')) {
      out.flags.add(a.slice(1));
    } else if (out.command === null) {
      out.command = a;
    } else {
      out.positionals.push(a);
    }
  }
  return out;
}

function printHeader(title: string): void {
  console.info(`\n${bold(cyan(`aqa ${title}`))}`);
  console.info(dim('─'.repeat(60)));
}

const HELP = `${bold('aqa')} — agentic-qa-kit CLI

${bold('Usage')}
  aqa <command> [options]

${bold('Commands')}
  init [name]            Scaffold .aqa/{project,risk-map,profiles}.yaml + testing.md
  doctor                 Report kit health (runtime, .aqa, agent docs, validation)
  validate               Validate .aqa/* against @aqa/schemas
  run [--profile <p>]    Execute scenarios for the given profile; write events + findings

${bold('Common options')}
  --force                (init) overwrite existing files
  --dry-run              (init) don't write to disk; print what would happen
  --profile <name>       (run) profile key from .aqa/profiles.yaml
  --seed <string>        (run) deterministic run_id seed — useful for replay
  --help                 show this help
  --version              show CLI version
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('version') || args.flags.has('v')) {
    console.info(VERSION);
    return 0;
  }
  // Explicit --help / -h is a success; missing command is a usage error.
  if (args.flags.has('help') || args.flags.has('h')) {
    console.info(HELP);
    return 0;
  }
  if (args.command === null) {
    console.info(HELP);
    return 1;
  }
  const cwd = process.cwd();
  switch (args.command) {
    case 'init': {
      printHeader('init');
      const initOpts: Parameters<typeof runInit>[0] = { root: cwd };
      if (args.positionals[0] !== undefined) initOpts.projectName = args.positionals[0];
      if (args.flags.has('force')) initOpts.overwrite = true;
      if (args.flags.has('dry-run')) initOpts.dryRun = true;
      const result = runInit(initOpts);
      console.info(
        dim(`runtime=${result.profile.runtime} framework=${result.profile.framework ?? 'none'}`),
      );
      for (const f of result.files) {
        const marker = {
          created: green('+'),
          overwritten: yellow('~'),
          'skipped-exists': dim('·'),
          'dry-run': cyan('?'),
        }[f.result];
        console.info(`  ${marker} ${f.path} ${dim(`[${f.result}]`)}`);
      }
      return 0;
    }
    case 'doctor': {
      printHeader('doctor');
      const result = runDoctor({ root: cwd });
      for (const c of result.checks) {
        console.info(`  ${STATUS_BADGE[c.status]}  ${c.title}  ${dim(`— ${c.detail}`)}`);
        if (c.suggestion) console.info(`         ${dim(c.suggestion)}`);
      }
      console.info(dim(`\nworst: ${result.worst}`));
      return result.worst === 'fail' ? 1 : 0;
    }
    case 'validate': {
      printHeader('validate');
      const result = runValidate({ root: cwd });
      for (const f of result.checked) console.info(`  ${green('✓')} parsed ${f}`);
      if (result.issues.length > 0) {
        console.info('');
        for (const i of result.issues) {
          console.error(`  ${red('✗')} ${i.file} ${dim(`(${i.path})`)} — ${i.message}`);
        }
      }
      return result.ok ? 0 : 1;
    }
    case 'run': {
      printHeader('run');
      // A flag passed without a value (e.g. `aqa run --profile`) is treated as
      // a usage error rather than silently falling back to the default.
      if (args.flags.has('profile') && !args.values.has('profile')) {
        console.error(red('aqa run: --profile requires a value'));
        return 1;
      }
      if (args.flags.has('seed') && !args.values.has('seed')) {
        console.error(red('aqa run: --seed requires a value'));
        return 1;
      }
      const runOpts: Parameters<typeof runRun>[0] = { root: cwd };
      // Use `.has()` rather than truthiness so an empty `--profile=""` is
      // forwarded to runRun() and rejected by its validation, instead of
      // silently falling back to the default profile.
      if (args.values.has('profile')) runOpts.profile = args.values.get('profile') ?? '';
      if (args.values.has('seed')) runOpts.seed = args.values.get('seed') ?? '';
      const result = await runRun(runOpts);
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        // Surface runId/runDir even on failure when the run reached the
        // directory-allocation phase — auditors need them to find the
        // partial audit trail on disk.
        if (result.runId) console.error(`    ${dim('runId:     ')}${result.runId}`);
        if (result.runDir) console.error(`    ${dim('runDir:    ')}${result.runDir}`);
        return 1;
      }
      console.info(`  ${green('✓')} ${bold(result.runId ?? '?')}`);
      console.info(`    ${dim('runDir:    ')}${result.runDir ?? '?'}`);
      console.info(`    ${dim('scenarios: ')}${result.scenariosRun}`);
      console.info(`    ${dim('findings:  ')}${result.findingsCount}`);
      // Warnings: ok=true but something on disk merits attention (e.g. a
      // broken stale pack that the selected profile didn't reference).
      // Print in yellow so they stand out from the success summary.
      if (result.warnings && result.warnings.length > 0) {
        console.info(`    ${yellow('⚠ warnings:')}`);
        for (const w of result.warnings) console.info(`      ${yellow('·')} ${w}`);
      }
      return 0;
    }
    default: {
      console.error(red(`aqa: unknown command "${args.command}"`));
      console.info(HELP);
      return 1;
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(red('aqa: unhandled error'), err);
    process.exit(2);
  });
