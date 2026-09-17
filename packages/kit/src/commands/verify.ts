import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { loadPack } from '@aqa/pack-loader';
import { type ProbeRunner, makeHttpProbeRunner, verifyScenario } from '@aqa/runner';
import { Finding, Scenario } from '@aqa/schemas';
import { parse as yamlParse } from 'yaml';

export interface VerifyOptions {
  root: string;
  findingId: string;
  attempts?: number;
  baseUrl?: string;
  probeRunner?: ProbeRunner;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  findingId: string;
  scenarioId?: string;
  verificationPath?: string;
  attempts?: number;
  successes?: number;
  deterministic?: boolean;
}

function readFinding(root: string, findingId: string): Finding.Finding | null {
  const runsRoot = join(root, '.aqa', 'runs');
  if (!existsSync(runsRoot)) return null;
  for (const runId of readdirSync(runsRoot).sort()) {
    const path = join(runsRoot, runId, 'findings.jsonl');
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const finding = Finding.Finding.parse(JSON.parse(line));
        if (finding.id === findingId) return finding;
      } catch {
        // Corrupt artifact lines are reported by `aqa report`, not verified.
      }
    }
  }
  return null;
}

function candidatePackDirs(root: string): string[] {
  const roots = [join(root, 'packs'), join(root, 'node_modules', '@aqa')];
  const dirs: string[] = [];
  for (const parent of roots) {
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent).sort()) {
      const path = join(parent, name);
      if (existsSync(join(path, 'pack.yaml'))) dirs.push(path);
    }
  }
  return dirs;
}

function findScenario(root: string, scenarioId: string): Scenario.Scenario | null {
  for (const packDir of candidatePackDirs(root)) {
    try {
      const pack = loadPack(packDir);
      for (const relativePath of pack.manifest.scenarios ?? []) {
        const path = resolve(packDir, relativePath);
        const packRoot = resolve(packDir);
        const relativeScenario = relative(packRoot, path);
        if (isAbsolute(relativeScenario) || relativeScenario.startsWith('..')) continue;
        if (!existsSync(path)) continue;
        const scenario = Scenario.Scenario.parse(yamlParse(readFileSync(path, 'utf8')));
        if (scenario.id === scenarioId) return scenario;
      }
    } catch {
      // Ignore unrelated broken packs while locating the requested scenario.
    }
  }
  return null;
}

export async function runVerify(opts: VerifyOptions): Promise<VerifyResult> {
  const attempts = opts.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    return {
      ok: false,
      error: 'attempts must be an integer from 1 to 10',
      findingId: opts.findingId,
    };
  }
  const finding = readFinding(opts.root, opts.findingId);
  if (!finding) return { ok: false, error: 'finding not found', findingId: opts.findingId };
  const scenario = findScenario(opts.root, finding.scenario_id);
  if (!scenario) {
    return {
      ok: false,
      error: `scenario not found for finding: ${finding.scenario_id}`,
      findingId: opts.findingId,
      scenarioId: finding.scenario_id,
    };
  }
  const probeRunner =
    opts.probeRunner ?? (opts.baseUrl ? makeHttpProbeRunner({ baseUrl: opts.baseUrl }) : undefined);
  if (!probeRunner) {
    return {
      ok: false,
      error:
        'a baseUrl or injected probeRunner is required; verification never uses a no-network stub',
      findingId: opts.findingId,
      scenarioId: scenario.id,
    };
  }
  const result = await verifyScenario({
    scenario,
    run_id: finding.run_id,
    attempts,
    probeRunner,
  });
  const runDir = join(opts.root, '.aqa', 'runs', finding.run_id);
  const verificationPath = join(runDir, `verification-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(verificationPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    findingId: opts.findingId,
    scenarioId: scenario.id,
    verificationPath: relative(opts.root, verificationPath),
    attempts: result.attempts,
    successes: result.successes,
    deterministic: result.deterministic,
  };
}
