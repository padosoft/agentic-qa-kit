/**
 * `aqa run` — the inner-loop driver.
 *
 * Loads `.aqa/project.yaml` + `.aqa/profiles.yaml` using the canonical
 * `@aqa/schemas` shapes, resolves packs from either an explicit `packsRoot`
 * list or three default locations (project's `packs/*`, every
 * `node_modules/@aqa/*` subdir that contains a `pack.yaml`, and the
 * `dist/packs/*` bundled inside `@aqa/kit`), filters scenarios by
 * the selected profile's `tags`, and runs each one via
 * `@aqa/runner.runScenario`. The runner appends to the events + findings
 * writers we hand it; we never re-emit `finding_emitted` ourselves.
 *
 * Profiles with `require_deterministic_replay: true` (the canonical
 * "release-gate" signal from the schema) treat any emitted finding as a
 * run-level failure. Missing probe drivers and transport errors are recorded
 * as failed evidence; they are never represented by a synthetic success.
 * is the honest signal for now. Both smoke and release-gate currently
 * report `ok: true` when scenarios completed without infrastructure
 * errors. Agent profiles require an explicit host-owned `agentRunner`; this
 * command never selects a model or provider implicitly. Hardened orchestrator
 * profiles provide a container boundary for shell probes when no host driver
 * is given; browser, SQL and provider-specific drivers remain explicit.
 *
 * When `.aqa/project.yaml` declares `sut.base_url`, the default probe runner
 * is the origin-scoped HTTP driver from `@aqa/runner`. Smoke profiles keep
 * shell, browser, SQL and provider-specific drivers explicit; hardened
 * profiles additionally route shell probes through `@aqa/sandbox`. This
 * command owns orchestration and the audit trail.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ArtifactStore } from '@aqa/artifacts';
import {
  type AuditCheckpointSigner,
  createAuditCheckpoint,
  parseEventLines,
} from '@aqa/compliance';
import {
  type CompiledStatefulJourney,
  type JourneyAction,
  type JourneyCleanup,
  executeStatefulJourney,
} from '@aqa/methodology';
import {
  type MetricsRegistry,
  OtlpHttpSpanExporter,
  Tracer,
  makeEventMetricsObserver,
  makeEventSpanObserver,
} from '@aqa/observability';
import {
  type LoadedPack,
  appliesWhen,
  loadPack,
  loadPackResources,
  resolvePackScenario,
} from '@aqa/pack-loader';
import {
  scanPack,
  verifyManifestDigest,
  verifyPackContentDigest,
  verifyTrustedManifestSignature,
} from '@aqa/pack-scanner';
import { buildReplayArtifacts } from '@aqa/reporter';
import {
  EventChainWriter,
  FindingsWriter,
  type PlaywrightProbeRunnerOptions,
  type PostgresSqlProbeRunnerOptions,
  type ProbeRunResult,
  type ProbeRunner,
  type ShellProbeRunnerOptions,
  type SqlProbeRunnerOptions,
  makeHttpProbeRunner,
  makePlaywrightProbeRunner,
  makePostgresSqlProbeRunner,
  makeShellProbeRunner,
  makeSqlProbeRunner,
  runScenario,
} from '@aqa/runner';
import { ContainerSandbox, type Sandbox } from '@aqa/sandbox';
import { type Event, Profile, Project, RiskMap, Run, Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';
import { createRunArtifactStore } from '../artifacts.js';

type ClosableProbeRunner = ProbeRunner & { close?: () => Promise<void> };

/**
 * Host-owned probe integrations for the CLI orchestration boundary.
 *
 * These are deliberately not read from pack content. A production host can
 * inject a preconfigured SQL adapter, or the convenience PostgreSQL driver;
 * shell and browser execution remain explicit because they expand the trust
 * boundary beyond ordinary HTTP probes.
 */
export interface RunProbeDrivers {
  shell?: ShellProbeRunnerOptions;
  sql?: SqlProbeRunnerOptions;
  postgres?: PostgresSqlProbeRunnerOptions;
  playwright?: Omit<PlaywrightProbeRunnerOptions, 'baseUrl'> & { baseUrl?: string };
}

/** Host-owned runtime binding for a compiled stateful journey. */
export interface StatefulJourneyBinding {
  plan: CompiledStatefulJourney;
  contexts: Readonly<Record<string, unknown>>;
  action: JourneyAction<unknown>;
  cleanup: JourneyCleanup<unknown>;
}

function envEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true' || value?.toLowerCase() === 'yes';
}

/**
 * Translate explicit operator environment into host-owned drivers. Secrets
 * are returned only in memory and are never included in diagnostics.
 * Disabled by default; malformed opt-in configuration throws a safe message.
 */
export function probeDriversFromEnvironment(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): RunProbeDrivers | undefined {
  const drivers: RunProbeDrivers = {};
  const postgresDsn = env.AQA_PROBE_POSTGRES_DSN?.trim();
  if (postgresDsn) drivers.postgres = { connectionString: postgresDsn };

  if (envEnabled(env.AQA_PROBE_SHELL_ENABLED)) {
    const allowedCommands = (env.AQA_PROBE_SHELL_ALLOWED_COMMANDS ?? '')
      .split(',')
      .map((command) => command.trim())
      .filter(Boolean);
    if (allowedCommands.length === 0) {
      throw new Error(
        'AQA_PROBE_SHELL_ENABLED requires AQA_PROBE_SHELL_ALLOWED_COMMANDS (comma-separated)',
      );
    }
    drivers.shell = {
      allowShell: true,
      cwd: env.AQA_PROBE_SHELL_CWD?.trim() || root,
      allowedCommands,
    };
  }

  if (envEnabled(env.AQA_PROBE_PLAYWRIGHT_ENABLED)) {
    const allowedOrigins = (env.AQA_PROBE_PLAYWRIGHT_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    drivers.playwright = allowedOrigins.length > 0 ? { allowedOrigins } : {};
  }
  return Object.keys(drivers).length > 0 ? drivers : undefined;
}

export interface RunOptions {
  root: string;
  /** Stable host-owned worker identity recorded in audit and trace provenance. */
  runner_id?: string;
  /** Cooperative cancellation owned by a queue worker or embedding host. */
  signal?: AbortSignal;
  /**
   * Profile key from .aqa/profiles.yaml. When omitted, prefers "smoke" if
   * present; otherwise falls back to the first key in the file (insertion
   * order). Pass `--profile` explicitly for release-gate paths.
   */
  profile?: string;
  /** If set, makes run_id deterministic — useful for tests + replay. */
  seed?: string;
  /**
   * Filesystem paths (absolute or relative to `root`) to use as pack roots.
   * Each path must contain a `pack.yaml` manifest at its root. When omitted,
   * `defaultPacksRoot()` discovers packs from three locations in fixed
   * priority order:
   *   1. `<root>/packs/*` (monorepo / vendored layout)
   *   2. `<root>/node_modules/@aqa/pack-*` (npm-installed packs)
   *   3. `dist/packs/*` bundled inside the running `@aqa/kit` install
   * Within each tier, directory entries are sorted alphabetically for
   * `--seed` determinism. Caller-supplied `packsRoot` values are likewise
   * sorted alphabetically. A pack discovered in an earlier tier wins over
   * the same-named manifest in a later tier (project beats node_modules
   * beats bundled).
   */
  packsRoot?: string[];
  /** Optional OTLP/HTTP endpoint; defaults to AQA_OTLP_ENDPOINT when set. */
  otlpEndpoint?: string;
  /** Optional bounded metrics sink for the same audit events written by the run. */
  metrics?: MetricsRegistry;
  /** Explicit driver boundary for integrations/tests; production must provide a real driver. */
  probeRunner?: ClosableProbeRunner;
  /** Optional host-owned sandbox; hardened profiles create a container sandbox when omitted. */
  sandbox?: Sandbox;
  /** Explicit host-owned agent driver. Required for `execution_mode: agent`. */
  agentRunner?: ClosableProbeRunner;
  /** Host-injected HTTP probe secrets; values never come from pack files. */
  httpSecrets?: Readonly<Record<string, string>>;
  /** Optional capability declaration forwarded to runner preflight. */
  supportedProbeKinds?: ReadonlySet<Scenario.ProbeKind>;
  /** Explicit host-owned drivers for non-HTTP probe kinds. */
  probeDrivers?: RunProbeDrivers;
  /** Optional host-owned actor journey bindings keyed by scenario id. */
  statefulJourneys?: Readonly<Record<string, StatefulJourneyBinding>>;
  /** Require trusted Ed25519 signatures and a full pack content digest before execution. */
  requireSignedPacks?: boolean;
  /** Operator trust root keyed by the manifest signing key_id. */
  packTrustedKeys?: Readonly<Record<string, string>>;
  /** Optional operator key used to sign the final audit completeness checkpoint. */
  auditCheckpointSigner?: AuditCheckpointSigner;
  /** Independent store for the final checkpoint; failure blocks the run. */
  auditCheckpointStore?: ArtifactStore;
  /**
   * Wall-clock source for the scheduler budget. Production uses Date.now;
   * embedders/tests may inject a deterministic source.
   */
  now?: () => number;
}

export interface RunResult {
  ok: boolean;
  /**
   * Present whenever the run got far enough to allocate a run directory —
   * which is most failure modes (broken pack, malformed scenario, 0
   * scenarios, findings.jsonl create failure, or an exception on the
   * initial `run_started` event write). Absent only for the early-exit
   * errors that happen before the directory is created: missing
   * project.yaml, schema-invalid project/profiles, invalid CLI flags,
   * runs-dir unwritable, agent-mode profile without an agent driver, or a
   * deterministic-seed
   * collision. (Note: "release-gate findings" is **not** a failure mode
   * today; the strict semantics are deferred until the host supplies a
   * provider-backed driver — see the file-level docstring.)
   */
  runId?: string;
  /** Same presence semantics as `runId`. */
  runDir?: string;
  scenariosRun: number;
  findingsCount: number;
  /**
   * Aggregated reason(s) the run is not OK. Always present when `ok: false`.
   */
  error?: string;
  /**
   * Diagnostics that did not fail the run but should still be surfaced.
   * Currently only one condition flows through: an unrelated broken pack
   * discovered on disk when the selected profile didn't reference it
   * (specific-selection mode). Every other observed gap — missing
   * manifest scenarios, malformed scenario YAML, unsafe paths, runtime
   * exceptions, missing/unmatched selected packs — is treated as a hard
   * error and shows up in `error` with `ok: false`. Bounded to
   * `MAX_DETAIL_PER_KIND` entries per source.
   */
  warnings?: string[];
  /** Artifact-store keys containing byte-preserved canonical run evidence. */
  canonicalArtifacts?: string[];
}

/** Cap on how many detail entries per category we surface in events/RunResult. */
const MAX_DETAIL_PER_KIND = 10;

function readYaml<T>(path: string): T {
  return yamlParse(readFileSync(path, 'utf8')) as T;
}

function cap<T>(arr: readonly T[]): T[] {
  return arr.length <= MAX_DETAIL_PER_KIND ? [...arr] : arr.slice(0, MAX_DETAIL_PER_KIND);
}

function deterministicRunId(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `run-${h}`;
}

function freshRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.T]/g, '-')
    .replace(/-+/g, '-')
    .replace(/z$/i, '')
    .replace(/-$/, '');
  const rnd = createHash('sha256')
    .update(`${stamp}|${process.pid}|${Math.random()}`)
    .digest('hex')
    .slice(0, 6);
  return `run-${stamp}-${rnd}`.toLowerCase();
}

/**
 * Route shell probes through the host-owned sandbox. HTTP remains handled by
 * the origin-scoped driver; every other probe kind stays explicitly
 * unsupported until its own driver is injected.
 */
function composeSandboxProbeRunner(sandbox: Sandbox, httpRunner?: ProbeRunner): ProbeRunner {
  return async (probe, signal): Promise<ProbeRunResult> => {
    if (probe.kind === 'http' && httpRunner) return httpRunner(probe, signal);
    if (probe.kind !== 'shell') {
      return { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
    }
    const command = probe.with.command;
    if (typeof command !== 'string' || command.trim() === '') {
      return { probe_id: probe.id, error: 'shell probe requires with.command' };
    }
    if (signal?.aborted)
      return { probe_id: probe.id, error: 'shell probe cancelled before dispatch' };
    const result = await sandbox.invoke({ tool: 'shell', args: { command } });
    return result.ok
      ? { probe_id: probe.id, status: 200, body: result.output }
      : { probe_id: probe.id, error: result.error ?? 'sandbox shell probe failed' };
  };
}

interface NamedProbeRunner {
  kind: Scenario.ProbeKind;
  runner: ClosableProbeRunner;
}

/** Compose independently owned drivers without allowing kind fall-through. */
function composeProbeRunners(drivers: readonly NamedProbeRunner[]): ClosableProbeRunner {
  const byKind = new Map(drivers.map(({ kind, runner }) => [kind, runner]));
  const composed = (async (probe, signal) => {
    const runner = byKind.get(probe.kind);
    return runner
      ? runner(probe, signal)
      : { probe_id: probe.id, error: `unsupported probe kind "${probe.kind}"` };
  }) as ClosableProbeRunner;
  composed.close = async () => {
    const closed = new Set<ClosableProbeRunner>();
    for (const runner of byKind.values()) {
      if (closed.has(runner) || !runner.close) continue;
      closed.add(runner);
      await runner.close();
    }
  };
  return composed;
}

/**
 * Scan one directory for child pack manifests (each child must have a
 * `pack.yaml` or `pack.yml`). Sorted for `--seed` determinism. FS failures
 * degrade to fewer discovered packs, not a thrown exception.
 */
function discoverInDir(parentDir: string, candidates: string[]): void {
  try {
    if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) return;
    for (const entry of readdirSync(parentDir).sort()) {
      const abs = join(parentDir, entry);
      try {
        if (
          statSync(abs).isDirectory() &&
          (existsSync(join(abs, 'pack.yaml')) || existsSync(join(abs, 'pack.yml')))
        ) {
          candidates.push(abs);
        }
      } catch {
        // unreadable child — skip
      }
    }
  } catch {
    // unreadable parent — skip
  }
}

/**
 * Path to the packs bundled inside `@aqa/kit/dist/packs/`. We resolve this
 * from the running module URL so it works whether the kit is installed from
 * npm, linked from the workspace, or running from a global install.
 */
function bundledKitPacksDir(): string {
  // dist/commands/run.js → dist/packs
  const here = commandModuleDir();
  const bundledPath = resolve(here, 'packs');
  return existsSync(bundledPath) ? bundledPath : resolve(here, '..', 'packs');
}

function commandModuleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  const entry = process.argv[1];
  const name = entry ? basename(entry) : '';
  if (entry && (name === 'cli.cjs' || name === 'run.js' || name === 'admin.js'))
    return dirname(resolve(entry));
  return resolve(process.cwd(), 'dist', 'commands');
}

function defaultPacksRoot(projectRoot: string): string[] {
  const candidates: string[] = [];
  // 1. Monorepo / vendored layout: <project>/packs/*
  discoverInDir(join(projectRoot, 'packs'), candidates);
  // 2. npm-installed bundled packs: every subdirectory of
  //    `<project>/node_modules/@aqa` that contains a `pack.yaml` (the
  //    name doesn't have to start with `pack-` — only the manifest's
  //    `name:` field is meaningful). Real consumer projects install
  //    packs as workspace or registry deps under the @aqa scope.
  discoverInDir(join(projectRoot, 'node_modules', '@aqa'), candidates);
  // 3. Packs bundled inside the running `@aqa/kit` install. Lets the
  //    documented `aqa init` → `aqa run --profile smoke` flow work with
  //    only `@aqa/kit` installed (the canonical junior workflow).
  discoverInDir(bundledKitPacksDir(), candidates);
  return candidates;
}

export function resolvePackDirs(opts: RunOptions): string[] {
  if (opts.packsRoot && opts.packsRoot.length > 0) {
    // Sort caller-supplied paths so `--seed` determinism doesn't depend on
    // how the caller assembled the array. Comparing absolute paths gives
    // stable cross-platform order.
    return opts.packsRoot.map((p) => (isAbsolute(p) ? p : resolve(opts.root, p))).sort();
  }
  return defaultPacksRoot(opts.root);
}

export interface ManifestScenarios {
  paths: string[];
  /** manifest-listed paths that didn't resolve on disk — treated as coverage gaps. */
  missing: string[];
  /** manifest-listed paths that would escape packRoot — treated as malicious/buggy. */
  unsafe: string[];
}

/**
 * Containment check: does `abs` resolve to a path inside `root`?
 * - Rejects absolute escapes (relative result is itself absolute).
 * - Rejects `..` segments (uses exact-segment match, not prefix — so a
 *   legitimate directory named `..data/` doesn't trigger false positives).
 */
function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  if (rel === '' || rel === '.') return true;
  if (isAbsolute(rel)) return false;
  const segments = rel.split(sep);
  return !segments.some((s) => s === '..');
}

/**
 * Resolve manifest-listed scenarios. Missing files are surfaced (not silently
 * dropped), and any entry that's absolute, escapes the pack root via `..`,
 * or symlinks outside the pack root is rejected as unsafe so a
 * malicious/buggy pack.yaml can't trick `aqa run` into reading arbitrary
 * filesystem paths.
 */
export function manifestScenarioFiles(packRoot: string, pack: LoadedPack): ManifestScenarios {
  const paths: string[] = [];
  const missing: string[] = [];
  const unsafe: string[] = [];
  // realpath the root once so we compare real-path containment, not symlink
  // illusions. Falls back to the literal root if realpath fails (e.g. the
  // pack root itself is a broken symlink).
  let realRoot: string;
  try {
    realRoot = realpathSync(packRoot);
  } catch {
    realRoot = packRoot;
  }
  for (const rel of pack.manifest.scenarios ?? []) {
    if (isAbsolute(rel)) {
      unsafe.push(rel);
      continue;
    }
    const abs = resolve(packRoot, rel);
    if (!isInside(packRoot, abs)) {
      unsafe.push(rel);
      continue;
    }
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    // Symlink-aware check: resolve the real path and assert it's still under
    // the real pack root. This blocks `scenarios/foo.yaml -> /etc/passwd`.
    let realAbs: string;
    try {
      realAbs = realpathSync(abs);
    } catch {
      // realpath failure (e.g. dangling symlink) — treat as unsafe.
      unsafe.push(rel);
      continue;
    }
    if (!isInside(realRoot, realAbs)) {
      unsafe.push(rel);
      continue;
    }
    paths.push(abs);
  }
  return { paths, missing, unsafe };
}

/** Scenario tags intersect profile tags (or profile has no filter). */
function tagsMatch(scenarioTags: readonly string[], profileTags: readonly string[]): boolean {
  if (profileTags.length === 0) return true;
  return scenarioTags.some((t) => profileTags.includes(t));
}

function makeError(error: string, runDirInfo?: { runId: string; runDir: string }): RunResult {
  return {
    ok: false,
    ...(runDirInfo ?? {}),
    scenariosRun: 0,
    findingsCount: 0,
    error,
  };
}

export async function runRun(opts: RunOptions): Promise<RunResult> {
  if (opts.profile !== undefined && opts.profile.trim() === '') {
    return makeError('--profile requires a non-empty value');
  }
  if (opts.seed !== undefined && opts.seed.trim() === '') {
    return makeError('--seed requires a non-empty value');
  }
  const runnerId = opts.runner_id?.trim() || 'aqa-cli';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(runnerId)) {
    return makeError('runner_id must contain only bounded identifier characters');
  }

  const projectPath = join(opts.root, '.aqa', 'project.yaml');
  const profilesPath = join(opts.root, '.aqa', 'profiles.yaml');
  if (!existsSync(projectPath)) {
    return makeError('.aqa/project.yaml not found — run `aqa init` first');
  }
  if (!existsSync(profilesPath)) {
    return makeError('.aqa/profiles.yaml not found — run `aqa init` first');
  }

  let project: Project.Project;
  let profilesFile: Profile.ProfilesFile;
  let projectRiskMap: RiskMap.RiskMap;
  try {
    project = Project.Project.parse(readYaml<unknown>(projectPath));
  } catch (e) {
    return makeError(`.aqa/project.yaml: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    profilesFile = Profile.ProfilesFile.parse(readYaml<unknown>(profilesPath));
  } catch (e) {
    return makeError(`.aqa/profiles.yaml: ${e instanceof Error ? e.message : String(e)}`);
  }
  const riskMapPath = join(opts.root, '.aqa', 'risk-map.yaml');
  if (!existsSync(riskMapPath)) {
    return makeError('.aqa/risk-map.yaml not found — add the project risk map before running');
  }
  try {
    projectRiskMap = RiskMap.RiskMap.parse(readYaml<unknown>(riskMapPath));
  } catch (e) {
    return makeError(`.aqa/risk-map.yaml: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Default-profile policy: when --profile is omitted, prefer "smoke" if it
  // exists, otherwise the first key in the file (deterministic only if the
  // YAML has stable key order). Documented so consumers don't depend on
  // luck for the "release-gate" path.
  const profileKey =
    opts.profile ?? (profilesFile.profiles.smoke ? 'smoke' : Object.keys(profilesFile.profiles)[0]);
  if (!profileKey || !profilesFile.profiles[profileKey]) {
    return makeError(
      `unknown profile "${profileKey ?? ''}" — known: ${Object.keys(profilesFile.profiles).join(', ') || '(none)'}`,
    );
  }
  const profile = profilesFile.profiles[profileKey];

  if (profile.execution_mode === 'agent' && !opts.agentRunner && !opts.probeRunner) {
    return makeError(
      `profile "${profileKey}" requires an injected agentRunner; refusing to execute agent mode without an explicit host driver`,
    );
  }

  const runId = opts.seed
    ? deterministicRunId(`${project.name}|${profileKey}|${opts.seed}`)
    : freshRunId();
  const runsParent = join(opts.root, '.aqa', 'runs');
  const runDir = join(runsParent, runId);
  // Atomic-ish run directory creation: ensure the parent exists (recursive
  // OK there — multiple `runs/` callers want that), then try a non-recursive
  // `mkdirSync(runDir)`. If two concurrent `aqa run` processes share a
  // deterministic runId, only the first succeeds; the second sees EEXIST
  // and returns a structured error instead of stomping the audit chain.
  try {
    mkdirSync(runsParent, { recursive: true });
  } catch (e) {
    return makeError(
      `cannot create runs root ${runsParent}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    mkdirSync(runDir);
  } catch (e) {
    // Any pre-existing `runDir` is a collision and we refuse to reuse it.
    // Reusing a same-named but currently-empty directory looks safe in
    // isolation, but it opens a TOCTOU race for concurrent
    // `aqa run --seed <same>` invocations: process A creates the dir →
    // process B sees the EEXIST → reads it as empty → both append seq=0
    // events to the same events.jsonl and corrupt the hash chain. Forcing
    // the user to clean up an old empty seeded dir is a much smaller cost.
    if (existsSync(runDir)) {
      try {
        if (!statSync(runDir).isDirectory()) {
          return makeError(`run path ${runDir} exists but is not a directory`);
        }
      } catch (statErr) {
        return makeError(
          `cannot stat run directory ${runDir}: ${statErr instanceof Error ? statErr.message : String(statErr)}`,
        );
      }
      return makeError(
        `run directory ${runDir} already exists; refusing to reuse it (concurrent --seed collision, or a leftover from a prior failed run — remove it manually if intentional)`,
      );
    }
    return makeError(
      `cannot create run directory ${runDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const eventsPath = join(runDir, 'events.jsonl');
  const findingsPath = join(runDir, 'findings.jsonl');
  let telemetryError: string | undefined;
  let telemetry: OtlpHttpSpanExporter | undefined;
  let onEvent: ((event: Event.Event) => void) | undefined;
  const observers: Array<(event: Event.Event) => void> = [];
  if (opts.metrics) observers.push(makeEventMetricsObserver(opts.metrics));
  const otlpEndpoint = opts.otlpEndpoint ?? process.env.AQA_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    try {
      telemetry = new OtlpHttpSpanExporter({
        endpoint: otlpEndpoint,
        service_name: process.env.AQA_OTLP_SERVICE_NAME ?? 'aqa-kit',
      });
      observers.push(makeEventSpanObserver(new Tracer((span) => telemetry?.export(span))));
    } catch (error) {
      telemetryError = `OTLP configuration rejected: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (observers.length)
    onEvent = (event) => {
      for (const observer of observers) observer(event);
    };
  const events = new EventChainWriter(eventsPath, {
    ...(onEvent ? { onEvent } : {}),
    runner_id: runnerId,
  });
  const findings = new FindingsWriter(findingsPath);
  // Touch findings.jsonl so downstream consumers can rely on its presence,
  // even when a clean run produces zero findings. Wrap in try/catch so a
  // read-only FS / permission error returns the structured RunResult
  // instead of throwing past it.
  if (!existsSync(findingsPath)) {
    try {
      writeFileSync(findingsPath, '', 'utf8');
    } catch (e) {
      return makeError(
        `cannot create findings.jsonl: ${e instanceof Error ? e.message : String(e)}`,
        { runId, runDir },
      );
    }
  }

  // Persisting the initial event must succeed — if it fails (read-only FS,
  // disk full, permission), the run can't produce a usable audit trail, so
  // surface that as a structured error instead of crashing into the CLI's
  // top-level unhandled-error handler.
  try {
    events.append({
      ts: new Date().toISOString(),
      run_id: runId,
      kind: 'run_started',
      actor: { type: 'orchestrator', id: runnerId },
      payload: { profile: profileKey, project: project.name, runner_id: runnerId },
    });
  } catch (e) {
    return makeError(`cannot write events.jsonl: ${e instanceof Error ? e.message : String(e)}`, {
      runId,
      runDir,
    });
  }

  // Build the set of packs the profile actually wants (by Slug). Old
  // `aqa init` versions wrote bare slugs like `core` / `api-core`; current
  // manifests are named `pack-core` / `pack-api-core`. Accept both forms so
  // projects scaffolded against older kits keep working without manual
  // migration: each entry is matched against both its exact value and its
  // `pack-`-prefixed variant.
  const profilePackSet = new Set<string>();
  for (const p of profile.packs) {
    profilePackSet.add(p);
    if (!p.startsWith('pack-')) profilePackSet.add(`pack-${p}`);
  }

  // Dedupe discovered pack directories by manifest name. `resolvePackDirs()`
  // walks `<project>/packs/*`, then `<project>/node_modules/@aqa/*`, then
  // the kit-bundled `dist/packs/*`. A monorepo checkout (or a project that
  // vendors packs *and* installs `@aqa/kit` for the bundled copy) can hit
  // the same manifest name twice — without dedup, every scenario would be
  // executed and audited twice. First-seen wins, so the priority order
  // matches the discovery order above: project > node_modules > bundled.
  const seenPackNames = new Set<string>();
  const httpSecrets = {
    ...httpSecretsFromEnvironment(),
    ...(opts.httpSecrets ?? {}),
  };
  const explicitRunner =
    profile.execution_mode === 'agent' ? (opts.agentRunner ?? opts.probeRunner) : opts.probeRunner;
  const httpRunner = project.sut.base_url
    ? makeHttpProbeRunner({
        baseUrl: project.sut.base_url,
        ...(Object.keys(httpSecrets).length > 0 ? { secrets: httpSecrets } : {}),
      })
    : undefined;
  const hardenedProfile = profileKey === 'security' || profileKey === 'release-gate';
  let sandbox: Sandbox | undefined;
  try {
    sandbox =
      explicitRunner || profile.execution_mode === 'agent'
        ? opts.sandbox
        : (opts.sandbox ??
          (hardenedProfile
            ? new ContainerSandbox({
                budget: { max_calls: 200, per_call_timeout_ms: 60_000 },
                require_pinned_image: true,
              })
            : undefined));
  } catch (error) {
    return makeError(
      `profile "${profileKey}" sandbox configuration is invalid: ${
        error instanceof Error ? error.message : 'invalid sandbox configuration'
      }`,
    );
  }
  let probeRunner: ClosableProbeRunner | undefined;
  let configuredProbeKinds: ReadonlySet<Scenario.ProbeKind> | undefined;
  if (explicitRunner) {
    probeRunner = explicitRunner;
    configuredProbeKinds = opts.supportedProbeKinds;
  } else {
    const drivers: NamedProbeRunner[] = [];
    const supportedKinds = new Set<Scenario.ProbeKind>();
    if (httpRunner) {
      drivers.push({ kind: 'http', runner: httpRunner });
      supportedKinds.add('http');
    }
    if (sandbox) {
      const sandboxRunner = composeSandboxProbeRunner(sandbox, undefined);
      drivers.push({ kind: 'shell', runner: sandboxRunner });
      supportedKinds.add('shell');
    } else if (opts.probeDrivers?.shell) {
      drivers.push({ kind: 'shell', runner: makeShellProbeRunner(opts.probeDrivers.shell) });
      supportedKinds.add('shell');
    }
    try {
      if (opts.probeDrivers?.sql && opts.probeDrivers.postgres) {
        throw new Error('probeDrivers.sql and probeDrivers.postgres are mutually exclusive');
      }
      if (opts.probeDrivers?.sql) {
        drivers.push({ kind: 'sql', runner: makeSqlProbeRunner(opts.probeDrivers.sql) });
        supportedKinds.add('sql');
      } else if (opts.probeDrivers?.postgres) {
        drivers.push({
          kind: 'sql',
          runner: makePostgresSqlProbeRunner(opts.probeDrivers.postgres),
        });
        supportedKinds.add('sql');
      }
      if (opts.probeDrivers?.playwright) {
        const playwrightBaseUrl = opts.probeDrivers.playwright.baseUrl ?? project.sut.base_url;
        if (!playwrightBaseUrl) {
          throw new Error(
            'playwright probe driver requires project.sut.base_url or probeDrivers.playwright.baseUrl',
          );
        }
        drivers.push({
          kind: 'playwright',
          runner: makePlaywrightProbeRunner({
            ...opts.probeDrivers.playwright,
            baseUrl: playwrightBaseUrl,
          }),
        });
        supportedKinds.add('playwright');
      }
    } catch (error) {
      const closed = new Set<ClosableProbeRunner>();
      for (const { runner } of drivers) {
        if (closed.has(runner) || !runner.close) continue;
        closed.add(runner);
        await runner.close();
      }
      return makeError(
        `probe driver configuration is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (drivers.length > 0) probeRunner = composeProbeRunners(drivers);
    configuredProbeKinds = opts.supportedProbeKinds ?? supportedKinds;
  }
  // applies_when context built from the parsed project — lets the pack-loader
  // skip packs that explicitly don't match the SUT. We forward every field
  // `appliesWhen()` knows about (sut_type, runtime, framework, db, tags) so a
  // pack declaring `applies_when.db: [postgres]` only runs when the project
  // actually uses postgres.
  const appliesCtx = {
    sut_type: project.sut.type,
    runtime: project.stack.runtime,
    ...(project.stack.framework ? { framework: project.stack.framework } : {}),
    db: project.stack.db ?? [],
    tags: project.tags ?? [],
  };

  let scenariosRun = 0;
  // `packErrors` collects every failed `loadPack()`; we decide later whether
  // to surface them. When the profile pins specific packs, an unrelated
  // broken pack elsewhere on disk (`packs/experimental/`, a stale
  // `node_modules/@aqa/pack-old`) shouldn't make `aqa run --profile smoke`
  // fail — but if the profile pins NO packs (use-everything mode), every
  // load failure is a real coverage gap. Same goes for the case where the
  // profile pins packs but none of them loaded successfully.
  const packErrors: string[] = [];
  const scenarioErrors: string[] = [];
  const missingScenarios: string[] = [];
  const unsafeScenarioPaths: string[] = [];
  const runtimeErrors: string[] = [];
  const executionErrors: string[] = [];
  const scenarioOutcomesByOrder = new Map<number, { scenario_id: string; outcome: string }>();
  const executedScenarios: Scenario.Scenario[] = [];
  const pendingScenarios: Array<{ scenario: Scenario.Scenario; risk?: RiskMap.Risk }> = [];
  const riskCatalog = new Map(projectRiskMap.risks.map((risk) => [risk.id, risk]));
  const now = opts.now ?? Date.now;
  const budgetDeadline =
    profile.budget_minutes === undefined ? undefined : now() + profile.budget_minutes * 60 * 1000;
  let budgetExceeded = false;
  let cancelled = false;
  for (const packDir of resolvePackDirs(opts)) {
    let pack: LoadedPack;
    let resources: ReturnType<typeof loadPackResources>;
    try {
      pack = loadPack(packDir);
      if (opts.requireSignedPacks) {
        const scan = scanPack(pack.manifest, { requireSignature: true });
        const blocking = scan.issues.filter(
          (issue) => issue.severity === 'critical' || issue.severity === 'high',
        );
        if (blocking.length > 0) {
          packErrors.push(`${packDir}: ${blocking.map((issue) => issue.rule).join(', ')}`);
          continue;
        }
        const manifestSignature = verifyManifestDigest(pack.manifest);
        if (!manifestSignature.ok) {
          packErrors.push(`${packDir}: ${manifestSignature.reason}`);
          continue;
        }
        if (!pack.manifest.signing?.content_sha256) {
          packErrors.push(`${packDir}: signed execution requires signing.content_sha256`);
          continue;
        }
        if (!opts.packTrustedKeys || Object.keys(opts.packTrustedKeys).length === 0) {
          packErrors.push(`${packDir}: signed execution requires an operator trust root`);
          continue;
        }
        const trustedSignature = verifyTrustedManifestSignature(
          pack.manifest,
          opts.packTrustedKeys,
        );
        if (!trustedSignature.ok) {
          packErrors.push(`${packDir}: ${trustedSignature.reason}`);
          continue;
        }
      }
      const contentIntegrity = verifyPackContentDigest(pack.root, pack.manifest);
      if (!contentIntegrity.ok) {
        packErrors.push(`${packDir}: ${contentIntegrity.reason}`);
        continue;
      }
      // Resource declarations are part of the signed pack boundary. Load and
      // validate them before any scenario can execute; missing or unsafe
      // declarations are coverage errors, never silently ignored.
      resources = loadPackResources(pack);
    } catch (e) {
      packErrors.push(`${packDir}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (profilePackSet.size > 0 && !profilePackSet.has(pack.manifest.name)) continue;
    // Skip packs whose `applies_when` excludes this SUT (when applies_when
    // is set on the manifest). Packs that explicitly opt into this SUT, or
    // that have no applies_when filter, fall through.
    if (!appliesWhen(pack.manifest, appliesCtx)) {
      continue;
    }
    // Skip a pack we've already executed under the same manifest name
    // (project/node_modules already won; bundled copy is a fallback).
    if (seenPackNames.has(pack.manifest.name)) continue;
    seenPackNames.add(pack.manifest.name);

    const { paths, missing, unsafe } = manifestScenarioFiles(packDir, pack);
    for (const rel of missing) missingScenarios.push(`${pack.manifest.name}:${rel}`);
    for (const rel of unsafe) unsafeScenarioPaths.push(`${pack.manifest.name}:${rel}`);

    for (const relativeRiskPath of pack.manifest.risks ?? []) {
      if (isAbsolute(relativeRiskPath)) {
        packErrors.push(`${packDir}: unsafe risk path ${relativeRiskPath}`);
        continue;
      }
      const riskPath = resolve(packDir, relativeRiskPath);
      if (!isInside(packDir, riskPath) || !existsSync(riskPath)) {
        packErrors.push(
          `${packDir}: risk file is missing or escapes pack root: ${relativeRiskPath}`,
        );
        continue;
      }
      try {
        const realPackRoot = realpathSync(packDir);
        const realRiskPath = realpathSync(riskPath);
        if (!isInside(realPackRoot, realRiskPath)) {
          packErrors.push(`${packDir}: risk file symlink escapes pack root: ${relativeRiskPath}`);
          continue;
        }
        const parsedRiskMap = RiskMap.RiskMap.parse(readYaml<unknown>(riskPath));
        for (const risk of parsedRiskMap.risks) riskCatalog.set(risk.id, risk);
      } catch (e) {
        packErrors.push(
          `${packDir}: invalid risk file ${relativeRiskPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    for (const scenarioPath of paths) {
      let scenario: Scenario.Scenario;
      try {
        scenario = resolvePackScenario(
          Scenario.Scenario.parse(readYaml<unknown>(scenarioPath)),
          resources,
        );
      } catch (e) {
        scenarioErrors.push(`${scenarioPath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!tagsMatch(scenario.tags ?? [], profile.tags)) continue;
      const missingRiskRefs = scenario.risk_refs.filter((riskId) => !riskCatalog.has(riskId));
      if (missingRiskRefs.length > 0) {
        scenarioErrors.push(`${scenarioPath}: unresolved risk_refs: ${missingRiskRefs.join(', ')}`);
        continue;
      }
      const resolvedRisk = riskCatalog.get(scenario.risk_refs[0] ?? '');
      pendingScenarios.push({ scenario, ...(resolvedRisk ? { risk: resolvedRisk } : {}) });
    }
  }

  // Profiles expose bounded parallelism, so honor it with a small worker pool
  // after discovery. The cursor is advanced synchronously before awaiting any
  // runner, making finding seeds and scenario accounting unique and stable.
  // Completion events may interleave by design; the summary is sorted back to
  // discovery order so deterministic consumers do not depend on timing.
  let nextScenario = 0;
  let scenarioSequence = 0;
  const isolationTails = new Map<string, Promise<void>>();
  const isolationKey = (scenario: Scenario.Scenario): string | undefined => {
    if (profile.isolation === 'serial') return '__all__';
    if (profile.isolation === 'grouped') return scenario.isolation_group ?? scenario.id;
    return undefined;
  };
  const withIsolation = async <T>(scenario: Scenario.Scenario, operation: () => Promise<T>) => {
    const key = isolationKey(scenario);
    if (!key) return operation();
    const previous = isolationTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    isolationTails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (isolationTails.get(key) === tail) isolationTails.delete(key);
    }
  };
  const executeNextScenario = async () => {
    while (true) {
      const order = nextScenario++;
      const pending = pendingScenarios[order];
      if (!pending) return;
      const { scenario, risk } = pending;
      if (opts.signal?.aborted) {
        cancelled = true;
        scenarioOutcomesByOrder.set(order, { scenario_id: scenario.id, outcome: 'not_run' });
        events.append({
          ts: new Date().toISOString(),
          run_id: runId,
          kind: 'scenario_finished',
          actor: { type: 'orchestrator', id: 'aqa-cli' },
          scenario_id: scenario.id,
          payload: { outcome: 'not_run', execution_status: 'not_started', reason: 'cancelled' },
        });
        continue;
      }
      scenariosRun += 1;
      const findingIdSeed = ++scenarioSequence;
      executedScenarios.push(scenario);
      try {
        await withIsolation(scenario, async () => {
          events.append({
            ts: new Date().toISOString(),
            run_id: runId,
            kind: 'scenario_started',
            actor: { type: 'orchestrator', id: 'kit' },
            scenario_id: scenario.id,
            payload: {
              dispatch_order: order,
              parallelism: profile.parallelism,
              isolation: profile.isolation,
              ...(isolationKey(scenario) ? { isolation_key: isolationKey(scenario) } : {}),
            },
          });
          if (budgetDeadline !== undefined && now() >= budgetDeadline) {
            budgetExceeded = true;
            scenarioOutcomesByOrder.set(order, { scenario_id: scenario.id, outcome: 'not_run' });
            events.append({
              ts: new Date().toISOString(),
              run_id: runId,
              kind: 'scenario_finished',
              actor: { type: 'orchestrator', id: 'aqa-cli' },
              scenario_id: scenario.id,
              payload: {
                outcome: 'not_run',
                execution_status: 'not_started',
                reason: 'budget_exceeded',
              },
            });
            return;
          }
          const statefulJourney = opts.statefulJourneys?.[scenario.id];
          if (statefulJourney) {
            const execution = await executeStatefulJourney(
              statefulJourney.plan,
              statefulJourney.contexts,
              statefulJourney.action,
              statefulJourney.cleanup,
              opts.signal,
            );
            for (const step of execution.steps) {
              events.append({
                ts: new Date().toISOString(),
                run_id: runId,
                kind: 'info',
                actor: { type: 'orchestrator', id: 'stateful-journey' },
                scenario_id: scenario.id,
                payload: {
                  stateful_journey: 'transition',
                  journey_id: execution.journey_id,
                  journey_digest: execution.digest,
                  transition_id: step.transition_id,
                  actor_id: step.actor_id,
                  from: step.from,
                  to: step.to,
                  ok: step.ok,
                },
              });
            }
            scenarioOutcomesByOrder.set(order, {
              scenario_id: scenario.id,
              outcome: execution.status === 'succeeded' ? 'pass' : 'fail',
            });
            events.append({
              ts: new Date().toISOString(),
              run_id: runId,
              kind: 'scenario_finished',
              actor: { type: 'orchestrator', id: 'kit' },
              scenario_id: scenario.id,
              payload: {
                outcome: execution.status === 'succeeded' ? 'pass' : 'fail',
                execution_status: execution.status === 'succeeded' ? 'completed' : 'failed',
                stateful_journey: true,
                journey_id: execution.journey_id,
                journey_digest: execution.digest,
                reached_state: execution.reached_state,
                steps: execution.steps.length,
                observers: execution.observers.length,
                cleanup_ok: execution.cleanup.ok,
                ...(execution.failure
                  ? {
                      failure_phase: execution.failure.phase,
                      failure_code: execution.failure.code,
                      ...(execution.failure.id ? { failure_id: execution.failure.id } : {}),
                    }
                  : {}),
              },
            });
            if (execution.status !== 'succeeded') {
              executionErrors.push(
                `${scenario.id}: stateful journey ${execution.failure?.code ?? execution.status}`,
              );
            }
            return;
          }
          const scenarioResult = await runScenario({
            scenario,
            run_id: runId,
            execution_mode: profile.execution_mode,
            events,
            findings,
            ...(probeRunner ? { probeRunner } : {}),
            ...(configuredProbeKinds ? { supportedProbeKinds: configuredProbeKinds } : {}),
            findingIdSeed,
            ...(risk ? { risk } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
          scenarioOutcomesByOrder.set(order, {
            scenario_id: scenario.id,
            outcome: scenarioResult.outcome,
          });
          events.append({
            ts: new Date().toISOString(),
            run_id: runId,
            kind: 'scenario_finished',
            actor: { type: 'orchestrator', id: 'kit' },
            scenario_id: scenario.id,
            payload: {
              outcome: scenarioResult.outcome,
              execution_status: scenarioResult.execution_status,
              findings: scenarioResult.finding ? 1 : 0,
            },
          });
          if (scenarioResult.execution_status === 'failed') {
            executionErrors.push(
              `${scenario.id}: ${scenarioResult.execution_error ?? 'probe execution failed'}`,
            );
          }
        });
      } catch (e) {
        scenarioOutcomesByOrder.set(order, { scenario_id: scenario.id, outcome: 'error' });
        events.append({
          ts: new Date().toISOString(),
          run_id: runId,
          kind: 'scenario_finished',
          actor: { type: 'orchestrator', id: 'kit' },
          scenario_id: scenario.id,
          payload: { outcome: 'error', execution_status: 'failed' },
        });
        runtimeErrors.push(`${scenario.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (opts.signal?.aborted) cancelled = true;
    }
  };
  const workerCount = Math.min(
    profile.isolation === 'serial' ? 1 : profile.parallelism,
    pendingScenarios.length,
  );
  await Promise.all(Array.from({ length: workerCount }, () => executeNextScenario()));
  const scenarioOutcomes = [...scenarioOutcomesByOrder.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, outcome]) => outcome);

  if (probeRunner?.close) {
    try {
      await probeRunner.close();
    } catch (e) {
      runtimeErrors.push(
        `probe driver close failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const replayArtifacts: string[] = [];
  const replayErrors: string[] = [];
  const artifactStore = createRunArtifactStore(runDir, runId);
  for (const finding of findings.snapshot()) {
    const scenario = executedScenarios.find((candidate) => candidate.id === finding.scenario_id);
    if (!scenario) {
      replayErrors.push(`${finding.id}: scenario ${finding.scenario_id} is unavailable`);
      continue;
    }
    try {
      for (const artifact of buildReplayArtifacts({
        finding,
        scenario,
        ...(project.sut.base_url ? { base_url: project.sut.base_url } : {}),
      })) {
        await artifactStore.putText(artifact.path, artifact.contents, 'text/plain; charset=utf-8');
        replayArtifacts.push(artifact.path);
      }
    } catch (e) {
      replayErrors.push(`${finding.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Final `run_finished` event closes the audit trail. Wrap in try/catch
  // so a write failure at finalization still returns a structured result
  // (with the finalization error appended) rather than throwing past the
  // structured RunResult.
  const completionPayload = {
    scenarios_run: scenariosRun,
    scenario_outcomes: scenarioOutcomes,
    findings: findings.snapshot().length,
    pack_errors: packErrors.length,
    scenario_errors: scenarioErrors.length,
    missing_scenarios: missingScenarios.length,
    unsafe_paths: unsafeScenarioPaths.length,
    runtime_errors: runtimeErrors.length,
    execution_errors: executionErrors.length,
    budget_exceeded: budgetExceeded,
    budget_minutes: profile.budget_minutes ?? null,
    replay_artifacts: replayArtifacts.length,
    replay_errors: replayErrors.length,
    release_gate_failed: profile.require_deterministic_replay && findings.snapshot().length > 0,
    pack_error_samples: cap(packErrors),
    scenario_error_samples: cap(scenarioErrors),
    missing_scenario_samples: cap(missingScenarios),
    unsafe_path_samples: cap(unsafeScenarioPaths),
    runtime_error_samples: cap(runtimeErrors),
    execution_error_samples: cap(executionErrors),
    replay_artifact_samples: cap(replayArtifacts),
    replay_error_samples: cap(replayErrors),
  };
  const completionState = Run.deriveStateFromCompletion(
    { payload: completionPayload },
    scenariosRun,
  );
  let finalizationError: string | undefined;
  try {
    events.append({
      ts: new Date().toISOString(),
      run_id: runId,
      kind: 'run_finished',
      actor: { type: 'orchestrator', id: runnerId },
      payload: { ...completionPayload, run_state: completionState, runner_id: runnerId },
    });
  } catch (e) {
    finalizationError = `cannot finalize run audit: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Publish the canonical streams only after run_finished has been appended.
  // putBytes is intentional: putText applies redaction and would change the
  // bytes (and therefore the hash-chain evidence) even when the local writers
  // already emitted redacted content. The manifest makes the two immutable
  // stream references discoverable without pretending the upload is atomic.
  const canonicalArtifacts: string[] = [];
  const canonicalArtifactErrors: string[] = [];
  const canonicalRefs: Record<string, { id: string; sha256: string; bytes: number }> = {};
  let externalCheckpointRef: { id: string; sha256: string; bytes: number; key: string } | undefined;
  for (const [key, path] of [
    ['canonical/events.jsonl', eventsPath],
    ['canonical/findings.jsonl', findingsPath],
  ] as const) {
    try {
      const ref = await artifactStore.putBytes(key, readFileSync(path));
      canonicalArtifacts.push(ref.key);
      canonicalRefs[key] = { id: ref.id, sha256: ref.sha256, bytes: ref.bytes };
    } catch (e) {
      canonicalArtifactErrors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (canonicalArtifactErrors.length === 0) {
    try {
      const checkpoint = createAuditCheckpoint(
        parseEventLines(readFileSync(eventsPath, 'utf8')),
        opts.auditCheckpointSigner,
      );
      const checkpointRef = await artifactStore.putJson('canonical/checkpoint.json', checkpoint);
      canonicalArtifacts.push(checkpointRef.key);
      canonicalRefs['canonical/checkpoint.json'] = {
        id: checkpointRef.id,
        sha256: checkpointRef.sha256,
        bytes: checkpointRef.bytes,
      };
      if (opts.auditCheckpointStore) {
        const externalRef = await opts.auditCheckpointStore.putJson(
          `checkpoints/${runId}.json`,
          checkpoint,
        );
        if (
          externalRef.sha256 !== checkpointRef.sha256 ||
          externalRef.bytes !== checkpointRef.bytes
        ) {
          throw new Error('independent checkpoint digest/size does not match canonical checkpoint');
        }
        externalCheckpointRef = {
          key: externalRef.key,
          id: externalRef.id,
          sha256: externalRef.sha256,
          bytes: externalRef.bytes,
        };
      }
    } catch (e) {
      canonicalArtifactErrors.push(
        `canonical/checkpoint.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (canonicalArtifactErrors.length === 0) {
    try {
      const manifest = await artifactStore.putJson('canonical/manifest.json', {
        schema_version: '1',
        run_id: runId,
        events_key: 'canonical/events.jsonl',
        findings_key: 'canonical/findings.jsonl',
        artifacts: canonicalRefs,
        ...(externalCheckpointRef ? { external_checkpoint: externalCheckpointRef } : {}),
        published_at: new Date().toISOString(),
      });
      canonicalArtifacts.push(manifest.key);
    } catch (e) {
      canonicalArtifactErrors.push(
        `canonical/manifest.json: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (telemetry) {
    try {
      await telemetry.shutdown();
    } catch (error) {
      telemetryError = `OTLP delivery unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // Build a structured error message when something went wrong. Any of these
  // is a real coverage gap, not a benign skip: a broken pack, a malformed
  // scenario, a manifest-listed file that doesn't exist, an unsafe path
  // (absolute or path traversal), a runtime exception inside `runScenario`,
  // or zero scenarios executed for the requested profile. All flip
  // `ok: false` so CI catches the gap instead of greenlighting an empty
  // release-gate run.
  /**
   * Format an error list for the human-facing `error` string. We cap the
   * embedded samples at `MAX_DETAIL_PER_KIND` to keep the string
   * actionable for CLI users; the full list still lives in the event
   * payload via `*_samples` for auditors who need it.
   */
  function fmtList(list: readonly string[]): string {
    const sample = cap(list);
    const more = list.length - sample.length;
    return more > 0 ? `${sample.join('; ')}; … +${more} more` : sample.join('; ');
  }

  const reasons: string[] = [];
  // Pack errors fail the run in two cases:
  //   1. Use-everything mode (`profile.packs` empty): every broken pack
  //      shrinks intended coverage.
  //   2. Specific selection mode: at least one *selected* pack didn't
  //      load. We detect this by comparing the count of profile-pinned
  //      packs against the count of canonical manifest names we actually
  //      ran (`seenPackNames`). An unrelated broken pack elsewhere on
  //      disk stays non-blocking.
  // For each profile entry, "loaded" means seenPackNames contains either
  // the exact entry name (handles third-party packs whose manifest doesn't
  // use the `pack-` prefix) or its `pack-`-prefixed alias (handles legacy
  // `aqa init` output like `core` → manifest `pack-core`). Each profile
  // entry counts once.
  const entryLoaded = (p: string): boolean =>
    seenPackNames.has(p) || (!p.startsWith('pack-') && seenPackNames.has(`pack-${p}`));
  const missingProfileEntries = profile.packs.filter((p) => !entryLoaded(p));
  const missingSelectedCount = missingProfileEntries.length;
  if (packErrors.length > 0 && profilePackSet.size === 0) {
    reasons.push(`${packErrors.length} pack(s) failed to load: ${fmtList(packErrors)}`);
  } else if (missingSelectedCount > 0) {
    // A selected pack didn't make it into `seenPackNames`. This catches:
    //   - load errors on a selected pack (packErrors populated)
    //   - a selected pack that wasn't discovered at all (no directory
    //     matching its name anywhere → packErrors stays empty)
    //   - a selected pack that was discovered but skipped by applies_when
    // Any of those is intended coverage that didn't run, so the release
    // gate (and any specific-selection profile) must fail rather than
    // pass silently.
    reasons.push(
      `${missingSelectedCount} selected pack(s) did not load: ${fmtList(missingProfileEntries)}${
        packErrors.length > 0 ? `; errors: ${fmtList(packErrors)}` : ''
      }`,
    );
  }
  if (scenarioErrors.length > 0)
    reasons.push(
      `${scenarioErrors.length} scenario(s) failed to parse: ${fmtList(scenarioErrors)}`,
    );
  if (missingScenarios.length > 0)
    reasons.push(
      `${missingScenarios.length} manifest scenario(s) missing on disk: ${fmtList(missingScenarios)}`,
    );
  if (unsafeScenarioPaths.length > 0)
    reasons.push(
      `${unsafeScenarioPaths.length} unsafe scenario path(s) (absolute or path traversal): ${fmtList(unsafeScenarioPaths)}`,
    );
  if (runtimeErrors.length > 0)
    reasons.push(`${runtimeErrors.length} scenario(s) threw at runtime: ${fmtList(runtimeErrors)}`);
  if (executionErrors.length > 0)
    reasons.push(
      `${executionErrors.length} scenario(s) could not execute: ${fmtList(executionErrors)}`,
    );
  if (budgetExceeded) {
    reasons.push(
      `profile "${profileKey}" exceeded budget_minutes=${profile.budget_minutes}; remaining scenarios were not run`,
    );
  }
  if (cancelled) reasons.push('run cancelled by worker or operator');
  if (replayErrors.length > 0)
    reasons.push(`${replayErrors.length} replay artifact(s) failed: ${fmtList(replayErrors)}`);
  if (canonicalArtifactErrors.length > 0)
    reasons.push(
      `${canonicalArtifactErrors.length} canonical artifact(s) failed: ${fmtList(canonicalArtifactErrors)}`,
    );
  if (scenariosRun === 0) {
    reasons.push(
      `profile "${profileKey}" ran 0 scenarios — check that profile.packs (${profile.packs.join(', ') || '<empty>'}) match a discoverable pack manifest and that profile.tags overlap with scenario tags`,
    );
  }
  const findingsCount = findings.snapshot().length;
  if (profile.require_deterministic_replay && findingsCount > 0) {
    reasons.push(
      `profile "${profileKey}" requires deterministic replay; failing run because ${findingsCount} finding(s) were emitted`,
    );
  }
  if (finalizationError) reasons.push(finalizationError);

  // Warnings: anything we observed that didn't make `ok: false` but is
  // still useful diagnostic context (e.g. an unrelated broken pack when
  // the selected profile loaded fine). Capped so a noisy tree doesn't
  // overwhelm the response.
  const warnings: string[] = [];
  // Only pack errors land here as warnings — manifest-missing scenarios
  // already fail the run unconditionally (see the `missingScenarios.length`
  // reason above), so they never reach this branch.
  if (packErrors.length > 0 && reasons.length === 0) {
    for (const e of cap(packErrors)) warnings.push(`pack: ${e}`);
  }
  if (telemetryError) warnings.push(telemetryError);

  return {
    ok: reasons.length === 0,
    runId,
    runDir,
    scenariosRun,
    findingsCount,
    ...(reasons.length > 0 ? { error: reasons.join(' | ') } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(canonicalArtifacts.length > 0 ? { canonicalArtifacts } : {}),
  };
}

function httpSecretsFromEnvironment(): Record<string, string> {
  const prefix = 'AQA_HTTP_SECRET_';
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || !value) continue;
    const name = key.slice(prefix.length);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) output[name] = value;
  }
  return output;
}
