#!/usr/bin/env node
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors';
import { type CheckStatus, runDoctor } from '../commands/doctor.js';
import { runInit } from '../commands/init.js';
import { runInstallAgentFiles } from '../commands/install-agent-files.js';
import { runPackNew } from '../commands/pack-new.js';
import { runReport } from '../commands/report.js';
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

const VALUE_FLAGS = new Set([
  'profile',
  'seed',
  'sut-type',
  'description',
  'author',
  'license',
  'targets',
  'project-name',
  'run-id',
  'format',
]);

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
          // VALUE_FLAGS consume the next token only when it clearly looks
          // like a value, not another flag. Rules:
          //   - never consume `--anything` (next long flag)
          //   - never consume single-letter short flags `-h`, `-v`, etc.
          //   - DO consume tokens that start with `-` followed by a digit
          //     (so a seed of `-123` still works)
          //   - DO consume everything else
          // For ambiguous values, the `--key=value` form is unambiguous.
          const next = argv[i + 1];
          // -123 is a value; -h / --help / -v are flags.
          const looksLikeFlag = next?.startsWith('-') && !/^-\d/.test(next);
          if (next !== undefined && !looksLikeFlag) {
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
  init [name]                       Scaffold .aqa/{project,risk-map,profiles}.yaml + testing.md
  doctor                            Report kit health (runtime, .aqa, agent docs, validation)
  validate                          Validate .aqa/* against @aqa/schemas
  install-agent-files --targets …   Write CLAUDE.md / AGENTS.md / GEMINI.md / .github/copilot-instructions.md
                                    plus per-agent skills under .claude/ .agents/ .gemini/ .github/
  run [--profile <p>]               Execute scenarios for the given profile; write events + findings
  report [--run-id <id>]            Render the latest (or specified) run as report.md + report.json
  pack new <slug>                   Scaffold a new pack at <cwd>/packs/<slug>/ (see the pack authoring
                                    guide: https://github.com/padosoft/agentic-qa-kit/blob/main/docs/PACK-AUTHORING.md
                                    — this path is only present in the source repo, not in the npm tarball)

${bold('Common options')}
  --force                (init / install-agent-files / pack new) overwrite existing files/directory
  --dry-run              (init / install-agent-files) don't write to disk; print what would happen
  --profile <name>       (run) profile key from .aqa/profiles.yaml
  --seed <string>        (run) deterministic run_id seed — useful for replay
  --targets <list>       (install-agent-files) comma-separated targets: claude,codex,gemini,copilot
  --project-name <name>  (install-agent-files) override the slug embedded in instruction files
  --run-id <id>          (report) target a specific run; default = latest
  --format <fmt>         (report) md | json | both (default: both)
  --sut-type <type>      (pack new) api | web | cli | lib | agent | pipeline
  --description <text>   (pack new) one-line summary written into the manifest
  --author <name>        (pack new) manifest author field
  --license <spdx>       (pack new) SPDX license id (default: Apache-2.0)
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
    case 'install-agent-files': {
      printHeader('install-agent-files');
      if (args.flags.has('targets') && !args.values.has('targets')) {
        console.error(red('aqa install-agent-files: --targets requires a value'));
        return 1;
      }
      if (args.flags.has('project-name') && !args.values.has('project-name')) {
        console.error(red('aqa install-agent-files: --project-name requires a value'));
        return 1;
      }
      const targetsRaw = args.values.get('targets');
      if (targetsRaw === undefined) {
        console.error(
          red('aqa install-agent-files: --targets is required (e.g. --targets claude,codex)'),
        );
        return 1;
      }
      const installOpts: Parameters<typeof runInstallAgentFiles>[0] = {
        root: cwd,
        targets: targetsRaw,
      };
      if (args.values.has('project-name')) {
        installOpts.projectName = args.values.get('project-name') ?? '';
      }
      if (args.flags.has('force')) installOpts.overwrite = true;
      if (args.flags.has('dry-run')) installOpts.dryRun = true;
      const result = runInstallAgentFiles(installOpts);
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(dim(`targets: ${result.targets.join(', ')}`));
      for (const f of result.files) {
        const marker = {
          created: green('+'),
          overwritten: yellow('~'),
          'skipped-exists': dim('·'),
          'dry-run': cyan('?'),
        }[f.result];
        console.info(`  ${marker} ${f.path} ${dim(`[${f.target}/${f.result}]`)}`);
      }
      return 0;
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
    case 'report': {
      printHeader('report');
      if (args.flags.has('run-id') && !args.values.has('run-id')) {
        console.error(red('aqa report: --run-id requires a value'));
        return 1;
      }
      if (args.flags.has('format') && !args.values.has('format')) {
        console.error(red('aqa report: --format requires a value'));
        return 1;
      }
      const reportOpts: Parameters<typeof runReport>[0] = { root: cwd };
      if (args.values.has('run-id')) reportOpts.runId = args.values.get('run-id') ?? '';
      if (args.values.has('format')) {
        const fmt = args.values.get('format') ?? '';
        if (fmt !== 'md' && fmt !== 'json' && fmt !== 'both') {
          console.error(red(`aqa report: --format must be md | json | both, got "${fmt}"`));
          return 1;
        }
        reportOpts.format = fmt;
      }
      const result = runReport(reportOpts);
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(`  ${green('✓')} ${bold(result.runId)}`);
      console.info(`    ${dim('runDir:    ')}${result.runDir}`);
      console.info(`    ${dim('findings:  ')}${result.findingsCount}`);
      for (const f of result.files) console.info(`    ${green('+')} ${f}`);
      return 0;
    }
    case 'pack': {
      // Subcommand router for `aqa pack <subcommand>`.
      const sub = args.positionals[0];
      if (sub !== 'new') {
        console.error(red(`aqa pack: unknown subcommand "${sub ?? ''}" — expected "new"`));
        return 1;
      }
      const slug = args.positionals[1];
      if (!slug) {
        console.error(red('aqa pack new: missing required <slug> positional argument'));
        return 1;
      }
      printHeader(`pack new ${slug}`);
      // Reject flags that were passed without a value (`--sut-type` alone)
      // rather than silently falling back to the default. Mirrors the
      // identical guard in the `run` command.
      for (const k of ['sut-type', 'description', 'author', 'license'] as const) {
        if (args.flags.has(k) && !args.values.has(k)) {
          console.error(red(`aqa pack new: --${k} requires a value`));
          return 1;
        }
      }
      const sutType = args.values.get('sut-type') ?? 'api';
      const packNewOpts: Parameters<typeof runPackNew>[0] = {
        root: cwd,
        slug,
        sutType,
      };
      if (args.flags.has('force')) packNewOpts.force = true;
      if (args.values.has('description'))
        packNewOpts.description = args.values.get('description') ?? '';
      if (args.values.has('author')) packNewOpts.author = args.values.get('author') ?? '';
      if (args.values.has('license')) packNewOpts.license = args.values.get('license') ?? '';
      const result = runPackNew(packNewOpts);
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(`  ${green('✓')} scaffolded ${bold(slug)}`);
      console.info(`    ${dim('packDir: ')}${result.packDir}`);
      for (const f of result.files ?? []) console.info(`    ${green('+')} ${f}`);
      console.info(dim('\n  Next: edit pack.yaml + scenarios/starter.yaml to match your project,'));
      console.info(dim('  then reference this pack from .aqa/profiles.yaml and `aqa run`.'));
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
