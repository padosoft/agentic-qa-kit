#!/usr/bin/env node
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors';
import { createAuditCheckpointStore } from '../artifacts.js';
import { runAdmin } from '../commands/admin.js';
import { type CheckStatus, runDoctor } from '../commands/doctor.js';
import { runDrInventory, runDrRestore } from '../commands/dr.js';
import { runIngest } from '../commands/ingest.js';
import { runInit } from '../commands/init.js';
import { runInstallAgentFiles } from '../commands/install-agent-files.js';
import { runPackNew } from '../commands/pack-new.js';
import { runReport } from '../commands/report.js';
import { runRiskCoverage } from '../commands/risk-coverage.js';
import { runRiskDiscover } from '../commands/risk-discover.js';
import { runRun } from '../commands/run.js';
import { runValidate } from '../commands/validate.js';
import { runVerify } from '../commands/verify.js';
import { runWorker, runnerConfigFromEnv } from '../commands/worker.js';

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
  'port',
  'host',
  'finding-id',
  'attempts',
  'base-url',
  'tool',
  'threshold-file',
  'method',
  'scope',
  'otlp-endpoint',
  'public-key',
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
  doctor [--production]             Report kit health and production prerequisites
  validate                          Validate .aqa/* against @aqa/schemas
  install-agent-files --targets …   Write CLAUDE.md / AGENTS.md / GEMINI.md / .github/copilot-instructions.md
                                    plus per-agent skills under .claude/ .agents/ .gemini/ .github/
  run [--profile <p>]               Execute scenarios for the given profile; write events + findings
  report [--run-id <id>]            Render the latest (or specified) run as report.md + report.json
  verify <finding-id>               Re-run a finding with bounded attempts and record evidence
  ingest <junit|sast|k6|locust|playwright> <file> Normalize external results into redacted evidence
  dr inventory <file> [--public-key <pem>] Validate/hash a backup inventory; verify signed inventories
  dr restore <inventory> <evidence> [--public-key <pem>] Validate a restore drill against RPO/RTO
  risk discover --method stride|owasp|fmea|source Generate a deterministic or source-aware risk baseline
  risk coverage [--profile <name>] Analyze risk coverage from scenarios and persisted run evidence
  admin [--port N]                  Boot the admin SPA + API on http://127.0.0.1:5173, seeded from .aqa/runs/
  worker                            Run the scoped PostgreSQL runner worker (deployment use)
  pack new <slug>                   Scaffold a new pack at <cwd>/packs/<slug>/ (see the pack authoring
                                    guide: https://github.com/padosoft/agentic-qa-kit/blob/main/docs/PACK-AUTHORING.md
                                    — this path is only present in the source repo, not in the npm tarball)

${bold('Common options')}
  --force                (init / install-agent-files / pack new) overwrite existing files/directory
  --dry-run              (init / install-agent-files) don't write to disk; print what would happen
  --profile <name>       (run) profile key from .aqa/profiles.yaml
  --seed <string>        (run) deterministic run_id seed — useful for replay
  --require-signed-packs (run) require trusted Ed25519 pack signatures + full content digests
  --targets <list>       (install-agent-files) comma-separated targets: claude,codex,gemini,copilot
  --project-name <name>  (install-agent-files) override the slug embedded in instruction files
  --run-id <id>          (report) target a specific run; default = latest
  --format <fmt>         (report) md | json | both (default: both)
  --threshold-file <f>   (ingest k6/locust) apply explicit performance policy JSON
  --public-key <pem>     (dr) trusted Ed25519 public key for signed backup inventories
  --attempts <n>         (verify) attempts, 1..10 (default: 3)
  --base-url <url>       (verify) allowlisted HTTP SUT base URL
  --port <n>             (admin) HTTP port to listen on (default 5173; 0 = OS-assigned)
  --host <h>             (admin) bind host (default 127.0.0.1 — recommended)
                         WARNING: \`aqa admin\` runs WITHOUT real authentication.
                         Binding to 0.0.0.0 exposes the in-memory store and
                         makeApi() to any host on the same network — only do
                         this on a trusted dev VM or isolated CI runner.
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
      const result = runDoctor({ root: cwd, production: args.flags.has('production') });
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
      if (args.values.has('otlp-endpoint'))
        runOpts.otlpEndpoint = args.values.get('otlp-endpoint') ?? '';
      if (args.flags.has('require-signed-packs')) {
        const rawTrustRoot = process.env.AQA_PACK_TRUSTED_KEYS_JSON;
        if (!rawTrustRoot) {
          console.error(red('aqa run: --require-signed-packs requires AQA_PACK_TRUSTED_KEYS_JSON'));
          return 1;
        }
        try {
          const parsed: unknown = JSON.parse(rawTrustRoot);
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed) ||
            Object.values(parsed as Record<string, unknown>).some(
              (value) => typeof value !== 'string' || value.trim() === '',
            )
          ) {
            throw new Error('trust root must map key ids to non-empty public-key PEM strings');
          }
          runOpts.requireSignedPacks = true;
          runOpts.packTrustedKeys = parsed as Record<string, string>;
        } catch (error) {
          console.error(
            red(
              `aqa run: AQA_PACK_TRUSTED_KEYS_JSON is invalid: ${
                error instanceof Error ? error.message : 'invalid JSON'
              }`,
            ),
          );
          return 1;
        }
      }
      const checkpointKeyId = process.env.AQA_AUDIT_CHECKPOINT_KEY_ID?.trim();
      const checkpointPrivateKey = process.env.AQA_AUDIT_CHECKPOINT_PRIVATE_KEY_PEM;
      if (checkpointKeyId || checkpointPrivateKey) {
        if (!checkpointKeyId || !checkpointPrivateKey) {
          console.error(
            red(
              'aqa run: AQA_AUDIT_CHECKPOINT_KEY_ID and AQA_AUDIT_CHECKPOINT_PRIVATE_KEY_PEM must be provided together',
            ),
          );
          return 1;
        }
        runOpts.auditCheckpointSigner = {
          key_id: checkpointKeyId,
          private_key_pem: checkpointPrivateKey,
        };
      }
      const auditCheckpointStore = createAuditCheckpointStore();
      if (auditCheckpointStore) runOpts.auditCheckpointStore = auditCheckpointStore;
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
    case 'verify': {
      printHeader('verify');
      const findingId = args.positionals[0] ?? args.values.get('finding-id');
      if (!findingId) {
        console.error(red('aqa verify: missing <finding-id>'));
        return 1;
      }
      const rawAttempts = args.values.get('attempts');
      if (rawAttempts !== undefined) {
        const parsedAttempts = Number(rawAttempts);
        if (!Number.isInteger(parsedAttempts) || parsedAttempts < 1 || parsedAttempts > 10) {
          console.error(red('aqa verify: --attempts must be an integer from 1 to 10'));
          return 1;
        }
      }
      const result = await runVerify({
        root: cwd,
        findingId,
        ...(rawAttempts === undefined ? {} : { attempts: Number(rawAttempts) }),
        ...(args.values.has('base-url') ? { baseUrl: args.values.get('base-url') ?? '' } : {}),
      });
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(
        `  ${result.deterministic ? green('✓ deterministic') : yellow('⚠ non-deterministic')}`,
      );
      console.info(`    ${dim('finding:  ')}${result.findingId}`);
      console.info(`    ${dim('attempts: ')}${result.successes}/${result.attempts}`);
      console.info(`    ${dim('evidence: ')}${result.verificationPath}`);
      return result.deterministic ? 0 : 2;
    }
    case 'ingest': {
      printHeader('ingest');
      const kind = args.positionals[0];
      const file = args.positionals[1];
      if (
        kind !== 'junit' &&
        kind !== 'sast' &&
        kind !== 'semgrep' &&
        kind !== 'k6' &&
        kind !== 'locust' &&
        kind !== 'playwright'
      ) {
        console.error(
          red('aqa ingest: kind must be junit, sast, semgrep, k6, locust, or playwright'),
        );
        return 1;
      }
      if (!file) {
        console.error(red('aqa ingest: missing <file>'));
        return 1;
      }
      const result = runIngest({
        root: cwd,
        kind,
        file,
        ...(args.values.has('tool') ? { tool: args.values.get('tool') ?? '' } : {}),
        ...(args.values.has('threshold-file')
          ? { threshold_file: args.values.get('threshold-file') ?? '' }
          : {}),
      });
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(`  ${green('✓')} ${result.report?.records.length ?? 0} record(s) ingested`);
      console.info(`    ${dim('evidence: ')}${result.artifact_path}`);
      if (result.threshold_result) {
        console.info(
          `    ${result.threshold_result.passed ? green('✓ thresholds passed') : red('✗ thresholds failed')} (${result.threshold_result.violations.length} violation(s))`,
        );
        console.info(`    ${dim('threshold evidence: ')}${result.threshold_artifact_path}`);
      }
      return result.threshold_result?.passed === false ? 2 : 0;
    }
    case 'dr': {
      printHeader('dr');
      const subcommand = args.positionals[0];
      const publicKeyFile = args.values.get('public-key');
      if (args.flags.has('public-key') && !args.values.has('public-key')) {
        console.error(red('aqa dr: --public-key requires a value'));
        return 1;
      }
      if (subcommand === 'inventory') {
        const inventoryFile = args.positionals[1];
        if (!inventoryFile) {
          console.error(red('aqa dr inventory: missing <file>'));
          return 1;
        }
        const result = runDrInventory({
          inventoryFile,
          ...(publicKeyFile !== undefined ? { publicKeyFile } : {}),
        });
        if (!result.ok) {
          console.error(red(`aqa dr inventory: ${result.error ?? 'verification failed'}`));
          return 1;
        }
        console.info(`  ${green('✓')} backup ${result.backup_id}`);
        console.info(`  ${dim('sha256:')} ${result.inventory_sha256}`);
        console.info(`  ${dim('signature:')} ${result.signature}`);
        return 0;
      }
      if (subcommand === 'restore') {
        const inventoryFile = args.positionals[1];
        const evidenceFile = args.positionals[2];
        if (!inventoryFile || !evidenceFile) {
          console.error(red('aqa dr restore: missing <inventory> <evidence>'));
          return 1;
        }
        const result = runDrRestore({
          inventoryFile,
          evidenceFile,
          ...(publicKeyFile !== undefined ? { publicKeyFile } : {}),
        });
        if (!result.ok) {
          console.error(red(`aqa dr restore: ${result.error ?? 'verification failed'}`));
          return 1;
        }
        console.info(`  ${green('✓')} restore drill ${result.drill_id}`);
        console.info(`  ${dim('backup:')} ${result.backup_id}`);
        console.info(
          `  ${dim('observed:')} rpo=${result.observed_rpo_minutes}m rto=${result.observed_rto_minutes}m`,
        );
        return 0;
      }
      console.error(red(`aqa dr: unknown subcommand "${subcommand ?? ''}"`));
      return 1;
    }
    case 'risk': {
      const subcommand = args.positionals[0];
      if (subcommand !== 'discover' && subcommand !== 'coverage') {
        console.error(red('aqa risk: expected `discover` or `coverage`'));
        return 1;
      }
      if (subcommand === 'coverage') {
        if (args.flags.has('profile') && !args.values.has('profile')) {
          console.error(red('aqa risk coverage: --profile requires a value'));
          return 1;
        }
        const result = runRiskCoverage({
          root: cwd,
          ...(args.values.has('profile') ? { profile: args.values.get('profile') ?? '' } : {}),
        });
        for (const error of result.errors) console.error(red(`  ✗ ${error}`));
        for (const report of result.reports) {
          const badge = report.status === 'covered' ? green('✓') : yellow('⚠');
          console.info(
            `  ${badge} ${report.risk_id} ${report.status} score=${report.coverage_score.toFixed(4)}`,
          );
          for (const alert of report.drift_alerts) console.info(`    ${yellow('·')} ${alert}`);
        }
        if (!result.ok) return 1;
        if (!result.gate_ok) {
          console.error(
            red('  ✗ coverage gate not satisfied: every risk must be covered and fresh'),
          );
          return 2;
        }
        return 0;
      }
      const method = args.values.get('method');
      if (method !== 'stride' && method !== 'owasp' && method !== 'fmea' && method !== 'source') {
        console.error(red('aqa risk discover: --method must be stride, owasp, fmea or source'));
        return 1;
      }
      const result = runRiskDiscover({
        root: cwd,
        method,
        ...(args.values.has('scope') ? { scope: args.values.get('scope') ?? '' } : {}),
        force: args.flags.has('force'),
      });
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(`  ${green('✓')} generated ${result.risk_count} ${method.toUpperCase()} risks`);
      console.info(`    ${dim('risk map: ')}${result.path}`);
      console.info(`    ${dim('write:    ')}${result.write_result}`);
      return 0;
    }
    case 'admin': {
      printHeader('admin');
      if (args.flags.has('port') && !args.values.has('port')) {
        console.error(red('aqa admin: --port requires a value'));
        return 1;
      }
      if (args.flags.has('host') && !args.values.has('host')) {
        console.error(red('aqa admin: --host requires a value'));
        return 1;
      }
      const adminOpts: Parameters<typeof runAdmin>[0] = { root: cwd };
      if (args.values.has('port')) {
        const raw = args.values.get('port') ?? '';
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 65535) {
          console.error(red(`aqa admin: --port must be an integer 0..65535, got "${raw}"`));
          return 1;
        }
        adminOpts.port = n;
      }
      if (args.values.has('host')) adminOpts.host = args.values.get('host') ?? '';
      const result = await runAdmin(adminOpts);
      if (!result.ok) {
        console.error(red(`  ✗ ${result.error}`));
        return 1;
      }
      console.info(`  ${green('✓')} admin listening at ${bold(result.url)}`);
      console.info(`    ${dim('healthz:   ')}${result.url}/api/healthz`);
      console.info(`    ${dim('Stop:      ')}Ctrl-C`);
      // Keep the process alive until interrupted. The server holds an open
      // socket but that alone isn't enough to keep node from exiting once
      // there's no other pending work — register a SIGINT/SIGTERM listener
      // that closes cleanly before exiting.
      const stop = async (): Promise<void> => {
        await result.close();
        process.exit(0);
      };
      process.on('SIGINT', () => {
        void stop();
      });
      process.on('SIGTERM', () => {
        void stop();
      });
      // Block forever — until a signal triggers stop().
      await new Promise<void>(() => {});
      return 0;
    }
    case 'worker': {
      printHeader('worker');
      try {
        const config = runnerConfigFromEnv();
        console.info(`  ${green('✓')} scoped runner worker starting`);
        console.info(`    ${dim('root:    ')}${config.root}`);
        console.info(
          `    ${dim('scopes:  ')}${config.scopes.map((s) => `${s.org}/${s.project ?? '*'}`).join(',')}`,
        );
        await runWorker(config);
        return 0;
      } catch (error) {
        console.error(red(`  ✗ ${error instanceof Error ? error.message : String(error)}`));
        return 1;
      }
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
