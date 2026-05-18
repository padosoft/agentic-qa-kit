/**
 * `aqa run` — the inner-loop driver. Loads .aqa/project.yaml, resolves packs
 * (filesystem-relative paths only for now; npm-style packs are a follow-up),
 * executes every scenario whose tags intersect the requested profile's scope,
 * and streams an append-only events.jsonl + findings.jsonl into
 * `.aqa/runs/<run_id>/`.
 *
 * The default probe runner is the no-network stub from `@aqa/runner`. Wiring
 * real HTTP / browser probes against a live target is intentionally a
 * follow-up; this command's job is the orchestration and the audit trail.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadPack } from '@aqa/pack-loader';
import { EventChainWriter, FindingsWriter, runScenario } from '@aqa/runner';
import { Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';

export interface RunOptions {
  root: string;
  /** Profile key from .aqa/profiles.yaml; defaults to the project's profiles.default. */
  profile?: string;
  /** If set, makes run_id deterministic — useful for tests + replay. */
  seed?: string;
}

export interface RunResult {
  ok: boolean;
  runId: string;
  runDir: string;
  scenariosRun: number;
  findingsCount: number;
  error?: string;
}

interface ProjectFile {
  schema_version: string;
  name: string;
  packs?: string[];
  profiles?: { default?: string };
}

interface ProfilesFile {
  schema_version: string;
  profiles: Record<string, ProfileDef>;
}

interface ProfileDef {
  name: string;
  scope?: { include_tags?: string[]; exclude_tags?: string[] };
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

function discoverScenarios(packRoot: string): string[] {
  const candidates: string[] = [];
  const scenariosDir = join(packRoot, 'scenarios');
  if (!existsSync(scenariosDir)) return candidates;
  for (const entry of readdirSync(scenariosDir)) {
    const abs = join(scenariosDir, entry);
    if (statSync(abs).isFile() && (entry.endsWith('.yaml') || entry.endsWith('.yml'))) {
      candidates.push(abs);
    }
  }
  return candidates;
}

function resolvePackRoot(projectRoot: string, packRef: string): string | null {
  if (packRef.startsWith('./') || packRef.startsWith('../') || isAbsolute(packRef)) {
    const abs = isAbsolute(packRef) ? packRef : resolve(projectRoot, packRef);
    return existsSync(join(abs, 'pack.yaml')) || existsSync(join(abs, 'pack.yml')) ? abs : null;
  }
  return null;
}

function tagsMatch(scenarioTags: readonly string[], profile: ProfileDef): boolean {
  const include = profile.scope?.include_tags ?? [];
  const exclude = profile.scope?.exclude_tags ?? [];
  if (include.length > 0 && !scenarioTags.some((t) => include.includes(t))) return false;
  if (exclude.length > 0 && scenarioTags.some((t) => exclude.includes(t))) return false;
  return true;
}

export async function runRun(opts: RunOptions): Promise<RunResult> {
  const projectPath = join(opts.root, '.aqa', 'project.yaml');
  const profilesPath = join(opts.root, '.aqa', 'profiles.yaml');
  if (!existsSync(projectPath)) {
    return makeError(opts, '.aqa/project.yaml not found — run `aqa init` first');
  }
  if (!existsSync(profilesPath)) {
    return makeError(opts, '.aqa/profiles.yaml not found — run `aqa init` first');
  }

  const project = readYaml<ProjectFile>(projectPath);
  const profilesFile = readYaml<ProfilesFile>(profilesPath);
  const profileKey = opts.profile ?? project.profiles?.default ?? 'smoke';
  const profile = profilesFile.profiles[profileKey];
  if (!profile) {
    return makeError(
      opts,
      `unknown profile "${profileKey}" — known: ${Object.keys(profilesFile.profiles).join(', ') || '(none)'}`,
    );
  }

  const runId = opts.seed
    ? deterministicRunId(`${project.name}|${profileKey}|${opts.seed}`)
    : freshRunId();
  const runDir = join(opts.root, '.aqa', 'runs', runId);
  mkdirSync(runDir, { recursive: true });

  const eventsPath = join(runDir, 'events.jsonl');
  const findingsPath = join(runDir, 'findings.jsonl');
  const events = new EventChainWriter(eventsPath);
  const findings = new FindingsWriter(findingsPath);
  // Touch the findings file so consumers can always count on its presence,
  // even when a clean run produces zero findings.
  if (!existsSync(findingsPath)) writeFileSync(findingsPath, '', 'utf8');

  events.append({
    ts: new Date().toISOString(),
    run_id: runId,
    kind: 'run_started',
    actor: { type: 'orchestrator', id: 'aqa-cli' },
    payload: { profile: profileKey, project: project.name },
  });

  let scenariosRun = 0;
  for (const packRef of project.packs ?? []) {
    const packRoot = resolvePackRoot(opts.root, packRef);
    if (!packRoot) continue;
    try {
      loadPack(packRoot);
    } catch {
      continue;
    }
    for (const scenarioPath of discoverScenarios(packRoot)) {
      let scenario: Scenario.Scenario;
      try {
        const raw = readYaml<unknown>(scenarioPath);
        scenario = Scenario.Scenario.parse(raw);
      } catch {
        continue;
      }
      if (!tagsMatch(scenario.tags ?? [], profile)) continue;
      scenariosRun += 1;
      const result = await runScenario({
        scenario,
        run_id: runId,
        events,
        findings,
        findingIdSeed: scenariosRun,
      });
      if (result.finding) {
        events.append({
          ts: new Date().toISOString(),
          run_id: runId,
          kind: 'finding_emitted',
          actor: { type: 'orchestrator', id: 'aqa-cli' },
          scenario_id: scenario.id,
          finding_id: result.finding.id,
          payload: { severity: result.finding.severity },
        });
        findings.append(result.finding);
      }
    }
  }

  events.append({
    ts: new Date().toISOString(),
    run_id: runId,
    kind: 'run_finished',
    actor: { type: 'orchestrator', id: 'aqa-cli' },
    payload: { scenarios_run: scenariosRun, findings: findings.snapshot().length },
  });

  return {
    ok: true,
    runId,
    runDir,
    scenariosRun,
    findingsCount: findings.snapshot().length,
  };
}

function makeError(_opts: RunOptions, error: string): RunResult {
  return {
    ok: false,
    runId: '',
    runDir: '',
    scenariosRun: 0,
    findingsCount: 0,
    error,
  };
}
