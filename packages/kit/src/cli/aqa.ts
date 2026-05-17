#!/usr/bin/env node
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors';
import { type CheckStatus, runDoctor } from '../commands/doctor.js';
import { runInit } from '../commands/init.js';
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
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: null, positionals: [], flags: new Set() };
  for (const a of argv) {
    if (a.startsWith('--')) out.flags.add(a.slice(2));
    else if (a.startsWith('-')) out.flags.add(a.slice(1));
    else if (out.command === null) out.command = a;
    else out.positionals.push(a);
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
  init [name]   Scaffold .aqa/{project,risk-map,profiles}.yaml + testing.md
  doctor        Report kit health (runtime, .aqa, agent docs, validation)
  validate      Validate .aqa/* against @aqa/schemas

${bold('Common options')}
  --force       (init) overwrite existing files
  --dry-run     (init) don't write to disk; print what would happen
  --help        show this help
  --version     show CLI version
`;

function main(): number {
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
    default: {
      console.error(red(`aqa: unknown command "${args.command}"`));
      console.info(HELP);
      return 1;
    }
  }
}

try {
  process.exit(main());
} catch (err) {
  console.error(red('aqa: unhandled error'), err);
  process.exit(2);
}
