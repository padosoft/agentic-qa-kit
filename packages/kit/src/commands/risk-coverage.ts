import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type RiskCoverageReport, measureRiskCoverage } from '@aqa/methodology';
import { type LoadedPack, appliesWhen, loadPack } from '@aqa/pack-loader';
import { verifyPackContentDigest } from '@aqa/pack-scanner';
import { Event, Profile, Project, RiskMap, Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';
import { type RunOptions, manifestScenarioFiles, resolvePackDirs } from './run.js';

export interface RiskCoverageOptions {
  root: string;
  profile?: string;
  now?: Date;
  packsRoot?: string[];
}

export interface RiskCoverageResult {
  ok: boolean;
  gate_ok: boolean;
  reports: ReadonlyArray<RiskCoverageReport>;
  errors: ReadonlyArray<string>;
}

interface CoverageScenario {
  id: string;
  risk_refs: ReadonlyArray<string>;
  invariant_refs: ReadonlyArray<string>;
  oracles: ReadonlyArray<unknown>;
}

/**
 * Measure risk coverage from declarations and persisted run events.
 * Invalid evidence is reported as an error; it is never treated as a missing
 * failure or a passing run.
 */
export function runRiskCoverage(opts: RiskCoverageOptions): RiskCoverageResult {
  const errors: string[] = [];
  const riskMapPath = join(opts.root, '.aqa', 'risk-map.yaml');
  if (!existsSync(riskMapPath))
    return { ok: false, gate_ok: false, reports: [], errors: ['.aqa/risk-map.yaml not found'] };

  let riskMap: RiskMap.RiskMap;
  try {
    riskMap = RiskMap.RiskMap.parse(yamlParse(readFileSync(riskMapPath, 'utf8')));
  } catch (error) {
    return {
      ok: false,
      gate_ok: false,
      reports: [],
      errors: [
        `invalid .aqa/risk-map.yaml: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  let profile: Profile.Profile | undefined;
  const profilesPath = join(opts.root, '.aqa', 'profiles.yaml');
  if (existsSync(profilesPath)) {
    try {
      const profiles = Profile.ProfilesFile.parse(yamlParse(readFileSync(profilesPath, 'utf8')));
      const profileKey = opts.profile ?? (profiles.profiles.smoke ? 'smoke' : undefined);
      if (profileKey) {
        profile = profiles.profiles[profileKey];
        if (!profile) errors.push(`unknown profile "${profileKey}"`);
      }
    } catch (error) {
      errors.push(
        `invalid .aqa/profiles.yaml: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const project = readProject(opts.root, errors);
  const scenarios: CoverageScenario[] = [];
  const seenPacks = new Set<string>();
  const packRiskMaps: RiskMap.Risk[] = [];
  const runOptions: RunOptions = {
    root: opts.root,
    ...(opts.packsRoot ? { packsRoot: opts.packsRoot } : {}),
  };
  for (const packDir of resolvePackDirs(runOptions)) {
    let pack: LoadedPack;
    try {
      pack = loadPack(packDir);
      if (!verifyPackContentDigest(pack.root, pack.manifest).ok) continue;
    } catch (error) {
      errors.push(`pack ${packDir}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (seenPacks.has(pack.manifest.name)) continue;
    if (
      profile?.packs.length &&
      !profile.packs.some((p) => p === pack.manifest.name || `pack-${p}` === pack.manifest.name)
    )
      continue;
    if (
      project &&
      !appliesWhen(pack.manifest, {
        sut_type: project.sut.type,
        runtime: project.stack.runtime,
        ...(project.stack.framework ? { framework: project.stack.framework } : {}),
        db: project.stack.db ?? [],
        tags: project.tags ?? [],
      })
    )
      continue;
    seenPacks.add(pack.manifest.name);
    for (const relativeRiskPath of pack.manifest.risks ?? []) {
      try {
        const riskPath = join(pack.root, relativeRiskPath);
        packRiskMaps.push(
          ...RiskMap.RiskMap.parse(yamlParse(readFileSync(riskPath, 'utf8'))).risks,
        );
      } catch (error) {
        errors.push(
          `pack ${pack.manifest.name} risk ${relativeRiskPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const resolved = manifestScenarioFiles(pack.root, pack);
    for (const missing of resolved.missing)
      errors.push(`pack ${pack.manifest.name} missing scenario ${missing}`);
    for (const unsafe of resolved.unsafe)
      errors.push(`pack ${pack.manifest.name} unsafe scenario ${unsafe}`);
    for (const scenarioPath of resolved.paths) {
      try {
        const scenario = Scenario.Scenario.parse(yamlParse(readFileSync(scenarioPath, 'utf8')));
        if (
          profile &&
          profile.tags.length > 0 &&
          !scenario.tags.some((tag) => profile.tags.includes(tag))
        )
          continue;
        scenarios.push({
          id: scenario.id,
          risk_refs: scenario.risk_refs,
          invariant_refs: scenario.invariant_refs,
          oracles: scenario.oracles,
        });
      } catch (error) {
        errors.push(
          `invalid scenario ${scenarioPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const mergedRiskMap = RiskMap.RiskMap.parse({
    ...riskMap,
    risks: [
      ...riskMap.risks,
      ...packRiskMaps.filter((risk) => !riskMap.risks.some((known) => known.id === risk.id)),
    ],
  });
  const runs = readCoverageRuns(join(opts.root, '.aqa', 'runs'), errors);
  const reports =
    errors.length > 0
      ? []
      : measureRiskCoverage({
          risk_map: mergedRiskMap,
          scenarios,
          runs,
          ...(opts.now ? { now: opts.now } : {}),
        });
  const gate_ok =
    errors.length === 0 &&
    reports.length > 0 &&
    reports.every((report) => report.status === 'covered');
  return { ok: errors.length === 0, gate_ok, reports, errors };
}

function readProject(root: string, errors: string[]): Project.Project | undefined {
  const path = join(root, '.aqa', 'project.yaml');
  if (!existsSync(path)) return undefined;
  try {
    return Project.Project.parse(yamlParse(readFileSync(path, 'utf8')));
  } catch (error) {
    errors.push(
      `invalid .aqa/project.yaml: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function readCoverageRuns(
  root: string,
  errors: string[],
): Array<{
  scenario_id: string;
  executed_at: string;
  passed: boolean;
  deterministic_replay?: boolean;
}> {
  if (!existsSync(root)) return [];
  const runs: Array<{
    scenario_id: string;
    executed_at: string;
    passed: boolean;
    deterministic_replay?: boolean;
  }> = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry, 'events.jsonl');
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        errors.push(`invalid JSON in ${path}`);
        continue;
      }
      const event = Event.Event.safeParse(parsed);
      if (!event.success) {
        errors.push(`invalid event in ${path}`);
        continue;
      }
      if (event.data.kind !== 'scenario_finished' || !event.data.scenario_id) continue;
      const outcome = event.data.payload.outcome;
      runs.push({
        scenario_id: event.data.scenario_id,
        executed_at: event.data.ts,
        passed: outcome === 'pass',
        ...(event.data.payload.deterministic_replay === true ? { deterministic_replay: true } : {}),
      });
    }
  }
  return runs;
}
