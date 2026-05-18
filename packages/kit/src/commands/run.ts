/**
 * `aqa run` — the inner-loop driver.
 *
 * Loads `.aqa/project.yaml` + `.aqa/profiles.yaml` using the canonical
 * `@aqa/schemas` shapes, resolves packs from the supplied `packsRoot` list
 * (filesystem-relative, defaults to `<root>/packs/*`), filters scenarios by
 * the selected profile's `tags`, and runs each one via
 * `@aqa/runner.runScenario`. The runner appends to the events + findings
 * writers we hand it; we never re-emit `finding_emitted` ourselves.
 *
 * The default probe runner is the no-network stub from `@aqa/runner`. Wiring
 * real HTTP / browser probes against a live target is intentionally a
 * follow-up; this command owns the orchestration and the audit trail.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
   * Filesystem paths (absolute or relative to `root`) to scan for packs.
   * Each path must contain a `pack.yaml` manifest. Defaults to `<root>/packs/*`
   * when present, plus any `node_modules/@aqa/pack-*` (a follow-up).
   */
  packsRoot?: string[];
}

export interface RunResult {
  ok: boolean;
  runId: string;
  runDir: string;
  scenariosRun: number;
  findingsCount: number;
  error?: string;
}

function readYaml<T>(path: string): T {
  return yamlParse(readFileSync(path, 'utf8')) as T;
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

function defaultPacksRoot(projectRoot: string): string[] {
  const candidates: string[] = [];
  const repoPacks = join(projectRoot, 'packs');
  // Wrap every FS call so an unreadable entry (permissions, broken symlink,
  // TOCTOU delete) yields zero discovered packs rather than throwing through
  // the structured RunResult.
  try {
    if (!existsSync(repoPacks) || !statSync(repoPacks).isDirectory()) return candidates;
    // Sort for stable iteration — scenario execution order feeds findingIdSeed,
    // event ordering, and downstream determinism guarantees from `--seed`.
    for (const entry of readdirSync(repoPacks).sort()) {
      const abs = join(repoPacks, entry);
      try {
        if (
          statSync(abs).isDirectory() &&
          (existsSync(join(abs, 'pack.yaml')) || existsSync(join(abs, 'pack.yml')))
        ) {
          candidates.push(abs);
        }
      } catch {
        // unreadable entry — skip silently rather than abort discovery
      }
    }
  } catch {
    // unreadable packs/ root — return whatever we've collected so far
  }
  return candidates;
}

function resolvePackDirs(opts: RunOptions): string[] {
  if (opts.packsRoot && opts.packsRoot.length > 0) {
    return opts.packsRoot.map((p) => (isAbsolute(p) ? p : resolve(opts.root, p)));
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
 * Resolve manifest-listed scenarios. Missing files are surfaced (not silently
 * dropped), and any entry that's absolute or escapes the pack root via `..`
 * is rejected as unsafe so a malicious/buggy pack.yaml can't trick `aqa run`
 * into reading arbitrary filesystem paths.
 */
function manifestScenarioFiles(packRoot: string, pack: LoadedPack): ManifestScenarios {
  const paths: string[] = [];
  const missing: string[] = [];
  const unsafe: string[] = [];
  for (const rel of pack.manifest.scenarios ?? []) {
    if (isAbsolute(rel)) {
      unsafe.push(rel);
      continue;
    }
    const abs = resolve(packRoot, rel);
    const inside = relative(packRoot, abs);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      unsafe.push(rel);
      continue;
    }
    if (existsSync(abs)) paths.push(abs);
    else missing.push(rel);
  }
  return { paths, missing, unsafe };
}

/** Scenario tags intersect profile tags (or profile has no filter). */
function tagsMatch(scenarioTags: readonly string[], profileTags: readonly string[]): boolean {
  if (profileTags.length === 0) return true;
  return scenarioTags.some((t) => profileTags.includes(t));
}

function makeError(error: string): RunResult {
  return {
    ok: false,
    runId: '',
    runDir: '',
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

  const runId = opts.seed
    ? deterministicRunId(`${project.name}|${profileKey}|${opts.seed}`)
    : freshRunId();
  const runDir = join(opts.root, '.aqa', 'runs', runId);
  // Refuse to merge a fresh run into a pre-existing seeded directory — that
  // would append a second seq=0 chain onto the same events.jsonl and break
  // any later audit verification. Wrap the stat + readdir in try/catch so
  // we surface a structured error instead of throwing if the path exists
  // but is not a directory (e.g. someone touched a file at that name).
  if (existsSync(runDir)) {
    try {
      const st = statSync(runDir);
      if (!st.isDirectory()) {
        return makeError(`run path ${runDir} exists but is not a directory`);
      }
      if (readdirSync(runDir).length > 0) {
        return makeError(
          `run directory ${runDir} is non-empty (likely a deterministic seed collision); refusing to overwrite`,
        );
      }
    } catch (e) {
      return makeError(
        `cannot stat run directory ${runDir}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  mkdirSync(runDir, { recursive: true });

  const eventsPath = join(runDir, 'events.jsonl');
  const findingsPath = join(runDir, 'findings.jsonl');
  const events = new EventChainWriter(eventsPath);
  const findings = new FindingsWriter(findingsPath);
  // Touch findings.jsonl so downstream consumers can rely on its presence,
  // even when a clean run produces zero findings.
  if (!existsSync(findingsPath)) writeFileSync(findingsPath, '', 'utf8');

  events.append({
    ts: new Date().toISOString(),
    run_id: runId,
    kind: 'run_started',
    actor: { type: 'orchestrator', id: 'aqa-cli' },
    payload: { profile: profileKey, project: project.name },
  });

  // Build the set of packs the profile actually wants (by Slug). When the
  // profile lists no packs (default), all discoverable packs are eligible.
  const profilePackSet = new Set(profile.packs);
  // applies_when context built from the parsed project — lets the pack-loader
  // skip packs that explicitly don't match the SUT.
  const appliesCtx = {
    sut_type: project.sut.type,
    runtime: project.stack.runtime,
    ...(project.stack.framework ? { framework: project.stack.framework } : {}),
    tags: project.tags ?? [],
  };

  let scenariosRun = 0;
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
    },
  });

  // Build a structured error message when something went wrong. Any of these
  // is a real coverage gap, not a benign skip: a broken pack, a malformed
  // scenario, a manifest-listed file that doesn't exist, an unsafe path
  // (absolute or path traversal), a runtime exception inside `runScenario`,
  // or zero scenarios executed for the requested profile. All flip
  // `ok: false` so CI catches the gap instead of greenlighting an empty
  // release-gate run.
  const reasons: string[] = [];
  if (packErrors.length > 0)
    reasons.push(`${packErrors.length} pack(s) failed to load: ${packErrors.join('; ')}`);
  if (scenarioErrors.length > 0)
    reasons.push(
      `${scenarioErrors.length} scenario(s) failed to parse: ${scenarioErrors.join('; ')}`,
    );
  if (missingScenarios.length > 0)
    reasons.push(
      `${missingScenarios.length} manifest scenario(s) missing on disk: ${missingScenarios.join(', ')}`,
    );
  if (unsafeScenarioPaths.length > 0)
    reasons.push(
      `${unsafeScenarioPaths.length} unsafe scenario path(s) (absolute or path traversal): ${unsafeScenarioPaths.join(', ')}`,
    );
  if (runtimeErrors.length > 0)
    reasons.push(
      `${runtimeErrors.length} scenario(s) threw at runtime: ${runtimeErrors.join('; ')}`,
    );
  if (scenariosRun === 0) {
    reasons.push(
      `profile "${profileKey}" ran 0 scenarios — check that profile.packs (${profile.packs.join(', ') || '<empty>'}) match a discoverable pack manifest and that profile.tags overlap with scenario tags`,
    );
  }

  return {
    ok: reasons.length === 0,
    runId,
    runDir,
    scenariosRun,
    findingsCount: findings.snapshot().length,
    ...(reasons.length > 0 ? { error: reasons.join(' | ') } : {}),
  };
}
