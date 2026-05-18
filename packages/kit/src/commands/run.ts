/**
 * `aqa run` — the inner-loop driver.
 *
 * Loads `.aqa/project.yaml` + `.aqa/profiles.yaml` using the canonical
 * `@aqa/schemas` shapes, resolves packs from either an explicit `packsRoot`
 * list or three default locations (project's `packs/*`, `node_modules/@aqa/pack-*`,
 * and the `dist/packs/*` bundled inside `@aqa/kit`), filters scenarios by
 * the selected profile's `tags`, and runs each one via
 * `@aqa/runner.runScenario`. The runner appends to the events + findings
 * writers we hand it; we never re-emit `finding_emitted` ourselves.
 *
 * Profiles with `require_deterministic_replay: true` (the canonical
 * "release-gate" signal from the schema) treat any emitted finding as a
 * run-level failure so CI exits non-zero on regressions. Smoke-style
 * profiles still surface findings via `findingsCount` + `findings.jsonl`
 * but report `ok: true` when scenarios completed without infrastructure
 * errors.
 *
 * The default probe runner is the no-network stub from `@aqa/runner`. Wiring
 * real HTTP / browser probes against a live target is intentionally a
 * follow-up; this command owns the orchestration and the audit trail.
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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LoadedPack, appliesWhen, loadPack } from '@aqa/pack-loader';
import { EventChainWriter, FindingsWriter, runScenario } from '@aqa/runner';
import { Profile, Project, Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';

export interface RunOptions {
  root: string;
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
}

export interface RunResult {
  ok: boolean;
  /**
   * Present whenever the run got far enough to allocate a run directory —
   * which is most failure modes (broken pack, malformed scenario, 0
   * scenarios, release-gate findings, findings.jsonl create failure, or
   * an exception on the initial `run_started` event write). Absent only
   * for the early-exit errors that happen before the directory is
   * created: missing project.yaml, schema-invalid project/profiles,
   * invalid CLI flags, runs-dir unwritable, or a deterministic-seed
   * collision.
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
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'packs');
}

function defaultPacksRoot(projectRoot: string): string[] {
  const candidates: string[] = [];
  // 1. Monorepo / vendored layout: <project>/packs/*
  discoverInDir(join(projectRoot, 'packs'), candidates);
  // 2. npm-installed bundled packs: <project>/node_modules/@aqa/pack-*
  //    Real consumer projects install packs as workspace or registry deps.
  discoverInDir(join(projectRoot, 'node_modules', '@aqa'), candidates);
  // 3. Packs bundled inside the running `@aqa/kit` install. Lets the
  //    documented `aqa init` → `aqa run --profile smoke` flow work with
  //    only `@aqa/kit` installed (the canonical junior workflow).
  discoverInDir(bundledKitPacksDir(), candidates);
  return candidates;
}

function resolvePackDirs(opts: RunOptions): string[] {
  if (opts.packsRoot && opts.packsRoot.length > 0) {
    // Sort caller-supplied paths so `--seed` determinism doesn't depend on
    // how the caller assembled the array. Comparing absolute paths gives
    // stable cross-platform order.
    return opts.packsRoot.map((p) => (isAbsolute(p) ? p : resolve(opts.root, p))).sort();
  }
  return defaultPacksRoot(opts.root);
}

interface ManifestScenarios {
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
function manifestScenarioFiles(packRoot: string, pack: LoadedPack): ManifestScenarios {
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

  // Agent mode isn't implemented yet — the runner is orchestrator-only. A
  // profile with `execution_mode: agent` would silently fall through to the
  // orchestrator path and record findings with a mismatched actor, so fail
  // fast instead. Wire this up once @aqa/runner grows an agent driver.
  if (profile.execution_mode !== 'orchestrator') {
    return makeError(
      `profile "${profileKey}" requires execution_mode "${profile.execution_mode}" which is not yet implemented — only "orchestrator" is supported`,
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
  const events = new EventChainWriter(eventsPath);
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
      actor: { type: 'orchestrator', id: 'aqa-cli' },
      payload: { profile: profileKey, project: project.name },
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
  for (const packDir of resolvePackDirs(opts)) {
    let pack: LoadedPack;
    try {
      pack = loadPack(packDir);
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

    for (const scenarioPath of paths) {
      let scenario: Scenario.Scenario;
      try {
        scenario = Scenario.Scenario.parse(readYaml<unknown>(scenarioPath));
      } catch (e) {
        scenarioErrors.push(`${scenarioPath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!tagsMatch(scenario.tags ?? [], profile.tags)) continue;
      scenariosRun += 1;
      // runScenario itself appends `finding_emitted` to events and pushes the
      // finding through findings.append when both writers are provided — do
      // NOT re-emit here. Wrap in try/catch so a future probe-runner
      // exception (or write failure) is collected instead of bubbling out
      // and skipping the `run_finished` audit event.
      try {
        await runScenario({
          scenario,
          run_id: runId,
          events,
          findings,
          findingIdSeed: scenariosRun,
        });
      } catch (e) {
        runtimeErrors.push(`${scenario.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Final `run_finished` event closes the audit trail. Wrap in try/catch
  // so a write failure at finalization still returns a structured result
  // (with the finalization error appended) rather than throwing past the
  // structured RunResult.
  let finalizationError: string | undefined;
  try {
    events.append({
      ts: new Date().toISOString(),
      run_id: runId,
      kind: 'run_finished',
      actor: { type: 'orchestrator', id: 'aqa-cli' },
      payload: {
        scenarios_run: scenariosRun,
        findings: findings.snapshot().length,
        pack_errors: packErrors.length,
        scenario_errors: scenarioErrors.length,
        missing_scenarios: missingScenarios.length,
        unsafe_paths: unsafeScenarioPaths.length,
        runtime_errors: runtimeErrors.length,
        // Capped detail samples — let auditors diagnose the run from the
        // audit trail alone, without having to re-execute it. Bounded so
        // a runaway pack tree can't blow up the JSONL line size.
        pack_error_samples: cap(packErrors),
        scenario_error_samples: cap(scenarioErrors),
        missing_scenario_samples: cap(missingScenarios),
        unsafe_path_samples: cap(unsafeScenarioPaths),
        runtime_error_samples: cap(runtimeErrors),
      },
    });
  } catch (e) {
    finalizationError = `cannot finalize run audit: ${e instanceof Error ? e.message : String(e)}`;
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
  // The canonical names from `profile.packs` are the entries themselves
  // plus `pack-` prefixed variants (legacy aliases), so we count how many
  // of the canonical pack names actually got loaded.
  const selectedCanonical = new Set<string>();
  for (const p of profile.packs) {
    const canonical = p.startsWith('pack-') ? p : `pack-${p}`;
    selectedCanonical.add(canonical);
  }
  const selectedLoadedCount = [...selectedCanonical].filter((n) => seenPackNames.has(n)).length;
  const missingSelectedCount = selectedCanonical.size - selectedLoadedCount;
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
    const missingNames = [...selectedCanonical].filter((n) => !seenPackNames.has(n));
    reasons.push(
      `${missingSelectedCount} selected pack(s) did not load: ${fmtList(missingNames)}${
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
  if (scenariosRun === 0) {
    reasons.push(
      `profile "${profileKey}" ran 0 scenarios — check that profile.packs (${profile.packs.join(', ') || '<empty>'}) match a discoverable pack manifest and that profile.tags overlap with scenario tags`,
    );
  }
  // Release-gate semantics: a profile that opts into deterministic replay
  // (the schema signal for "this is the merge gate") must exit non-zero on
  // any emitted finding so CI catches regressions without callers having
  // to manually parse findings.jsonl. Smoke profiles still report ok=true
  // when scenarios complete — they surface findings via `findingsCount`.
  const findingsCount = findings.snapshot().length;
  if (profile.require_deterministic_replay && findingsCount > 0) {
    reasons.push(
      `profile "${profileKey}" emitted ${findingsCount} finding(s) — release-gate profiles (require_deterministic_replay: true) treat any finding as a regression`,
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

  return {
    ok: reasons.length === 0,
    runId,
    runDir,
    scenariosRun,
    findingsCount,
    ...(reasons.length > 0 ? { error: reasons.join(' | ') } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
